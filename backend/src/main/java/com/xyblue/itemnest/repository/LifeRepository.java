package com.xyblue.itemnest.repository;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class LifeRepository {
    private static final Set<String> WRITABLE = Set.of(
        "owner_id", "kind", "title", "content", "status", "priority", "category", "tags",
        "amount", "currency", "occurred_at", "due_at", "start_at", "end_at", "repeat_rule",
        "progress", "target_value", "unit", "url", "location", "contact", "extra_json", "pinned", "archived", "completed_at"
    );
    private final JdbcTemplate jdbc;

    public LifeRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public List<Map<String, Object>> list(String kind, String query, Long ownerId, String status, Boolean archived, int limit) {
        StringBuilder sql = new StringBuilder("SELECT e.*, m.name owner_name, " +
            "(SELECT COUNT(*) FROM life_checkins c WHERE c.entry_id=e.id) checkin_count, " +
            "EXISTS(SELECT 1 FROM life_checkins c WHERE c.entry_id=e.id AND c.checkin_date=?) checked_today " +
            "FROM life_entries e JOIN household_members m ON m.id=e.owner_id WHERE 1=1");
        List<Object> args = new ArrayList<>();
        args.add(LocalDate.now().toString());
        if (kind != null && !kind.isBlank() && !"all".equalsIgnoreCase(kind)) { sql.append(" AND e.kind=?"); args.add(kind); }
        if (query != null && !query.isBlank()) {
            sql.append(" AND (LOWER(e.title) LIKE ? OR LOWER(e.content) LIKE ? OR LOWER(e.tags) LIKE ? OR LOWER(e.category) LIKE ?)");
            String like = "%" + query.trim().toLowerCase() + "%";
            args.add(like); args.add(like); args.add(like); args.add(like);
        }
        if (ownerId != null) { sql.append(" AND e.owner_id=?"); args.add(ownerId); }
        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) { sql.append(" AND e.status=?"); args.add(status.toUpperCase()); }
        if (archived != null) { sql.append(" AND e.archived=?"); args.add(archived ? 1 : 0); }
        sql.append(" ORDER BY e.pinned DESC, CASE WHEN e.status='DONE' THEN 1 ELSE 0 END, COALESCE(e.due_at,'9999-12-31'), e.updated_at DESC, e.id DESC LIMIT ?");
        args.add(Math.max(1, Math.min(limit, 1000)));
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    public Map<String, Object> get(long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT e.*, m.name owner_name FROM life_entries e JOIN household_members m ON m.id=e.owner_id WHERE e.id=?", id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Transactional
    public Map<String, Object> create(Map<String, Object> value) {
        jdbc.update("""
            INSERT INTO life_entries(owner_id,kind,title,content,status,priority,category,tags,amount,currency,
                occurred_at,due_at,start_at,end_at,repeat_rule,progress,target_value,unit,url,location,contact,extra_json,pinned,archived,completed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            number(value.getOrDefault("owner_id", 1)).longValue(), text(value.get("kind")), text(value.get("title")), text(value.get("content")),
            upper(value.getOrDefault("status", "ACTIVE")), number(value.getOrDefault("priority", 0)).intValue(), text(value.get("category")), text(value.get("tags")),
            nullableNumber(value.get("amount")), defaultText(value.get("currency"), "CNY"), nullableText(value.get("occurred_at")), nullableText(value.get("due_at")),
            nullableText(value.get("start_at")), nullableText(value.get("end_at")), text(value.get("repeat_rule")), number(value.getOrDefault("progress", 0)).doubleValue(),
            nullableNumber(value.get("target_value")), text(value.get("unit")), text(value.get("url")), text(value.get("location")), text(value.get("contact")),
            defaultText(value.get("extra_json"), "{}"), boolNumber(value.get("pinned")), boolNumber(value.get("archived")), nullableText(value.get("completed_at"))
        );
        Long id = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
        return get(id == null ? 0 : id);
    }

    @Transactional
    public Map<String, Object> update(long id, Map<String, Object> changes) {
        List<String> sets = new ArrayList<>();
        List<Object> args = new ArrayList<>();
        changes.forEach((key, raw) -> {
            if (!WRITABLE.contains(key)) return;
            sets.add(key + "=?");
            args.add(normalize(key, raw));
        });
        if (sets.isEmpty()) return get(id);
        sets.add("updated_at=CURRENT_TIMESTAMP");
        args.add(id);
        jdbc.update("UPDATE life_entries SET " + String.join(",", sets) + " WHERE id=?", args.toArray());
        return get(id);
    }

    public boolean delete(long id) { return jdbc.update("DELETE FROM life_entries WHERE id=?", id) > 0; }

    private static Object normalize(String key, Object value) {
        if (Set.of("owner_id", "priority").contains(key)) return number(value).longValue();
        if (Set.of("amount", "progress", "target_value").contains(key)) return value == null || String.valueOf(value).isBlank() ? null : number(value).doubleValue();
        if (Set.of("pinned", "archived").contains(key)) return boolNumber(value);
        if ("status".equals(key)) return upper(value);
        if (Set.of("occurred_at", "due_at", "start_at", "end_at", "completed_at").contains(key)) return nullableText(value);
        return value == null ? "" : value;
    }
    private static Number nullableNumber(Object value) { return value == null || String.valueOf(value).isBlank() ? null : number(value); }
    private static Number number(Object value) { return value instanceof Number n ? n : Double.parseDouble(String.valueOf(value)); }
    private static String text(Object value) { return value == null ? "" : String.valueOf(value).trim(); }
    private static String nullableText(Object value) { String text = text(value); return text.isBlank() ? null : text; }
    private static String defaultText(Object value, String fallback) { String text = text(value); return text.isBlank() ? fallback : text; }
    private static String upper(Object value) { return defaultText(value, "ACTIVE").toUpperCase(); }
    private static int boolNumber(Object value) { return Boolean.TRUE.equals(value) || "1".equals(String.valueOf(value)) || "true".equalsIgnoreCase(String.valueOf(value)) ? 1 : 0; }
}
