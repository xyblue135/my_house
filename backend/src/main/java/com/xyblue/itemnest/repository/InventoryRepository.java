package com.xyblue.itemnest.repository;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class InventoryRepository {
    private static final Set<String> ITEM_FIELDS = Set.of("container_id", "name", "quantity", "quantity_text", "condition", "notes", "tags");
    private static final Set<String> CONTAINER_FIELDS = Set.of("name", "notes", "owner_id", "group_id");
    private final JdbcTemplate jdbc;

    public InventoryRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public List<Map<String, Object>> listMembers() {
        return jdbc.queryForList("SELECT * FROM household_members ORDER BY sort_order, id");
    }

    public Map<String, Object> getMember(long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM household_members WHERE id = ?", id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Map<String, Object> createMember(String name) {
        final String trimmed = name.trim();
        if (trimmed.isEmpty()) throw new IllegalArgumentException("用户名称不能为空");
        KeyHolder key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO household_members(name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM household_members))",
                Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, trimmed);
            return ps;
        }, key);
        return getMember(key.getKey().longValue());
    }

    public Map<String, Object> updateMember(long id, String name) {
        name = name.trim();
        if (name.isEmpty()) throw new IllegalArgumentException("用户名称不能为空");
        jdbc.update("UPDATE household_members SET name = ? WHERE id = ?", name, id);
        return getMember(id);
    }

    /**
     * 删除成员并级联清理其名下所有数据（物品、箱子、生活记录、操作历史）。
     * 物品/箱子的附件、物品生命周期由外键 ON DELETE CASCADE 自动清理，FTS 由 trigger 维护。
     */
    public void deleteMember(long id) {
        jdbc.update("DELETE FROM items WHERE container_id IN (SELECT id FROM containers WHERE owner_id = ?)", id);
        jdbc.update("DELETE FROM containers WHERE owner_id = ?", id);
        jdbc.update("DELETE FROM life_entries WHERE owner_id = ?", id);
        jdbc.update("DELETE FROM operation_history WHERE owner_id = ?", id);
        jdbc.update("DELETE FROM household_members WHERE id = ?", id);
    }

    public List<Map<String, Object>> listGroups(Long ownerId) {
        if (ownerId == null) {
            return jdbc.queryForList("SELECT * FROM container_groups ORDER BY owner_id, sort_order, id");
        }
        return jdbc.queryForList("SELECT * FROM container_groups WHERE owner_id = ? ORDER BY sort_order, id", ownerId);
    }

    public Map<String, Object> getGroup(long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM container_groups WHERE id = ?", id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Map<String, Object> createGroup(long ownerId, String name) {
        final String trimmed = name.trim();
        if (trimmed.isEmpty()) throw new IllegalArgumentException("分组名称不能为空");
        KeyHolder key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO container_groups(owner_id, name, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM container_groups WHERE owner_id = ?))",
                Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, ownerId);
            ps.setString(2, trimmed);
            ps.setLong(3, ownerId);
            return ps;
        }, key);
        return getGroup(key.getKey().longValue());
    }

    public Map<String, Object> updateGroup(long id, String name) {
        name = name.trim();
        if (name.isEmpty()) throw new IllegalArgumentException("分组名称不能为空");
        jdbc.update("UPDATE container_groups SET name = ? WHERE id = ?", name, id);
        return getGroup(id);
    }

    public void deleteGroup(long id) {
        jdbc.update("UPDATE containers SET group_id = NULL WHERE group_id = ?", id);
        jdbc.update("DELETE FROM container_groups WHERE id = ?", id);
    }

    public List<Map<String, Object>> listContainers() { return listContainers(null); }

    public List<Map<String, Object>> listContainers(Long ownerId) {
        String sql = """
            SELECT c.*, m.name AS owner_name, g.name AS group_name, COUNT(i.id) AS item_count,
                   COALESCE(SUM(CASE WHEN i.id IS NULL THEN 0 ELSE COALESCE(i.quantity, 1) END), 0) AS quantity_sum,
                   (SELECT COUNT(*) FROM attachments a WHERE a.container_id = c.id) AS attachment_count,
                   (SELECT a.id FROM attachments a WHERE a.container_id = c.id AND a.kind = 'image' ORDER BY a.id DESC LIMIT 1) AS cover_attachment_id,
                   (SELECT GROUP_CONCAT(x.name, '、') FROM (SELECT i.name FROM items i WHERE i.container_id = c.id ORDER BY i.id ASC) x) AS item_names
            FROM containers c
            JOIN household_members m ON m.id = c.owner_id
            LEFT JOIN container_groups g ON g.id = c.group_id
            LEFT JOIN items i ON i.container_id = c.id
            """ + (ownerId == null ? "" : " WHERE c.owner_id = ?") + " GROUP BY c.id ORDER BY c.owner_id, c.sort_order, c.id";
        return ownerId == null ? jdbc.queryForList(sql) : jdbc.queryForList(sql, ownerId);
    }

    public Map<String, Object> getContainer(long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT c.*, m.name AS owner_name, g.name AS group_name,
                   (SELECT COUNT(*) FROM items i WHERE i.container_id = c.id) AS item_count,
                   (SELECT COALESCE(SUM(COALESCE(i.quantity, 1)),0) FROM items i WHERE i.container_id = c.id) AS quantity_sum,
                   (SELECT COUNT(*) FROM attachments a WHERE a.container_id = c.id) AS attachment_count,
                   (SELECT a.id FROM attachments a WHERE a.container_id = c.id AND a.kind = 'image' ORDER BY a.id DESC LIMIT 1) AS cover_attachment_id,
                   (SELECT GROUP_CONCAT(x.name, '、') FROM (SELECT i.name FROM items i WHERE i.container_id = c.id ORDER BY i.id ASC) x) AS item_names
            FROM containers c
            JOIN household_members m ON m.id = c.owner_id
            LEFT JOIN container_groups g ON g.id = c.group_id
            WHERE c.id = ?
            """, id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Map<String, Object> createContainer(Map<String, Object> data) {
        String name = string(data.get("name")).trim();
        String notes = string(data.get("notes")).trim();
        long ownerId = data.get("owner_id") == null ? 1L : number(data.get("owner_id")).longValue();
        Long groupId = normalizeGroupId(data.get("group_id"));
        KeyHolder key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO containers(name, notes, owner_id, group_id, sort_order) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM containers WHERE owner_id = ?))", Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, name); ps.setString(2, notes); ps.setLong(3, ownerId);
            if (groupId == null) ps.setObject(4, null); else ps.setLong(4, groupId);
            ps.setLong(5, ownerId); return ps;
        }, key);
        return getContainer(key.getKey().longValue());
    }

    public Map<String, Object> updateContainer(long id, Map<String, Object> data) {
        if (data.containsKey("group_id")) data.put("group_id", normalizeGroupId(data.get("group_id")));
        updateDynamic("containers", id, data, CONTAINER_FIELDS);
        refreshFtsForContainer(id);
        return getContainer(id);
    }

    /** group_id 规范化：空值 / 0 / 空串 → null（默认分组）。 */
    private static Long normalizeGroupId(Object value) {
        if (value == null || String.valueOf(value).isBlank() || "0".equals(String.valueOf(value))) return null;
        return number(value).longValue();
    }

    public void reorderContainers(long ownerId, List<Long> ids) {
        for (int i = 0; i < ids.size(); i++) {
            jdbc.update("UPDATE containers SET sort_order = ? WHERE id = ? AND owner_id = ?", i + 1, ids.get(i), ownerId);
        }
    }

    public boolean deleteContainer(long id) {
        Integer used = jdbc.queryForObject("SELECT COUNT(*) FROM items WHERE container_id = ?", Integer.class, id);
        if (used != null && used > 0) throw new IllegalStateException("该箱子里还有物品，请先移动或删除物品");
        return jdbc.update("DELETE FROM containers WHERE id = ?", id) > 0;
    }

    public List<Map<String, Object>> listItems(String query, Long containerId) {
        return listItems(query, containerId, List.of(), false, 500);
    }

    public List<Map<String, Object>> listItems(String query, Long containerId, List<Long> ownerIds, boolean lifecycleOnly, int limit) {
        if (query != null && !query.isBlank()) {
            List<Map<String, Object>> fts = searchItems(query, containerId, ownerIds, lifecycleOnly, limit);
            if (!fts.isEmpty()) return fts;
        }
        return listItemsLike(query, containerId, ownerIds, lifecycleOnly, limit);
    }

    private List<Map<String, Object>> listItemsLike(String query, Long containerId, List<Long> ownerIds, boolean lifecycleOnly, int limit) {
        StringBuilder sql = new StringBuilder("""
            SELECT i.*, c.name AS container_name, c.owner_id, m.name AS owner_name,
                   l.lifecycle_type, l.start_date AS lifecycle_start_date, l.expiry_date,
                   l.remind_days, l.notes AS lifecycle_notes,
                   (SELECT COUNT(*) FROM attachments a WHERE a.item_id = i.id) AS attachment_count,
                   (SELECT a.id FROM attachments a WHERE a.item_id = i.id AND a.kind = 'image' ORDER BY a.id DESC LIMIT 1) AS cover_attachment_id
            FROM items i
            JOIN containers c ON c.id = i.container_id
            JOIN household_members m ON m.id = c.owner_id
            LEFT JOIN item_lifecycle l ON l.item_id = i.id
            WHERE 1=1
            """);
        List<Object> args = new ArrayList<>();
        appendFilters(sql, args, containerId, ownerIds, lifecycleOnly);
        if (query != null && !query.isBlank()) {
            String like = "%" + query.trim() + "%";
            sql.append(" AND (i.name LIKE ? OR i.notes LIKE ? OR i.tags LIKE ? OR i.condition LIKE ? OR c.name LIKE ? OR m.name LIKE ?)");
            args.addAll(List.of(like, like, like, like, like, like));
        }
        sql.append(" ORDER BY i.updated_at DESC, i.id DESC LIMIT ?");
        args.add(Math.max(1, Math.min(limit, 1000)));
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    public List<Map<String, Object>> searchItems(String query, Long containerId, List<Long> ownerIds, boolean lifecycleOnly, int limit) {
        String ftsQuery = buildFtsQuery(query);
        if (ftsQuery.isBlank()) return List.of();
        try {
            StringBuilder sql = new StringBuilder("""
                SELECT i.*, c.name AS container_name, c.owner_id, m.name AS owner_name,
                       l.lifecycle_type, l.start_date AS lifecycle_start_date, l.expiry_date,
                       l.remind_days, l.notes AS lifecycle_notes,
                       (SELECT COUNT(*) FROM attachments a WHERE a.item_id = i.id) AS attachment_count,
                       (SELECT a.id FROM attachments a WHERE a.item_id = i.id AND a.kind = 'image' ORDER BY a.id DESC LIMIT 1) AS cover_attachment_id,
                       bm25(items_fts) AS search_rank
                FROM items_fts
                JOIN items i ON i.id = CAST(items_fts.item_id AS INTEGER)
                JOIN containers c ON c.id = i.container_id
                JOIN household_members m ON m.id = c.owner_id
                LEFT JOIN item_lifecycle l ON l.item_id = i.id
                WHERE items_fts MATCH ?
                """);
            List<Object> args = new ArrayList<>(); args.add(ftsQuery);
            appendFilters(sql, args, containerId, ownerIds, lifecycleOnly);
            sql.append(" ORDER BY bm25(items_fts), i.updated_at DESC LIMIT ?");
            args.add(Math.max(1, Math.min(limit, 200)));
            return jdbc.queryForList(sql.toString(), args.toArray());
        } catch (org.springframework.dao.DataAccessException ex) {
            org.slf4j.LoggerFactory.getLogger(InventoryRepository.class)
                .warn("FTS5 search failed for query '{}', falling back to LIKE: {}", query, ex.getMessage());
            return listItemsLike(query, containerId, ownerIds, lifecycleOnly, limit);
        }
    }

    private void appendFilters(StringBuilder sql, List<Object> args, Long containerId, List<Long> ownerIds, boolean lifecycleOnly) {
        if (containerId != null) { sql.append(" AND i.container_id = ?"); args.add(containerId); }
        if (ownerIds != null && !ownerIds.isEmpty()) {
            sql.append(" AND c.owner_id IN (").append(ownerIds.stream().map(x -> "?").collect(Collectors.joining(","))).append(")");
            args.addAll(ownerIds);
        }
        if (lifecycleOnly) sql.append(" AND l.item_id IS NOT NULL");
    }

    public Map<String, Object> getItem(long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT i.*, c.name AS container_name, c.owner_id, m.name AS owner_name,
                   l.lifecycle_type, l.start_date AS lifecycle_start_date, l.expiry_date,
                   l.remind_days, l.notes AS lifecycle_notes,
                   (SELECT COUNT(*) FROM attachments a WHERE a.item_id = i.id) AS attachment_count,
                   (SELECT a.id FROM attachments a WHERE a.item_id = i.id AND a.kind = 'image' ORDER BY a.id DESC LIMIT 1) AS cover_attachment_id
            FROM items i
            JOIN containers c ON c.id = i.container_id
            JOIN household_members m ON m.id = c.owner_id
            LEFT JOIN item_lifecycle l ON l.item_id = i.id
            WHERE i.id = ?
            """, id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Map<String, Object> createItem(Map<String, Object> data) {
        KeyHolder key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement("""
                INSERT INTO items(container_id, name, quantity, quantity_text, condition, notes, tags)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, number(data.get("container_id")).longValue());
            ps.setString(2, string(data.get("name")).trim());
            Integer quantity = nullableInteger(data.get("quantity"));
            if (quantity == null) ps.setObject(3, null); else ps.setInt(3, quantity);
            ps.setString(4, string(data.get("quantity_text")).trim());
            String condition = string(data.get("condition")).trim();
            ps.setString(5, condition.isBlank() ? "正常" : condition);
            ps.setString(6, string(data.get("notes")).trim());
            ps.setString(7, string(data.get("tags")).trim());
            return ps;
        }, key);
        long id = key.getKey().longValue(); refreshFtsForItem(id); return getItem(id);
    }

    public Map<String, Object> updateItem(long id, Map<String, Object> data) {
        updateDynamic("items", id, data, ITEM_FIELDS); refreshFtsForItem(id); return getItem(id);
    }

    public boolean deleteItem(long id) {
        deleteFtsForItem(id); return jdbc.update("DELETE FROM items WHERE id = ?", id) > 0;
    }

    public List<Map<String, Object>> createItemsBatch(long containerId, List<Map<String, Object>> rows) {
        if (rows.isEmpty()) return List.of();
        Map<String, Object> container = getContainer(containerId);
        if (container == null) throw new IllegalArgumentException("目标箱子不存在");
        long ownerId = number(container.get("owner_id")).longValue();
        // 规范化所有行
        List<Object[]> batchArgs = new ArrayList<>(rows.size());
        List<String> names = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            String name = string(row.get("name")).trim();
            if (name.isEmpty()) throw new IllegalArgumentException("物品名称不能为空");
            Integer qty = nullableInteger(row.getOrDefault("quantity", 1));
            String qtyText = string(row.getOrDefault("quantity_text", "")).trim();
            String condition = string(row.getOrDefault("condition", "正常")).trim();
            if (condition.isEmpty()) condition = "正常";
            String notes = string(row.getOrDefault("notes", "")).trim();
            String tags = string(row.getOrDefault("tags", "")).trim();
            batchArgs.add(new Object[]{ containerId, name, qty, qtyText, condition, notes, tags });
            names.add(name);
        }
        // 一次 batchUpdate
        int[] result = jdbc.batchUpdate("""
            INSERT INTO items(container_id, name, quantity, quantity_text, condition, notes, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, batchArgs);
        // 取回自增 id
        List<Long> ids = new ArrayList<>();
        for (int i = 0; i < result.length; i++) {
            if (result[i] > 0) {
                Long id = jdbc.queryForObject("SELECT id FROM items WHERE name = ? AND container_id = ? ORDER BY id DESC LIMIT 1", Long.class, names.get(i), containerId);
                if (id != null) ids.add(id);
            }
        }
        // 批量刷新 FTS
        if (!ids.isEmpty()) refreshFtsForItems(ids);
        // 重新读回完整对象
        List<Map<String, Object>> created = new ArrayList<>(ids.size());
        for (Long id : ids) {
            Map<String, Object> item = getItem(id);
            if (item != null) created.add(item);
        }
        return created;
    }

    public List<Map<String, Object>> updateItemsBatch(List<Long> ids, Map<String, Object> data) {
        if (ids.isEmpty() || data.isEmpty()) return List.of();
        // 仅保留允许的字段
        Map<String, Object> normalized = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : data.entrySet()) {
            if (!ITEM_FIELDS.contains(e.getKey())) continue;
            Object v = e.getValue();
            if (v instanceof String s) v = s.trim();
            normalized.put(e.getKey(), v);
        }
        if (normalized.isEmpty()) return List.of();
        String setClause = normalized.keySet().stream().map(k -> k + " = ?").collect(Collectors.joining(", "));
        String sql = "UPDATE items SET " + setClause + ", updated_at = CURRENT_TIMESTAMP WHERE id = ?";
        List<Object[]> batchArgs = new ArrayList<>(ids.size());
        for (Long id : ids) {
            Object[] params = new Object[normalized.size() + 1];
            int i = 0;
            for (Object value : normalized.values()) params[i++] = value;
            params[i] = id;
            batchArgs.add(params);
        }
        jdbc.batchUpdate(sql, batchArgs);
        refreshFtsForItems(ids);
        // 重新读回
        List<Map<String, Object>> result = new ArrayList<>(ids.size());
        for (Long id : ids) {
            Map<String, Object> item = getItem(id);
            if (item != null) result.add(item);
        }
        return result;
    }

    /**
     * 批量刷新 FTS 索引。先用单条 DELETE 清理 rowid 范围，再用单条 INSERT 写回，避免逐条刷新。
     */
    public void refreshFtsForItems(List<Long> itemIds) {
        if (itemIds.isEmpty()) return;
        try {
            // 逐条删除 FTS 中的旧条目（rowid 与 item_id 相同）
            List<Object[]> deleteArgs = itemIds.stream().map(id -> new Object[]{ id }).toList();
            jdbc.batchUpdate("DELETE FROM items_fts WHERE rowid = ?", deleteArgs);
            // 一次性插入所有 FTS 行
            String placeholders = itemIds.stream().map(x -> "?").collect(Collectors.joining(","));
            jdbc.update("""
                INSERT INTO items_fts(rowid, item_id, name, notes, tags, condition, container_name, member_name)
                SELECT i.id, i.id, i.name, i.notes, i.tags, i.condition, c.name, m.name
                FROM items i
                JOIN containers c ON c.id = i.container_id
                JOIN household_members m ON m.id = c.owner_id
                WHERE i.id IN (""" + placeholders + ")",
                itemIds.toArray());
        } catch (RuntimeException ex) {
            org.slf4j.LoggerFactory.getLogger(InventoryRepository.class)
                .warn("refreshFtsForItems failed: {}", ex.getMessage());
        }
    }

    public Map<String, Object> summary() { return summary(List.of()); }

    public Map<String, Object> summary(List<Long> ownerIds) {
        String filter = ownerIds == null || ownerIds.isEmpty() ? "" : " WHERE c.owner_id IN (" + ownerIds.stream().map(x -> "?").collect(Collectors.joining(",")) + ")";
        Object[] args = ownerIds == null ? new Object[0] : ownerIds.toArray();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("containers", jdbc.queryForObject("SELECT COUNT(*) FROM containers c" + filter, Long.class, args));
        result.put("items", jdbc.queryForObject("SELECT COUNT(*) FROM items i JOIN containers c ON c.id=i.container_id" + filter, Long.class, args));
        result.put("quantity", jdbc.queryForObject("SELECT COALESCE(SUM(COALESCE(i.quantity,1)),0) FROM items i JOIN containers c ON c.id=i.container_id" + filter, Long.class, args));
        result.put("special", jdbc.queryForObject("SELECT COUNT(*) FROM items i JOIN containers c ON c.id=i.container_id" + filter + (filter.isEmpty() ? " WHERE" : " AND") + " i.condition <> '正常'", Long.class, args));
        return result;
    }

    public List<Map<String, Object>> memberSummary() {
        return jdbc.queryForList("""
            SELECT m.id, m.name,
                   COUNT(DISTINCT c.id) AS containers,
                   COUNT(i.id) AS items,
                   COALESCE(SUM(COALESCE(i.quantity, 1)),0) AS quantity
            FROM household_members m
            LEFT JOIN containers c ON c.owner_id = m.id
            LEFT JOIN items i ON i.container_id = c.id
            GROUP BY m.id ORDER BY m.sort_order, m.id
            """);
    }

    public void refreshFtsForItem(long itemId) {
        try {
            jdbc.update("DELETE FROM items_fts WHERE rowid = ?", itemId);
            jdbc.update("""
                INSERT INTO items_fts(rowid, item_id, name, notes, tags, condition, container_name, member_name)
                SELECT i.id, i.id, i.name, i.notes, i.tags, i.condition, c.name, m.name
                FROM items i JOIN containers c ON c.id=i.container_id JOIN household_members m ON m.id=c.owner_id
                WHERE i.id = ?
                """, itemId);
        } catch (RuntimeException ignored) {}
    }

    public void refreshFtsForContainer(long containerId) {
        try {
            List<Long> ids = jdbc.queryForList("SELECT id FROM items WHERE container_id = ?", Long.class, containerId);
            refreshFtsForItems(ids);
        } catch (RuntimeException ex) {
            org.slf4j.LoggerFactory.getLogger(InventoryRepository.class)
                .warn("refreshFtsForContainer({}) failed: {}", containerId, ex.getMessage());
        }
    }

    public void deleteFtsForItem(long itemId) {
        try { jdbc.update("DELETE FROM items_fts WHERE rowid = ?", itemId); } catch (RuntimeException ignored) {}
    }

    private static String buildFtsQuery(String query) {
        if (query == null) return "";
        LinkedHashSet<String> terms = new LinkedHashSet<>();
        // ASCII：保持原样
        Matcher ascii = Pattern.compile("[A-Za-z0-9+_-]{2,}").matcher(query);
        while (ascii.find()) terms.add(ascii.group());
        // 中文：只取整段 + 一组非冗余的滑窗子串
        Matcher han = Pattern.compile("[\\p{IsHan}]{2,}").matcher(query);
        while (han.find()) {
            String run = han.group();
            terms.add(run);
            // 长度 >5 时只取最长滑窗：4 字、3 字，去重靠 LinkedHashSet
            if (run.length() > 4) {
                for (int i = 0; i <= run.length() - 4; i++) terms.add(run.substring(i, i + 4));
            }
            if (run.length() > 3) {
                for (int i = 0; i <= run.length() - 3; i++) terms.add(run.substring(i, i + 3));
            }
        }
        if (terms.isEmpty()) return "";
        return terms.stream().limit(20)
            .map(term -> "\"" + term.replace("\"", "\"\"") + "\"*")
            .collect(Collectors.joining(" OR "));
    }

    private void updateDynamic(String table, long id, Map<String, Object> data, Set<String> allowed) {
        List<String> sets = new ArrayList<>(); List<Object> args = new ArrayList<>();
        for (Map.Entry<String, Object> entry : data.entrySet()) {
            if (!allowed.contains(entry.getKey())) continue;
            Object value = entry.getValue(); if (value instanceof String s) value = s.trim();
            sets.add(entry.getKey() + " = ?"); args.add(value);
        }
        if (sets.isEmpty()) return;
        args.add(id);
        jdbc.update("UPDATE " + table + " SET " + String.join(", ", sets) + ", updated_at = CURRENT_TIMESTAMP WHERE id = ?", args.toArray());
    }

    public static String string(Object value) { return value == null ? "" : String.valueOf(value); }
    public static Number number(Object value) { return value instanceof Number n ? n : Long.parseLong(String.valueOf(value)); }
    public static Integer nullableInteger(Object value) { return value == null || String.valueOf(value).isBlank() ? null : number(value).intValue(); }
}
