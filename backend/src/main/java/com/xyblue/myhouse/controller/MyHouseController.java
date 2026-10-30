package com.xyblue.myhouse.controller;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.xyblue.myhouse.exception.ApiException;
import com.xyblue.myhouse.repository.HistoryRepository;
import com.xyblue.myhouse.repository.InventoryRepository;
import com.xyblue.myhouse.repository.RecipeRepository;
import com.xyblue.myhouse.service.AiService;
import com.xyblue.myhouse.service.AttachmentService;
import com.xyblue.myhouse.service.RabbitMqService;
import org.springframework.core.io.Resource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class MyHouseController {
    private final InventoryRepository repository;
    private final HistoryRepository history;
    private final RecipeRepository recipes;
    private final AttachmentService attachments;
    private final AiService aiService;
    private final RabbitMqService mq;

    public MyHouseController(InventoryRepository repository, HistoryRepository history,
                              RecipeRepository recipes, AttachmentService attachments, AiService aiService, RabbitMqService mq) {
        this.repository = repository; this.history = history;
        this.recipes = recipes; this.attachments = attachments; this.aiService = aiService; this.mq = mq;
    }

    @GetMapping("/members")
    public List<Map<String, Object>> members() { return repository.listMembers(); }

    @PostMapping("/members")
    public Map<String, Object> addMember(@RequestBody Map<String, Object> payload) {
        String name = String.valueOf(payload.getOrDefault("name", "")).trim();
        try {
            return repository.createMember(name);
        } catch (IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, ex.getMessage()); }
        catch (DataIntegrityViolationException ex) { throw new ApiException(HttpStatus.CONFLICT, "房间名称已存在"); }
    }

    @PatchMapping("/members/{id}")
    public Map<String, Object> patchMember(@PathVariable long id, @RequestBody Map<String, Object> payload) {
        requireMember(id);
        String name = String.valueOf(payload.getOrDefault("name", "")).trim();
        try {
            return repository.updateMember(id, name);
        } catch (IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, ex.getMessage()); }
        catch (DataIntegrityViolationException ex) { throw new ApiException(HttpStatus.CONFLICT, "房间名称已存在"); }
    }

    @DeleteMapping("/members/{id}")
    public Map<String, Object> deleteMember(@PathVariable long id) {
        requireMember(id);
        if (repository.listMembers().size() <= 1) throw new ApiException(HttpStatus.BAD_REQUEST, "至少保留一个房间");
        repository.deleteMember(id);
        return Map.of("ok", true);
    }

    @GetMapping("/groups")
    public List<Map<String, Object>> groups(@RequestParam(name="owner_id", required=false) Long ownerId) {
        return repository.listGroups(ownerId);
    }

    @PostMapping("/groups")
    public Map<String, Object> addGroup(@RequestBody Map<String, Object> payload) {
        long ownerId = payload.get("owner_id") == null ? 1 : requireId(payload.get("owner_id"), "房间不存在");
        requireMember(ownerId);
        String name = String.valueOf(payload.getOrDefault("name", "")).trim();
        try {
            return repository.createGroup(ownerId, name);
        } catch (IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, ex.getMessage()); }
    }

    @PatchMapping("/groups/{id}")
    public Map<String, Object> patchGroup(@PathVariable long id, @RequestBody Map<String, Object> payload) {
        if (repository.getGroup(id) == null) throw new ApiException(HttpStatus.NOT_FOUND, "分组不存在");
        String name = String.valueOf(payload.getOrDefault("name", "")).trim();
        try {
            return repository.updateGroup(id, name);
        } catch (IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, ex.getMessage()); }
    }

    @DeleteMapping("/groups/{id}")
    public Map<String, Object> deleteGroup(@PathVariable long id) {
        if (repository.getGroup(id) == null) throw new ApiException(HttpStatus.NOT_FOUND, "分组不存在");
        repository.deleteGroup(id);
        return Map.of("ok", true);
    }

    @GetMapping("/summary")
    public Map<String, Object> summary(@RequestParam(name="owner_id", required=false) List<Long> ownerIds) {
        return repository.summary(ownerIds == null ? List.of() : ownerIds);
    }

    @GetMapping("/dashboard")
    public Map<String, Object> dashboard() {
        return Map.of(
            "summary", repository.summary(),
            "members", repository.memberSummary(),
            "recent_history", history.list(null, null, 8)
        );
    }

    @GetMapping("/containers")
    public List<Map<String, Object>> containers(@RequestParam(name="owner_id", required=false) Long ownerId) {
        return repository.listContainers(ownerId);
    }

    @PostMapping("/containers")
    public Map<String, Object> addContainer(@RequestBody Map<String, Object> payload) {
        requireName(payload.get("name"), "箱子名称不能为空");
        long ownerId = payload.get("owner_id") == null ? 1 : requireId(payload.get("owner_id"), "房间不存在");
        requireMember(ownerId); payload.put("owner_id", ownerId);
        validateGroup(payload.get("group_id"), ownerId);
        try {
            Map<String, Object> container = repository.createContainer(payload);
            history.record("ADD_CONTAINER", "container", id(container), null, id(container), null, ownerId, "manual",
                "新建箱子「" + container.get("name") + "」", null, container);
            mq.publishEvent("inventory.container.created", Map.of("container", container));
            return container;
        } catch (DataIntegrityViolationException ex) { throw new ApiException(HttpStatus.CONFLICT, "箱子名称已存在"); }
    }

    @PostMapping("/containers/reorder")
    public Map<String, Object> reorderContainers(@RequestBody Map<String, Object> payload) {
        long ownerId = payload.get("owner_id") == null ? 1 : requireId(payload.get("owner_id"), "房间不存在");
        requireMember(ownerId);
        List<Long> ids = longList(payload.get("ids"));
        if (ids.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "排序列表不能为空");
        repository.reorderContainers(ownerId, ids);
        return Map.of("ok", true);
    }

    @PatchMapping("/containers/{id}")
    public Map<String, Object> patchContainer(@PathVariable long id, @RequestBody Map<String, Object> payload) {
        Map<String, Object> before = requireContainer(id);
        long targetOwnerId = payload.containsKey("owner_id") ? requireId(payload.get("owner_id"), "房间不存在") : longValue(before.get("owner_id"));
        if (payload.containsKey("owner_id")) requireMember(targetOwnerId);
        if (payload.containsKey("group_id")) validateGroup(payload.get("group_id"), targetOwnerId);
        try {
            Map<String, Object> after = repository.updateContainer(id, payload);
            history.record("UPDATE_CONTAINER", "container", id, null, id, null, longValue(after.get("owner_id")), "manual",
                "修改箱子「" + after.get("name") + "」", before, after);
            mq.publishEvent("inventory.container.updated", Map.of("before", before, "container", after));
            return after;
        } catch (DataIntegrityViolationException ex) { throw new ApiException(HttpStatus.CONFLICT, "箱子名称已存在"); }
    }

    @DeleteMapping("/containers/{id}")
    public Map<String, Object> deleteContainer(@PathVariable long id) {
        Map<String, Object> before = requireContainer(id);
        try {
            repository.deleteContainer(id);
            history.record("DELETE_CONTAINER", "container", id, null, id, null, longValue(before.get("owner_id")), "manual",
                "删除空箱子「" + before.get("name") + "」", before, null);
            mq.publishEvent("inventory.container.deleted", Map.of("container", before));
            return Map.of("ok", true);
        } catch (IllegalStateException ex) { throw new ApiException(HttpStatus.CONFLICT, ex.getMessage()); }
    }

    @GetMapping("/items")
    public List<Map<String, Object>> items(@RequestParam(defaultValue="") String q,
        @RequestParam(name="container_id", required=false) Long containerId,
        @RequestParam(name="owner_id", required=false) List<Long> ownerIds) {
        if (q.length() > 200) throw new ApiException(HttpStatus.BAD_REQUEST, "搜索关键词过长");
        return repository.listItems(q, containerId, ownerIds == null ? List.of() : ownerIds, 500);
    }

    @PostMapping("/items")
    public Map<String, Object> addItem(@RequestBody Map<String, Object> payload) {
        normalizeItemPayload(payload);
        Map<String, Object> item = repository.createItem(payload);
        history.record("ADD_ITEM", "item", id(item), id(item), idValue(item.get("container_id")), null,
            idValue(item.get("owner_id")), "manual", "新增物品「" + item.get("name") + "」到「" + item.get("container_name") + "」", null, item);
        mq.publishEvent("inventory.item.created", Map.of("item", item));
        return item;
    }

    @PatchMapping("/items/{id}")
    public Map<String, Object> patchItem(@PathVariable long id, @RequestBody Map<String, Object> payload) {
        Map<String, Object> before = requireItem(id);
        if (payload.containsKey("container_id") && payload.get("container_id") != null) requireContainer(requireId(payload.get("container_id"), "目标箱子不存在"));
        Map<String, Object> after = repository.updateItem(id, payload);
        boolean moved = longValue(before.get("container_id")) != longValue(after.get("container_id"));
        history.record(moved ? "MOVE_ITEM" : "UPDATE_ITEM", "item", id, id,
            idValue(after.get("container_id")), moved ? idValue(before.get("container_id")) : null,
            idValue(after.get("owner_id")), "manual",
            moved ? "移动「" + after.get("name") + "」：" + before.get("container_name") + " → " + after.get("container_name") : "修改物品「" + after.get("name") + "」",
            before, after);
        mq.publishEvent(moved ? "inventory.item.moved" : "inventory.item.updated", Map.of("before", before, "item", after));
        return after;
    }

    @DeleteMapping("/items/{id}")
    public Map<String, Object> deleteItem(@PathVariable long id) {
        Map<String, Object> before = new LinkedHashMap<>(requireItem(id));
        before.put("_attachments", attachments.snapshot(id));
        repository.deleteItem(id);
        history.record("DELETE_ITEM", "item", id, id, idValue(before.get("container_id")), null, idValue(before.get("owner_id")), "manual",
            "删除物品「" + before.get("name") + "」", before, null);
        mq.publishEvent("inventory.item.deleted", Map.of("item", before));
        return Map.of("ok", true);
    }

    @GetMapping("/history")
    public List<Map<String, Object>> history(@RequestParam(name="container_id", required=false) Long containerId,
        @RequestParam(name="owner_id", required=false) Long ownerId,
        @RequestParam(defaultValue="50") int limit) { return history.list(containerId, ownerId, limit); }

    @PostMapping("/history/{id}/undo")
    public Map<String, Object> undo(@PathVariable long id) {
        try {
            Map<String, Object> result = history.undo(id);
            mq.publishEvent("inventory.history.undone", Map.of("history_id", id));
            return result;
        } catch (IllegalArgumentException | IllegalStateException ex) { throw new ApiException(HttpStatus.CONFLICT, ex.getMessage()); }
    }

    @GetMapping("/items/{itemId}/attachments")
    public List<Map<String, Object>> itemAttachments(@PathVariable long itemId) { requireItem(itemId); return attachments.list(itemId); }

    @PostMapping(value="/items/{itemId}/attachments", consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> addAttachment(@PathVariable long itemId, @RequestPart("file") MultipartFile file) {
        Map<String, Object> item = requireItem(itemId);
        try {
            Map<String, Object> saved = attachments.save(itemId, file);
            history.record("ADD_ATTACHMENT", "attachment", idValue(saved.get("id")), itemId, idValue(item.get("container_id")), null, idValue(item.get("owner_id")), "manual",
                "给「" + item.get("name") + "」添加附件「" + saved.get("filename") + "」", null, saved);
            return saved;
        } catch (IOException | IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, ex.getMessage()); }
    }

    @GetMapping("/containers/{containerId}/attachments")
    public List<Map<String, Object>> containerAttachments(@PathVariable long containerId) {
        requireContainer(containerId);
        return attachments.listByContainer(containerId);
    }

    @PostMapping(value="/containers/{containerId}/attachments", consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> addContainerAttachment(@PathVariable long containerId, @RequestPart("file") MultipartFile file) {
        Map<String, Object> container = requireContainer(containerId);
        try {
            Map<String, Object> saved = attachments.saveForContainer(containerId, file);
            history.record("ADD_ATTACHMENT", "attachment", idValue(saved.get("id")), null, containerId, null,
                idValue(container.get("owner_id")), "manual",
                "给箱子「" + container.get("name") + "」添加照片「" + saved.get("filename") + "」", null, saved);
            return saved;
        } catch (IOException | IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, ex.getMessage()); }
    }

    @GetMapping("/attachments/{id}/content")
    public ResponseEntity<Resource> attachmentContent(@PathVariable long id) {
        try {
            Map<String, Object> meta = attachments.get(id); Resource resource = attachments.resource(id);
            if (meta == null || resource == null) throw new ApiException(HttpStatus.NOT_FOUND, "附件不存在");
            MediaType type; try { type = MediaType.parseMediaType(String.valueOf(meta.get("mime_type"))); } catch (Exception ex) { type = MediaType.APPLICATION_OCTET_STREAM; }
            // Uploaded HTML/SVG must not execute on the application's authenticated origin.
            String mime = type.getType() + "/" + type.getSubtype();
            boolean inline = java.util.Set.of("image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp",
                "video/mp4", "video/webm", "video/ogg", "audio/mpeg", "audio/ogg", "audio/wav").contains(mime);
            return ResponseEntity.ok().contentType(type)
                .header("Content-Security-Policy", "sandbox")
                .header(HttpHeaders.CONTENT_DISPOSITION, (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + java.net.URLEncoder.encode(String.valueOf(meta.get("filename")), java.nio.charset.StandardCharsets.UTF_8))
                .body(resource);
        } catch (IOException ex) { throw new ApiException(HttpStatus.NOT_FOUND, "附件文件不存在"); }
    }

    @DeleteMapping("/attachments/{id}")
    public Map<String, Object> deleteAttachment(@PathVariable long id) {
        try { if (!attachments.delete(id)) throw new ApiException(HttpStatus.NOT_FOUND, "附件不存在"); return Map.of("ok", true); }
        catch (IOException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, "删除附件失败"); }
    }

    @GetMapping("/settings") public Map<String, Object> getSettings() { return aiService.getSettings(false); }
    @PostMapping("/settings") public Map<String, Object> saveSettings(@RequestBody Map<String, Object> payload) { return aiService.saveSettings(payload); }
    @GetMapping("/mq/status") public Map<String, Object> mqStatus() { return mq.status(); }

    @GetMapping("/recipes")
    public List<Map<String, Object>> recipes() { return recipes.list(); }

    @PostMapping("/recipes")
    public Map<String, Object> addRecipe(@RequestBody Map<String, Object> payload) {
        requireName(payload.get("title"), "菜谱标题不能为空");
        return recipes.create(payload);
    }

    @PatchMapping("/recipes/{id}")
    public Map<String, Object> patchRecipe(@PathVariable long id, @RequestBody Map<String, Object> payload) {
        if (recipes.get(id) == null) throw new ApiException(HttpStatus.NOT_FOUND, "菜谱不存在");
        if (payload.containsKey("title")) requireName(payload.get("title"), "菜谱标题不能为空");
        return recipes.update(id, payload);
    }

    @DeleteMapping("/recipes/{id}")
    public Map<String, Object> deleteRecipe(@PathVariable long id) {
        if (!recipes.delete(id)) throw new ApiException(HttpStatus.NOT_FOUND, "菜谱不存在");
        return Map.of("ok", true);
    }

    @GetMapping("/recipes/{id}/attachments")
    public List<Map<String, Object>> recipeAttachments(@PathVariable long id) {
        if (recipes.get(id) == null) throw new ApiException(HttpStatus.NOT_FOUND, "菜谱不存在");
        return attachments.listByRecipe(id);
    }

    @PostMapping(value="/recipes/{id}/attachments", consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> addRecipeAttachment(@PathVariable long id, @RequestPart("file") MultipartFile file) {
        if (recipes.get(id) == null) throw new ApiException(HttpStatus.NOT_FOUND, "菜谱不存在");
        try {
            return attachments.saveForRecipe(id, file);
        } catch (IOException | IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, ex.getMessage()); }
    }

    @PostMapping("/chat")
    public Map<String, Object> chat(@RequestBody Map<String, Object> payload) {
        String message = String.valueOf(payload.getOrDefault("message", "")).trim();
        if (message.isBlank() || message.length() > 2000) throw new ApiException(HttpStatus.BAD_REQUEST, "消息不能为空或过长");
        List<Long> ownerIds = longList(payload.get("owner_ids"));
        try { return aiService.chat(message, ownerIds); }
        catch (IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, ex.getMessage()); }
    }

    @PostMapping("/ai/execute")
    public Map<String, Object> executeAi(@RequestBody Map<String, Object> payload) {
        Map<String, Object> action = map(payload.get("action"));
        if (action.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "缺少 AI 操作");
        List<Long> ownerIds = longList(payload.get("owner_ids"));
        try {
            Map<String, Object> result = aiService.executeAction(action, ownerIds);
            mq.publishEvent("inventory.ai.executed", Map.of("via", "ai", "action", action, "result", result));
            return result;
        } catch (IllegalArgumentException | DataIntegrityViolationException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, ex.getMessage()); }
    }

    private void normalizeItemPayload(Map<String, Object> payload) {
        requireName(payload.get("name"), "物品名称不能为空");
        long containerId = requireId(payload.get("container_id"), "目标箱子不存在"); requireContainer(containerId);
        payload.putIfAbsent("quantity", 1); payload.putIfAbsent("quantity_text", ""); payload.putIfAbsent("condition", "正常"); payload.putIfAbsent("notes", ""); payload.putIfAbsent("tags", "");
    }

    private Map<String, Object> requireContainer(long id) { Map<String,Object> value=repository.getContainer(id); if(value==null) throw new ApiException(HttpStatus.NOT_FOUND,"箱子不存在"); return value; }
    private Map<String, Object> requireItem(long id) { Map<String,Object> value=repository.getItem(id); if(value==null) throw new ApiException(HttpStatus.NOT_FOUND,"物品不存在"); return value; }
    private void requireMember(long id) { if(repository.getMember(id)==null) throw new ApiException(HttpStatus.BAD_REQUEST,"房间不存在"); }
    private void validateGroup(Object groupId, long ownerId) {
        if (groupId == null || "0".equals(String.valueOf(groupId)) || String.valueOf(groupId).isBlank()) return;
        long gid = requireId(groupId, "分组不存在");
        Map<String, Object> grp = repository.getGroup(gid);
        if (grp == null) throw new ApiException(HttpStatus.BAD_REQUEST, "分组不存在");
        if (longValue(grp.get("owner_id")) != ownerId) throw new ApiException(HttpStatus.BAD_REQUEST, "分组不属于该房间");
    }
    private static void requireName(Object value,String message){ if(value==null||String.valueOf(value).trim().isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST,message); }
    private static long requireId(Object value,String message){ try{return longValue(value);}catch(Exception ex){throw new ApiException(HttpStatus.BAD_REQUEST,message);} }
    private static long id(Map<String,Object> map){return longValue(map.get("id"));}
    private static Long idValue(Object value){return value==null?null:longValue(value);}
    private static long longValue(Object value){return value instanceof Number n?n.longValue():Long.parseLong(String.valueOf(value));}

    private static Map<String,Object> map(Object raw){ Map<String,Object> result=new LinkedHashMap<>(); if(raw instanceof Map<?,?> m)m.forEach((k,v)->result.put(String.valueOf(k),v)); return result; }
    private static List<Long> longList(Object raw){ List<Long> result=new ArrayList<>(); if(raw instanceof List<?> list)for(Object x:list)try{result.add(longValue(x));}catch(Exception ignored){} else if(raw!=null)try{result.add(longValue(raw));}catch(Exception ignored){} return result; }
}
