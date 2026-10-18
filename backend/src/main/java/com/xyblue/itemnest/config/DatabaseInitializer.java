package com.xyblue.itemnest.config;

import java.io.InputStream;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.xyblue.itemnest.service.AttachmentService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class DatabaseInitializer implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final AttachmentService attachments;

    public DatabaseInitializer(JdbcTemplate jdbc, ObjectMapper objectMapper, AttachmentService attachments) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.attachments = attachments;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        createBaseSchema();
        migrateHousehold();
        migrateGroups();
        migrateContainerNameScope();
        migrateContainerPlacement();
        renameDefaultMembers();
        createV08Schema();
        migrateContainerAttachments();
        dropVestigialLifecycle();
        createLifeHubSchema();
        createRecipesSchema();
        migrateRecipeAttachments();
        createFtsTriggers();

        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM containers", Integer.class);
        if (count != null && count == 0) seedFreshDatabase();

        // 首次启动重建 FTS；之后由 trigger 维护
        boolean ftsBuilt = isMigrationApplied("2026-08-31-v1-fts-triggers");
        if (!ftsBuilt) {
            rebuildFtsIndex();
            jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-08-31-v1-fts-triggers");
        }
        jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-08-19-v0.8-household-history-lifecycle-fts");
        jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-08-21-v1-life-hub");

        // 清理孤儿附件文件（磁盘上有但 DB 已无）
        try {
            int purged = attachments.purgeOrphanFiles();
            if (purged > 0) org.slf4j.LoggerFactory.getLogger(DatabaseInitializer.class)
                .info("启动时清理 {} 个孤儿附件文件", purged);
        } catch (Exception ex) {
            org.slf4j.LoggerFactory.getLogger(DatabaseInitializer.class)
                .warn("孤儿附件清理失败: {}", ex.getMessage());
        }
    }

    private boolean isMigrationApplied(String key) {
        try {
            Integer c = jdbc.queryForObject("SELECT COUNT(*) FROM migrations WHERE key = ?", Integer.class, key);
            return c != null && c > 0;
        } catch (Exception ex) { return false; }
    }

    /**
     * FTS5 同步 trigger：items / containers / household_members 变更时自动维护 items_fts。
     * 增/改/删都覆盖；旧代码里的 refreshFtsForItem 仍可作为手动修复入口。
     */
    private void createFtsTriggers() {
        try {
            jdbc.execute("DROP TRIGGER IF EXISTS items_ai");
            jdbc.execute("DROP TRIGGER IF EXISTS items_ad");
            jdbc.execute("DROP TRIGGER IF EXISTS items_au");
            jdbc.execute("DROP TRIGGER IF EXISTS containers_au_fts");
            jdbc.execute("DROP TRIGGER IF EXISTS members_au_fts");
            jdbc.execute("""
                CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
                    INSERT INTO items_fts(rowid, item_id, name, notes, tags, condition, container_name, member_name)
                    SELECT NEW.id, NEW.id, NEW.name, NEW.notes, NEW.tags, NEW.condition, c.name, m.name
                    FROM containers c JOIN household_members m ON m.id = c.owner_id
                    WHERE c.id = NEW.container_id;
                END
                """);
            jdbc.execute("""
                CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
                    DELETE FROM items_fts WHERE rowid = OLD.id;
                END
                """);
            jdbc.execute("""
                CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
                    DELETE FROM items_fts WHERE rowid = OLD.id;
                    INSERT INTO items_fts(rowid, item_id, name, notes, tags, condition, container_name, member_name)
                    SELECT NEW.id, NEW.id, NEW.name, NEW.notes, NEW.tags, NEW.condition, c.name, m.name
                    FROM containers c JOIN household_members m ON m.id = c.owner_id
                    WHERE c.id = NEW.container_id;
                END
                """);
            jdbc.execute("""
                CREATE TRIGGER containers_au_fts AFTER UPDATE OF name ON containers BEGIN
                    DELETE FROM items_fts WHERE rowid IN (SELECT id FROM items WHERE container_id = OLD.id);
                    INSERT INTO items_fts(rowid, item_id, name, notes, tags, condition, container_name, member_name)
                    SELECT i.id, i.id, i.name, i.notes, i.tags, i.condition, c.name, m.name
                    FROM items i JOIN containers c ON c.id = i.container_id
                    JOIN household_members m ON m.id = c.owner_id
                    WHERE c.id = NEW.id;
                END
                """);
            jdbc.execute("""
                CREATE TRIGGER members_au_fts AFTER UPDATE OF name ON household_members BEGIN
                    DELETE FROM items_fts WHERE rowid IN (
                        SELECT i.id FROM items i
                        JOIN containers c ON c.id = i.container_id
                        WHERE c.owner_id = OLD.id
                    );
                    INSERT INTO items_fts(rowid, item_id, name, notes, tags, condition, container_name, member_name)
                    SELECT i.id, i.id, i.name, i.notes, i.tags, i.condition, c.name, m.name
                    FROM items i
                    JOIN containers c ON c.id = i.container_id
                    JOIN household_members m ON m.id = c.owner_id
                    WHERE c.owner_id = NEW.id;
                END
                """);
        } catch (RuntimeException ex) {
            // FTS5 / trigger 不可用时回退到手动刷新
            org.slf4j.LoggerFactory.getLogger(DatabaseInitializer.class)
                .warn("FTS5 triggers 创建失败，回退到手动刷新: {}", ex.getMessage());
        }
    }

    private void createBaseSchema() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS containers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                owner_id INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                pos_x REAL NOT NULL DEFAULT 0,
                pos_y REAL NOT NULL DEFAULT 0,
                pos_z REAL NOT NULL DEFAULT 0,
                size_w REAL NOT NULL DEFAULT 1,
                size_h REAL NOT NULL DEFAULT 1,
                size_d REAL NOT NULL DEFAULT 1,
                UNIQUE(owner_id, name)
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                container_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                quantity INTEGER,
                quantity_text TEXT NOT NULL DEFAULT '',
                condition TEXT NOT NULL DEFAULT '正常',
                notes TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(container_id) REFERENCES containers(id) ON DELETE RESTRICT
            )
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_items_container ON items(container_id)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_items_name ON items(name)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_items_condition ON items(condition)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at DESC, id DESC)");
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS migrations (
                key TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """);
    }

    private void migrateHousehold() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS household_members (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """);
        jdbc.update("INSERT OR IGNORE INTO household_members(id, name, sort_order) VALUES (1, '我', 1)");
        jdbc.update("INSERT OR IGNORE INTO household_members(id, name, sort_order) VALUES (2, '爸', 2)");
        jdbc.update("INSERT OR IGNORE INTO household_members(id, name, sort_order) VALUES (3, '妈', 3)");
        if (!hasColumn("containers", "owner_id")) {
            jdbc.execute("ALTER TABLE containers ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 1");
        }
        jdbc.update("UPDATE containers SET owner_id = 1 WHERE owner_id IS NULL OR owner_id NOT IN (1,2,3)");
        if (!hasColumn("containers", "sort_order")) {
            jdbc.execute("ALTER TABLE containers ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
            jdbc.update("UPDATE containers SET sort_order = id");
        }
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_containers_owner ON containers(owner_id, id)");
    }

    /**
     * 盒子分组：每个成员可自定义分组（如「房间A / 房间B」），
     * 未分组（group_id 为 NULL）视为「默认分组」。观看时按分组筛选显示。
     */
    private void migrateGroups() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS container_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_groups_owner ON container_groups(owner_id, sort_order, id)");
        if (!hasColumn("containers", "group_id")) {
            jdbc.execute("ALTER TABLE containers ADD COLUMN group_id INTEGER");
        }
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_containers_group ON containers(group_id, id)");
    }

    /**
     * 箱子名唯一性从「全局唯一」改为「按成员唯一」：两个成员可以各自有一个「工具箱」。
     * 旧库的 containers.name 带全局 UNIQUE 约束，SQLite 不能直接改约束，需重建表。
     * 新库由 createBaseSchema 直接建好 UNIQUE(owner_id, name)，这里检测到全局唯一才重建。
     */
    private void migrateContainerNameScope() {
        if (isMigrationApplied("2026-10-17-v1-container-name-scoped-unique")) return;
        if (hasColumn("containers", "owner_id") && hasGlobalNameUnique()) {
            rebuildContainersForScopedNameUnique();
        }
        jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-10-17-v1-container-name-scoped-unique");
    }

    /** 判断 containers 是否仍带「只按 name 一列」的全局唯一约束。 */
    private boolean hasGlobalNameUnique() {
        for (Map<String, Object> index : jdbc.queryForList("PRAGMA index_list(containers)")) {
            Object unique = index.get("unique");
            boolean isUnique = unique instanceof Number n ? n.intValue() != 0 : Boolean.parseBoolean(String.valueOf(unique));
            if (!isUnique) continue;
            String indexName = String.valueOf(index.get("name"));
            List<Map<String, Object>> columns = jdbc.queryForList("PRAGMA index_info(" + indexName + ")");
            if (columns.size() == 1 && "name".equalsIgnoreCase(String.valueOf(columns.get(0).get("name")))) return true;
        }
        return false;
    }

    /**
     * 重建 containers 表以替换唯一约束。整个重建在同一连接上执行：
     * 先关掉外键校验与 schema 重解析（legacy_alter_table），避免 DROP/RENAME 触发
     * items、attachments 等引用表/触发器的旧 schema 解析错误；完成后恢复。
     */
    private void rebuildContainersForScopedNameUnique() {
        jdbc.execute((org.springframework.jdbc.core.ConnectionCallback<Void>) connection -> {
            try (java.sql.Statement st = connection.createStatement()) {
                // 摘掉引用 containers 的 FTS trigger，避免重建/改名时解析旧 schema 失败；createFtsTriggers 会重建
                for (String trigger : List.of("items_ai", "items_ad", "items_au", "containers_au_fts", "members_au_fts")) {
                    st.execute("DROP TRIGGER IF EXISTS " + trigger);
                }
                st.execute("PRAGMA foreign_keys = OFF");
                st.execute("PRAGMA legacy_alter_table = ON");
                st.execute("DROP TABLE IF EXISTS containers_new");
                st.execute("""
                    CREATE TABLE containers_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        notes TEXT NOT NULL DEFAULT '',
                        owner_id INTEGER NOT NULL DEFAULT 1,
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        group_id INTEGER,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(owner_id, name)
                    )
                    """);
                st.execute("""
                    INSERT INTO containers_new(id, name, notes, owner_id, sort_order, group_id, created_at, updated_at)
                    SELECT id, name, notes, owner_id, sort_order, group_id, created_at, updated_at FROM containers
                    """);
                st.execute("DROP TABLE containers");
                st.execute("ALTER TABLE containers_new RENAME TO containers");
                st.execute("PRAGMA legacy_alter_table = OFF");
                st.execute("PRAGMA foreign_keys = ON");
            }
            return null;
        });
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_containers_owner ON containers(owner_id, id)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_containers_group ON containers(group_id, id)");
    }

    /**
     * 空间摆位：给箱子补上三维位置与尺寸列，供房间平面视图（/space）摆放。
     * pos_x/pos_z 是箱子底面中心在地面上的坐标，pos_y 是底面离地高度（便于叠放）；
     * size_w/size_h/size_d 是宽/高/深。单位约定 1 ≈ 10cm，由前端决定。
     * 新库由 createBaseSchema 直接建好，旧库用 ALTER TABLE 逐列补齐。
     */
    private void migrateContainerPlacement() {
        if (isMigrationApplied("2026-10-19-v1-container-placement")) return;
        for (String column : List.of("pos_x", "pos_y", "pos_z")) {
            if (!hasColumn("containers", column)) {
                jdbc.execute("ALTER TABLE containers ADD COLUMN " + column + " REAL NOT NULL DEFAULT 0");
            }
        }
        for (String column : List.of("size_w", "size_h", "size_d")) {
            if (!hasColumn("containers", column)) {
                jdbc.execute("ALTER TABLE containers ADD COLUMN " + column + " REAL NOT NULL DEFAULT 1");
            }
        }
        jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-10-19-v1-container-placement");
    }

    /**
     * 移除已废弃的 item_lifecycle 表：物品有效期功能与相关 UI 已下线，
     * 表仅残留历史数据，撤销链路也已不再依赖它。
     */
    private void dropVestigialLifecycle() {
        if (isMigrationApplied("2026-10-17-v1-remove-item-lifecycle")) return;
        jdbc.execute("DROP TABLE IF EXISTS item_lifecycle");
        jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-10-17-v1-remove-item-lifecycle");
    }

    /**
     * 把默认成员「我 / 爸 / 妈」一次性改名为「用户1 / 用户2 / 用户3」。
     * 用 `AND name = 旧名` 保护：用户已手动改名则不再覆盖。
     */
    private void renameDefaultMembers() {
        if (isMigrationApplied("2026-09-16-v1-rename-default-members")) return;
        jdbc.update("UPDATE household_members SET name = '用户1' WHERE id = 1 AND name = '我'");
        jdbc.update("UPDATE household_members SET name = '用户2' WHERE id = 2 AND name = '爸'");
        jdbc.update("UPDATE household_members SET name = '用户3' WHERE id = 3 AND name = '妈'");
        jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-09-16-v1-rename-default-members");
    }

    private void createV08Schema() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS operation_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INTEGER,
                item_id INTEGER,
                container_id INTEGER,
                related_container_id INTEGER,
                owner_id INTEGER,
                source TEXT NOT NULL DEFAULT 'manual',
                description TEXT NOT NULL DEFAULT '',
                before_json TEXT,
                after_json TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                undone_at TEXT
            )
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_history_container ON operation_history(container_id, created_at DESC)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_history_related_container ON operation_history(related_container_id, created_at DESC)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_history_owner ON operation_history(owner_id, created_at DESC)");

        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER,
                container_id INTEGER,
                kind TEXT NOT NULL DEFAULT 'file',
                filename TEXT NOT NULL,
                stored_name TEXT NOT NULL UNIQUE,
                mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
                FOREIGN KEY(container_id) REFERENCES containers(id) ON DELETE CASCADE
            )
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(item_id, created_at DESC)");

        try {
            jdbc.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
                    item_id UNINDEXED,
                    name,
                    notes,
                    tags,
                    condition,
                    container_name,
                    member_name,
                    tokenize='unicode61'
                )
                """);
        } catch (RuntimeException ignored) {
            // The normal xerial SQLite build includes FTS5. If a custom build does not,
            // InventoryRepository transparently falls back to LIKE search.
        }
    }

    private void createLifeHubSchema() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS life_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL DEFAULT 1,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                priority INTEGER NOT NULL DEFAULT 0,
                category TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '',
                amount REAL,
                currency TEXT NOT NULL DEFAULT 'CNY',
                occurred_at TEXT,
                due_at TEXT,
                start_at TEXT,
                end_at TEXT,
                repeat_rule TEXT NOT NULL DEFAULT '',
                progress REAL NOT NULL DEFAULT 0,
                target_value REAL,
                unit TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                contact TEXT NOT NULL DEFAULT '',
                extra_json TEXT NOT NULL DEFAULT '{}',
                pinned INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                completed_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(owner_id) REFERENCES household_members(id) ON DELETE RESTRICT
            )
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_life_kind ON life_entries(kind, archived, updated_at DESC)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_life_owner ON life_entries(owner_id, archived, updated_at DESC)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_life_due ON life_entries(due_at, status, archived)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_life_occurred ON life_entries(occurred_at DESC, kind)");
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS life_checkins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id INTEGER NOT NULL,
                checkin_date TEXT NOT NULL,
                value REAL NOT NULL DEFAULT 1,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(entry_id, checkin_date),
                FOREIGN KEY(entry_id) REFERENCES life_entries(id) ON DELETE CASCADE
            )
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_life_checkins_entry ON life_checkins(entry_id, checkin_date DESC)");
    }

    /**
     * 炒菜中心：食谱表（标题 + 文字步骤），图片/视频附件通过 attachments.recipe_id 关联。
     */
    private void createRecipesSchema() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                steps TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_recipes_id ON recipes(id)");
    }

    /**
     * 附件表支持食谱维度：新增 recipe_id 列（可空），视频 kind。
     */
    private void migrateRecipeAttachments() {
        if (!hasColumn("attachments", "recipe_id")) {
            jdbc.execute("ALTER TABLE attachments ADD COLUMN recipe_id INTEGER");
            jdbc.execute("CREATE INDEX IF NOT EXISTS idx_attachments_recipe ON attachments(recipe_id, id)");
        }
    }

    /**
     * 附件表支持箱子维度：旧库 attachments.item_id 是 NOT NULL 且无 container_id，
     * 需要重建为 item_id/container_id 均可空（二者选其一）。新库由 createV08Schema 直接建好，此方法检测后跳过。
     */
    private void migrateContainerAttachments() {
        if (hasColumn("attachments", "container_id")) {
            // 新库已由 createV08Schema 建好新结构；清理可能残留的 attachments_new（上次迁移失败遗留），再确保索引存在
            jdbc.execute("DROP TABLE IF EXISTS attachments_new");
            jdbc.execute("CREATE INDEX IF NOT EXISTS idx_attachments_container ON attachments(container_id, created_at DESC)");
            return;
        }
        // 重建表前先移除旧 FTS trigger：ALTER TABLE RENAME 会触发 SQLite 重新解析整个 schema，
        // 旧库里的 containers_au_fts / members_au_fts 存在 m.name 未定义的历史 bug，会导致 RENAME 报错。
        // createFtsTriggers() 会在后续用正确 SQL 重建它们。
        jdbc.execute("DROP TRIGGER IF EXISTS items_ai");
        jdbc.execute("DROP TRIGGER IF EXISTS items_ad");
        jdbc.execute("DROP TRIGGER IF EXISTS items_au");
        jdbc.execute("DROP TRIGGER IF EXISTS containers_au_fts");
        jdbc.execute("DROP TRIGGER IF EXISTS members_au_fts");
        jdbc.execute("DROP TABLE IF EXISTS attachments_new");
        jdbc.execute("""
            CREATE TABLE attachments_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER,
                container_id INTEGER,
                kind TEXT NOT NULL DEFAULT 'file',
                filename TEXT NOT NULL,
                stored_name TEXT NOT NULL UNIQUE,
                mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
                FOREIGN KEY(container_id) REFERENCES containers(id) ON DELETE CASCADE
            )
            """);
        jdbc.update("""
            INSERT INTO attachments_new(id,item_id,container_id,kind,filename,stored_name,mime_type,size_bytes,created_at)
            SELECT id,item_id,NULL,kind,filename,stored_name,mime_type,size_bytes,created_at FROM attachments
            """);
        jdbc.execute("DROP TABLE attachments");
        jdbc.execute("ALTER TABLE attachments_new RENAME TO attachments");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(item_id, created_at DESC)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_attachments_container ON attachments(container_id, created_at DESC)");
        jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-09-15-v1-container-attachments");
    }

    private boolean hasColumn(String table, String column) {
        return jdbc.queryForList("PRAGMA table_info(" + table + ")").stream()
            .anyMatch(row -> column.equalsIgnoreCase(String.valueOf(row.get("name"))));
    }

    private void rebuildFtsIndex() {
        try {
            jdbc.update("DELETE FROM items_fts");
            jdbc.update("""
                INSERT INTO items_fts(rowid, item_id, name, notes, tags, condition, container_name, member_name)
                SELECT i.id, i.id, i.name, i.notes, i.tags, i.condition, c.name, m.name
                FROM items i
                JOIN containers c ON c.id = i.container_id
                JOIN household_members m ON m.id = c.owner_id
                """);
        } catch (RuntimeException ignored) {
            // FTS5 is an optimization, never a requirement for core inventory access.
        }
    }

    private void seedFreshDatabase() throws Exception {
        ClassPathResource resource = new ClassPathResource("seed-data.json");
        try (InputStream input = resource.getInputStream()) {
            SeedData seed = objectMapper.readValue(input, SeedData.class);
            for (SeedContainer container : seed.containers()) {
                jdbc.update("INSERT INTO containers(name, notes, owner_id) VALUES (?, ?, 1)", container.name(), safe(container.notes()));
                Long id = jdbc.queryForObject("SELECT id FROM containers WHERE name = ?", Long.class, container.name());
                for (SeedItem item : container.items()) {
                    jdbc.update("""
                        INSERT INTO items(container_id, name, quantity, quantity_text, condition, notes, tags)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, id, item.name(), item.quantity(), safe(item.quantityText()),
                            blankToDefault(item.condition(), "正常"), safe(item.notes()), safe(item.tags()));
                }
            }
            jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-08-18-v0.2-inventory-expansion");
            jdbc.update("INSERT OR IGNORE INTO migrations(key) VALUES (?)", "2026-08-18-v0.3-common-boxes");
        }
    }

    private static String safe(String value) { return value == null ? "" : value; }
    private static String blankToDefault(String value, String fallback) { return value == null || value.isBlank() ? fallback : value; }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record SeedData(List<SeedContainer> containers) {}
    @JsonIgnoreProperties(ignoreUnknown = true)
    record SeedContainer(String name, String notes, List<SeedItem> items) {}
    @JsonIgnoreProperties(ignoreUnknown = true)
    record SeedItem(String name, Integer quantity,
        @com.fasterxml.jackson.annotation.JsonProperty("quantity_text") String quantityText,
        String condition, String notes, String tags) {}
}
