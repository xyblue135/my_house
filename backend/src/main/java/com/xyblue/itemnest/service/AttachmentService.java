package com.xyblue.itemnest.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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
    private final Path root;

    public AttachmentService(JdbcTemplate jdbc, Path itemNestDataDir) throws IOException {
        this.jdbc = jdbc;
        this.root = itemNestDataDir.resolve("attachments");
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
     * 启动时清理孤儿附件文件：磁盘上有但 DB 已无对应记录。
     * 通过比对 attachments 表的 stored_name 集合与磁盘文件，过滤出多余文件。
     */
    public int purgeOrphanFiles() {
        try (java.util.stream.Stream<Path> walk = Files.walk(root)) {
            java.util.Set<String> referenced = new java.util.HashSet<>();
            for (Map<String, Object> row : jdbc.queryForList("SELECT stored_name FROM attachments")) {
                Object name = row.get("stored_name");
                if (name != null) referenced.add(String.valueOf(name));
            }
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
