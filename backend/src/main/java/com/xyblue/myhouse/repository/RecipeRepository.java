package com.xyblue.myhouse.repository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 炒菜中心：食谱（标题 + 文字步骤 + 图片/视频附件）。
 * 附件复用 attachments 表，通过 recipe_id 关联。
 */
@Repository
public class RecipeRepository {
    private static final Set<String> WRITABLE = Set.of("title", "steps");
    private final JdbcTemplate jdbc;

    public RecipeRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public List<Map<String, Object>> list() {
        return jdbc.queryForList("""
            SELECT r.*,
                   (SELECT COUNT(*) FROM attachments a WHERE a.recipe_id = r.id) AS attachment_count,
                   (SELECT a.id FROM attachments a WHERE a.recipe_id = r.id ORDER BY a.id ASC LIMIT 1) AS cover_attachment_id
            FROM recipes r ORDER BY r.id DESC
            """);
    }

    public Map<String, Object> get(long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT r.*,
                   (SELECT COUNT(*) FROM attachments a WHERE a.recipe_id = r.id) AS attachment_count,
                   (SELECT a.id FROM attachments a WHERE a.recipe_id = r.id ORDER BY a.id ASC LIMIT 1) AS cover_attachment_id
            FROM recipes r WHERE r.id = ?
            """, id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Transactional
    public Map<String, Object> create(Map<String, Object> data) {
        String title = InventoryRepository.string(data.get("title")).trim();
        String steps = InventoryRepository.string(data.get("steps")).trim();
        KeyHolder key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            java.sql.PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO recipes(title, steps) VALUES (?, ?)", java.sql.Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, title);
            ps.setString(2, steps);
            return ps;
        }, key);
        Number id = key.getKey();
        return id == null ? null : get(id.longValue());
    }

    @Transactional
    public Map<String, Object> update(long id, Map<String, Object> changes) {
        List<String> sets = new ArrayList<>();
        List<Object> args = new ArrayList<>();
        changes.forEach((key, raw) -> {
            if (!WRITABLE.contains(key)) return;
            sets.add(key + "=?");
            args.add(InventoryRepository.string(raw).trim());
        });
        if (sets.isEmpty()) return get(id);
        sets.add("updated_at=CURRENT_TIMESTAMP");
        args.add(id);
        jdbc.update("UPDATE recipes SET " + String.join(",", sets) + " WHERE id=?", args.toArray());
        return get(id);
    }

    public boolean delete(long id) { return jdbc.update("DELETE FROM recipes WHERE id=?", id) > 0; }
}
