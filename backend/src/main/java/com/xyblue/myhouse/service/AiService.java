package com.xyblue.myhouse.service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.xyblue.myhouse.repository.HistoryRepository;
import com.xyblue.myhouse.repository.InventoryRepository;

import org.springframework.stereotype.Service;

@Service
public class AiService {
    private static final String DEFAULT_BASE_URL = "https://api.openai.com/v1";
    private static final String DEFAULT_MODEL = "auto";
    private static final int MAX_AI_CONTEXT_ITEMS = 24;

    private final InventoryRepository repository;

    private final HistoryRepository history;
    private final AttachmentService attachments;
    private final ObjectMapper objectMapper;
    private final Path settingsPath;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public AiService(InventoryRepository repository, HistoryRepository history, AttachmentService attachments,
                     ObjectMapper objectMapper, Path myhouseDataDir) {
        this.repository = repository; this.history = history; this.attachments = attachments; this.objectMapper = objectMapper;
        this.settingsPath = myhouseDataDir.resolve("ai_settings.json");
    }

    public Map<String, Object> getSettings(boolean includeKey) {
        Map<String, Object> stored = loadFileSettings();
        String key = firstNonBlank(System.getenv("MYHOUSE_AI_API_KEY"), System.getenv("OPENAI_API_KEY"), string(stored.get("api_key")), "");
        String baseUrl = firstNonBlank(System.getenv("MYHOUSE_AI_BASE_URL"), System.getenv("OPENAI_BASE_URL"), string(stored.get("base_url")), DEFAULT_BASE_URL);
        String model = firstNonBlank(System.getenv("MYHOUSE_AI_MODEL"), System.getenv("OPENAI_MODEL"), string(stored.get("model")), DEFAULT_MODEL);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("base_url", baseUrl); result.put("model", model); result.put("has_api_key", !key.isBlank());
        if (includeKey) result.put("api_key", key);
        return result;
    }

    public synchronized Map<String, Object> saveSettings(Map<String, Object> input) {
        Map<String, Object> current = new LinkedHashMap<>(loadFileSettings());
        if (nonBlank(input.get("base_url"))) current.put("base_url", string(input.get("base_url")).replaceAll("/+$", ""));
        if (nonBlank(input.get("model"))) current.put("model", string(input.get("model")).trim());
        if (nonBlank(input.get("api_key"))) current.put("api_key", string(input.get("api_key")).trim());
        try {
            Files.createDirectories(settingsPath.getParent());
            Files.writeString(settingsPath, objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(current), StandardCharsets.UTF_8);
        } catch (Exception ex) { throw new IllegalStateException("保存 AI 设置失败: " + ex.getMessage(), ex); }
        return getSettings(false);
    }

    public Map<String, Object> chat(String message, List<Long> ownerIds) {
        List<Long> scope = sanitizeScope(ownerIds);
        Map<String, Object> settings = getSettings(true);
        String apiKey = string(settings.get("api_key"));
        if (apiKey.isBlank()) return localFallback(message, scope);

        String system = """
            你是 My House 家庭物品数据库助手。你必须严格遵守用户选择的查询范围。
            数据层已经先按家庭成员范围过滤，再做本地 FTS5 检索；你只能依据下面的候选数据回答，不得假装看到了范围外的数据。
            查询时优先回答：归属成员、箱子、数量、状态、备注。此应用不再管理有效期，不得生成相关操作。
            如果候选不足，明确说没有找到足够匹配，不要编造。

            重要限制：My House 当前大语言模型链路不支持视觉。图片和附件只保存在本地，下面的上下文不会包含图片、图片 Base64、文件路径、PDF/附件正文；绝不能声称读取过附件内容。

            修改数据库时只生成一个待确认 action，不能说已经执行。允许的 action：
            {"type":"add_item","data":{"name":"...","container_id":1,"quantity":1,"quantity_text":"","condition":"正常","notes":"","tags":""}}
            {"type":"update_item","item_id":1,"data":{"name":"..."}}
            {"type":"move_item","item_id":1,"container_id":2}
            {"type":"delete_item","item_id":1}
            {"type":"add_container","data":{"name":"...","notes":"","owner_id":1}}
            任何 action 都必须位于当前家庭成员 Scope 中；不确定目标时 action=null 并追问。

            严格只输出 JSON：{"reply":"中文回复","action":null或action对象}
            """ + buildContext(message, scope);

        Map<String, Object> payload = Map.of(
            "model", settings.get("model"),
            "messages", List.of(Map.of("role", "system", "content", system), Map.of("role", "user", "content", message)),
            "temperature", 0.1
        );

        try {
            String url = string(settings.get("base_url")).replaceAll("/+$", "") + "/chat/completions";
            HttpRequest request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(45))
                .header("Authorization", "Bearer " + apiKey).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload), StandardCharsets.UTF_8)).build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                org.slf4j.LoggerFactory.getLogger(AiService.class)
                    .warn("AI 接口返回 HTTP {} (model={}): {}",
                        response.statusCode(), settings.get("model"),
                        response.body() == null ? "" : response.body().substring(0, Math.min(200, response.body().length())));
                throw new IllegalStateException("HTTP " + response.statusCode());
            }
            JsonNode body = objectMapper.readTree(response.body());
            Map<String, Object> result = extractJson(body.path("choices").path(0).path("message").path("content").asText(""));
            result.putIfAbsent("reply", ""); result.putIfAbsent("action", null); result.put("mode", "ai");
            return result;
        } catch (Exception ex) {
            org.slf4j.LoggerFactory.getLogger(AiService.class)
                .warn("AI 接口调用失败，降级到本地 FTS5 检索: {}", ex.getMessage());
            Map<String, Object> fallback = localFallback(message, scope);
            fallback.put("reply", fallback.get("reply") + "\n\nAI 接口调用失败，已自动降级到关键词检索。");
            return fallback;
        }
    }

    public Map<String, Object> executeAction(Map<String, Object> action, List<Long> ownerIds) {
        List<Long> scope = sanitizeScope(ownerIds);
        String type = string(action.get("type"));
        switch (type) {
            case "add_item" -> {
                Map<String, Object> data = map(action.get("data"));
                require(nonBlank(data.get("name")) && data.get("container_id") != null, "新增物品缺少名称或箱子");
                Map<String, Object> container = requireContainerInScope(number(data.get("container_id")).longValue(), scope);
                normalizeItemDefaults(data);
                Map<String, Object> item = repository.createItem(data);
                history.record("ADD_ITEM", "item", id(item), id(item), idValue(item.get("container_id")), null, idValue(item.get("owner_id")), "ai",
                    "AI 新增物品「" + item.get("name") + "」到「" + container.get("name") + "」", null, item);
                return Map.of("message", "已新增「" + item.get("name") + "」到「" + item.get("container_name") + "」", "item", item);
            }
            case "update_item" -> {
                long itemId = number(action.get("item_id")).longValue(); Map<String, Object> before = requireItemInScope(itemId, scope);
                Map<String, Object> data = map(action.get("data"));
                if (data.containsKey("container_id")) requireContainerInScope(number(data.get("container_id")).longValue(), scope);
                Map<String, Object> item = repository.updateItem(itemId, data);
                history.record("UPDATE_ITEM", "item", itemId, itemId, idValue(item.get("container_id")), null, idValue(item.get("owner_id")), "ai",
                    "AI 修改物品「" + item.get("name") + "」", before, item);
                return Map.of("message", "已更新「" + item.get("name") + "」", "item", item);
            }
            case "move_item" -> {
                long itemId = number(action.get("item_id")).longValue(); long containerId = number(action.get("container_id")).longValue();
                Map<String, Object> before = requireItemInScope(itemId, scope); requireContainerInScope(containerId, scope);
                Map<String, Object> item = repository.updateItem(itemId, Map.of("container_id", containerId));
                history.record("MOVE_ITEM", "item", itemId, itemId, containerId, idValue(before.get("container_id")), idValue(item.get("owner_id")), "ai",
                    "AI 移动「" + item.get("name") + "」：" + before.get("container_name") + " → " + item.get("container_name"), before, item);
                return Map.of("message", "已把「" + item.get("name") + "」移动到「" + item.get("container_name") + "」", "item", item);
            }
            case "delete_item" -> {
                long itemId = number(action.get("item_id")).longValue(); Map<String, Object> item = new LinkedHashMap<>(requireItemInScope(itemId, scope));
                item.put("_attachments", attachments.snapshot(itemId));
                repository.deleteItem(itemId);
                history.record("DELETE_ITEM", "item", itemId, itemId, idValue(item.get("container_id")), null, idValue(item.get("owner_id")), "ai",
                    "AI 删除物品「" + item.get("name") + "」", item, null);
                return Map.of("message", "已删除「" + item.get("name") + "」");
            }
            case "add_container" -> {
                Map<String, Object> data = map(action.get("data")); require(nonBlank(data.get("name")), "箱子名称不能为空");
                long ownerId = data.get("owner_id") == null ? (scope.isEmpty() ? 1L : scope.getFirst()) : number(data.get("owner_id")).longValue();
                require(scope.isEmpty() || scope.contains(ownerId), "AI 不能在当前 Scope 之外创建箱子");
                require(repository.getMember(ownerId) != null, "家庭成员不存在"); data.put("owner_id", ownerId); data.putIfAbsent("notes", "");
                Map<String, Object> container = repository.createContainer(data);
                history.record("ADD_CONTAINER", "container", id(container), null, id(container), null, ownerId, "ai",
                    "AI 新增箱子「" + container.get("name") + "」", null, container);
                return Map.of("message", "已新增箱子「" + container.get("name") + "」", "container", container);
            }
            default -> throw new IllegalArgumentException("不支持的 AI 操作");
        }
    }

    private Map<String, Object> localFallback(String message, List<Long> scope) {
        if (isContainerListIntent(message)) {
            StringBuilder reply = new StringBuilder("当前范围的箱子：\n");
            for (Map<String, Object> member : scopedMembers(scope)) {
                for (Map<String, Object> container : repository.listContainers(id(member))) {
                    reply.append("• ").append(container.get("name")).append("（").append(member.get("name"))
                        .append("）：").append(container.get("item_count")).append(" 种物品\n");
                }
            }
            return response(reply.toString().stripTrailing(), null, "local");
        }
        List<Map<String, Object>> matches = repository.listItems(message, null, scope, 8);
        if (isConditionIntent(message) && matches.isEmpty()) {
            matches = repository.listItems("", null, scope, 100).stream()
                .filter(item -> nonBlank(item.get("condition")) && !"正常".equals(string(item.get("condition")))).limit(8).toList();
        }
        if (matches.isEmpty()) return response("关键词检索没有找到匹配物品。可以换一个关键词，或调整上方的查找范围。", null, "local");
        StringBuilder reply = new StringBuilder("关键词检索找到：\n");
        for (Map<String, Object> item : matches) {
            Object qty = nonBlank(item.get("quantity_text")) ? item.get("quantity_text") : item.get("quantity"); if (qty == null) qty = "未记录";
            reply.append("• ").append(item.get("name")).append("（").append(item.get("owner_name")).append("）：在「")
                .append(item.get("container_name")).append("」，数量 ").append(qty);
            if (nonBlank(item.get("condition")) && !"正常".equals(item.get("condition"))) reply.append("，状态 ").append(item.get("condition"));
            reply.append('\n');
        }
        return response(reply.toString().stripTrailing(), null, "local");
    }

    private List<Map<String, Object>> scopedMembers(List<Long> scope) {
        return repository.listMembers().stream().filter(member -> scope.isEmpty() || scope.contains(id(member))).toList();
    }

    private String buildContext(String message, List<Long> scope) {
        StringBuilder out = new StringBuilder("\n当前范围：");
        List<Map<String, Object>> members = scopedMembers(scope);
        out.append(members.stream().map(m -> string(m.get("name")) + "(id=" + m.get("id") + ")").reduce((a,b)->a+"、"+b).orElse("无"));
        out.append("\n可用箱子：\n");
        for (Map<String, Object> member : members) for (Map<String, Object> container : repository.listContainers(id(member)))
            out.append("- container_id=").append(container.get("id")).append(" | ").append(container.get("owner_name")).append("/ ").append(container.get("name")).append('\n');

        List<Map<String, Object>> candidates = repository.listItems(message, null, scope, MAX_AI_CONTEXT_ITEMS);
        if (isConditionIntent(message) && candidates.isEmpty()) {
            candidates = repository.listItems("", null, scope, 100).stream()
                .filter(item -> nonBlank(item.get("condition")) && !"正常".equals(string(item.get("condition")))).limit(MAX_AI_CONTEXT_ITEMS).toList();
        }
        out.append("候选物品（本地检索后最多 ").append(MAX_AI_CONTEXT_ITEMS).append(" 条）：\n");
        if (candidates.isEmpty()) out.append("- 无匹配\n");
        for (Map<String, Object> item : candidates) appendItemContext(out, item);
        return out.toString();
    }

    private static void appendItemContext(StringBuilder lines, Map<String, Object> item) {
        Object qty = nonBlank(item.get("quantity_text")) ? item.get("quantity_text") : item.get("quantity"); if (qty == null) qty = "未记录";
        lines.append("- item_id=").append(item.get("id")).append(" | owner=").append(item.get("owner_name"))
            .append(" | name=").append(item.get("name")).append(" | quantity=").append(qty)
            .append(" | container=").append(item.get("container_name")).append("(id=").append(item.get("container_id")).append(")");
        if (nonBlank(item.get("condition")) && !"正常".equals(item.get("condition"))) lines.append(" | condition=").append(item.get("condition"));
        if (nonBlank(item.get("notes"))) lines.append(" | notes=").append(item.get("notes"));
        if (nonBlank(item.get("tags"))) lines.append(" | tags=").append(item.get("tags"));
        lines.append('\n');
    }

    private static boolean isConditionIntent(String message) {
        return List.of("状态", "异常", "损坏", "坏了", "不正常", "没电").stream().anyMatch(message::contains);
    }
    private static boolean isContainerListIntent(String message) {
        return message.contains("箱子") && List.of("有哪些", "所有", "全部", "列出").stream().anyMatch(message::contains);
    }

    private Map<String, Object> requireItemInScope(long itemId, List<Long> scope) {
        Map<String,Object> item=repository.getItem(itemId); require(item!=null,"物品不存在");
        require(scope.isEmpty() || scope.contains(idValue(item.get("owner_id"))), "该物品不在当前 AI Scope 中"); return item;
    }
    private Map<String, Object> requireContainerInScope(long containerId, List<Long> scope) {
        Map<String,Object> c=repository.getContainer(containerId); require(c!=null,"目标箱子不存在");
        require(scope.isEmpty() || scope.contains(idValue(c.get("owner_id"))), "目标箱子不在当前 AI Scope 中"); return c;
    }
    private List<Long> sanitizeScope(List<Long> values) {
        if(values==null||values.isEmpty()) return List.of();
        require(values.stream().allMatch(id -> id != null && repository.getMember(id) != null), "所选成员已不存在，请重新选择操作范围");
        return values.stream().distinct().toList();
    }

    private Map<String, Object> extractJson(String text) throws Exception {
        String clean = text.trim().replaceFirst("^```(?:json)?\\s*", "").replaceFirst("\\s*```$", "");
        try { return objectMapper.readValue(clean, new TypeReference<>() {}); }
        catch (Exception ignored) { String json=firstJsonObject(clean); if(json==null) throw ignored; return objectMapper.readValue(json,new TypeReference<>(){}); }
    }
    private static String firstJsonObject(String text) {
        int start=-1,depth=0; boolean inString=false,escaped=false;
        for(int i=0;i<text.length();i++){char ch=text.charAt(i);if(inString){if(escaped)escaped=false;else if(ch=='\\')escaped=true;else if(ch=='\"')inString=false;continue;}if(ch=='\"')inString=true;else if(ch=='{'){if(depth++==0)start=i;}else if(ch=='}'&&depth>0&&--depth==0)return text.substring(start,i+1);} return null;
    }
    private Map<String,Object> loadFileSettings(){if(!Files.exists(settingsPath))return Map.of();try{return objectMapper.readValue(Files.readString(settingsPath,StandardCharsets.UTF_8),new TypeReference<>(){});}catch(Exception ex){return Map.of();}}
    private static void normalizeItemDefaults(Map<String,Object> data){data.putIfAbsent("quantity",1);data.putIfAbsent("quantity_text","");data.putIfAbsent("condition","正常");data.putIfAbsent("notes","");data.putIfAbsent("tags","");}
    private static Map<String,Object> response(String reply,Object action,String mode){Map<String,Object> r=new LinkedHashMap<>();r.put("reply",reply);r.put("action",action);r.put("mode",mode);return r;}
    private static Map<String,Object> map(Object value){Map<String,Object> r=new LinkedHashMap<>();if(value instanceof Map<?,?> raw)raw.forEach((k,v)->r.put(String.valueOf(k),v));return r;}
    private static boolean nonBlank(Object value){return value!=null&&!String.valueOf(value).isBlank();}
    private static String string(Object value){return value==null?"":String.valueOf(value);}
    private static Number number(Object value){
        if (value instanceof Number n) return n;
        String text = String.valueOf(value);
        try { return Long.parseLong(text); }
        catch (NumberFormatException ex) { throw new IllegalArgumentException("AI 操作中的 ID 必须是整数，实际收到: " + text); }
    }
    private static String firstNonBlank(String... values){for(String v:values)if(v!=null&&!v.isBlank())return v;return "";}
    private static void require(boolean condition,String message){if(!condition)throw new IllegalArgumentException(message);}
    private static long id(Map<String,Object> map){return number(map.get("id")).longValue();}
    private static Long idValue(Object value){return value==null?null:number(value).longValue();}
}
