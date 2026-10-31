package com.xyblue.myhouse.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class AttachmentService {
    private static final long MAX_FILE_BYTES = 200L * 1024 * 1024;
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final Path root;

    public AttachmentService(JdbcTemplate jdbc, ObjectMapper objectMapper, Path myhouseDataDir) throws IOException {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.root = myhouseDataDir.resolve("attachments");
        Files.createDirectories(root);
    }

    public List<Map<String, Object>> list(long itemId) {
        return jdbc.queryForList("SELECT id,item_id,kind,filename,mime_type,size_bytes,created_at FROM attachments WHERE item_id=? ORDER BY id DESC", itemId);
    }

    public List<Map<String, Object>> listByContainer(long containerId) {
        return jdbc.queryForList("SELECT id,item_id,container_id,kind,filename,mime_type,size_bytes,created_at FROM attachments WHERE container_id=? ORDER BY id DESC", containerId);
    }

    public List<Map<String, Object>> listByRecipe(long recipeId) {
        return jdbc.queryForList("SELECT id,item_id,container_id,recipe_id,kind,filename,mime_type,size_bytes,created_at FROM attachments WHERE recipe_id=? ORDER BY id ASC", recipeId);
    }

    public List<Map<String, Object>> snapshot(long itemId) {
        return jdbc.queryForList("SELECT id,item_id,kind,filename,stored_name,mime_type,size_bytes,created_at FROM attachments WHERE item_id=? ORDER BY id DESC", itemId);
    }

    public Map<String, Object> save(long itemId, MultipartFile file) throws IOException {
        return save(itemId, null, null, "item-" + itemId, file);
    }

    public Map<String, Object> saveForContainer(long containerId, MultipartFile file) throws IOException {
        return save(null, containerId, null, "container-" + containerId, file);
    }

    public Map<String, Object> saveForRecipe(long recipeId, MultipartFile file) throws IOException {
        return save(null, null, recipeId, "recipe-" + recipeId, file);
    }

    private Map<String, Object> save(Long itemId, Long containerId, Long recipeId, String prefix, MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("附件为空");
        if (file.getSize() > MAX_FILE_BYTES) throw new IllegalArgumentException("单个附件不能超过 200MB");
        String original = sanitizeFilename(file.getOriginalFilename());
        String ext = extension(original);
        String stored = prefix + "/" + UUID.randomUUID() + ext;
        Path target = root.resolve(stored).normalize();
        if (!target.startsWith(root)) throw new IllegalArgumentException("非法附件路径");
        Files.createDirectories(target.getParent());
        Files.copy(file.getInputStream(), target, StandardCopyOption.REPLACE_EXISTING);
        String mime = file.getContentType() == null ? "application/octet-stream" : file.getContentType();
        String kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "file";
        KeyHolder key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO attachments(item_id,container_id,recipe_id,kind,filename,stored_name,mime_type,size_bytes) VALUES (?,?,?,?,?,?,?,?)",
                Statement.RETURN_GENERATED_KEYS);
            ps.setObject(1, itemId); ps.setObject(2, containerId); ps.setObject(3, recipeId); ps.setString(4, kind); ps.setString(5, original);
            ps.setString(6, stored); ps.setString(7, mime); ps.setLong(8, file.getSize()); return ps;
        }, key);
        Number id = key.getKey();
        if (id == null) throw new IllegalStateException("附件元数据写入失败");
        return get(id.longValue());
    }

    public Map<String, Object> get(long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM attachments WHERE id=?", id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Resource resource(long id) throws IOException {
        Map<String, Object> meta = get(id);
        if (meta == null) return null;
        Path path = root.resolve(String.valueOf(meta.get("stored_name"))).normalize();
        if (!path.startsWith(root) || !Files.exists(path)) return null;
        return new UrlResource(path.toUri());
    }

    public boolean delete(long id) throws IOException {
        Map<String, Object> meta = get(id);
        if (meta == null) return false;
        Path path = root.resolve(String.valueOf(meta.get("stored_name"))).normalize();
        jdbc.update("DELETE FROM attachments WHERE id=?", id);
        if (path.startsWith(root)) Files.deleteIfExists(path);
        return true;
    }

    /**
     * 把已存量的图片附件统一裁剪为 1:1 正方形封面（居中裁剪，不做任何识别）。
     * 只处理 jpg/jpeg/png；其它格式（webp/gif 等）跳过以免损坏文件。原地覆盖，
     * 不改动 attachments 元数据，因此撤销历史里的引用仍然有效。
     */

    /**
     * 启动时清理孤儿附件文件：磁盘上有但 DB 已无对应记录。
     * 通过比对 attachments 表的 stored_name 集合与磁盘文件，过滤出多余文件。
     *
     * 注意：删除物品时附件元数据行会被外键级联删掉，文件本体留在磁盘以支持撤销
     * （撤销时由 DELETE_ITEM 的 before_json 快照把元数据行还原）。因此这里必须跳过
     * 被「未撤销的 DELETE_ITEM 快照」引用过的 stored_name，否则重启后清理会把文件删掉，
     * 撤销时元数据虽然恢复但图片会 404。
     */
    public int purgeOrphanFiles() {
        try (java.util.stream.Stream<Path> walk = Files.walk(root)) {
            java.util.Set<String> referenced = new java.util.HashSet<>();
            for (Map<String, Object> row : jdbc.queryForList("SELECT stored_name FROM attachments")) {
                Object name = row.get("stored_name");
                if (name != null) referenced.add(String.valueOf(name));
            }
            referenced.addAll(pendingUndoAttachmentNames());
            int[] counter = {0};
            walk.filter(Files::isRegularFile).forEach(path -> {
                String rel = root.relativize(path).toString().replace('\\', '/');
                if (!referenced.contains(rel)) {
                    try { Files.deleteIfExists(path); counter[0]++; }
                    catch (IOException ignored) {}
                }
            });
            return counter[0];
        } catch (IOException ex) {
            org.slf4j.LoggerFactory.getLogger(AttachmentService.class)
                .warn("purgeOrphanFiles failed: {}", ex.getMessage());
            return 0;
        }
    }

    /**
     * 收集所有「未撤销的 DELETE_ITEM」历史快照中 _attachments 引用的 stored_name。
     * 这些文件虽然 DB 元数据已被级联删除，但仍是撤销的依据，不能当作孤儿清理。
     */
    private java.util.Set<String> pendingUndoAttachmentNames() {
        java.util.Set<String> names = new java.util.HashSet<>();
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT before_json FROM operation_history WHERE action_type = 'DELETE_ITEM' AND undone_at IS NULL AND before_json IS NOT NULL");
        for (Map<String, Object> row : rows) {
            Object raw = row.get("before_json");
            if (raw == null) continue;
            try {
                JsonNode attachments = objectMapper.readTree(String.valueOf(raw)).path("_attachments");
                if (attachments.isArray()) {
                    for (JsonNode item : attachments) {
                        JsonNode stored = item.path("stored_name");
                        if (stored.isTextual() && !stored.asText().isBlank()) names.add(stored.asText());
                    }
                }
            } catch (Exception ignored) {
                // 快照损坏时保守跳过该条，不影响其它引用
            }
        }
        return names;
    }

    private static String sanitizeFilename(String value) {
        String name = value == null || value.isBlank() ? "attachment" : Path.of(value).getFileName().toString();
        return name.replaceAll("[\\r\\n\\t]", "_").replaceAll("[\\\\/:*?\"<>|]", "_");
    }
    private static String extension(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 1 || dot == name.length()-1) return "";
        String ext = name.substring(dot).toLowerCase();
        return ext.length() <= 12 ? ext : "";
    }
}
