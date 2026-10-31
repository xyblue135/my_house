package com.xyblue.myhouse.controller;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.Connection;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import javax.sql.DataSource;

import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 云备份（GitHub / Gitee）：
 *   GET  /api/backup/db          —— SQLite 一致性快照（VACUUM INTO，服务运行中也能安全导出）
 *   GET  /api/backup/attachments —— 附件文件清单（id + stored_name），客户端逐个经
 *                                   /api/attachments/{id}/content 下载
 *   POST /api/restore/begin      —— 清空恢复暂存区
 *   POST /api/restore/file       —— 逐个上传备份文件（kind=db|attachment）
 *   POST /api/restore/apply      —— 校验并转入 restore-pending，下次启动时生效
 *
 * 恢复采用「暂存 + 重启生效」：备份的整体替换发生在应用启动早期（见
 * DatabaseInitializer.applyPendingRestore），避免运行中的连接写坏数据库。
 */
@RestController
@RequestMapping("/api/backup")
public class BackupController {

    private final DataSource dataSource;
    private final Path dataDir;
    private final JdbcTemplate jdbc;

    public BackupController(DataSource dataSource, Path myhouseDataDir) {
        this.dataSource = dataSource;
        this.dataDir = myhouseDataDir;
        this.jdbc = new JdbcTemplate(dataSource);
    }

    @GetMapping("/db")
    public ResponseEntity<ByteArrayResource> snapshot() throws Exception {
        Path tmp = dataDir.resolve("backup-snapshot-" + System.currentTimeMillis() + ".db");
        try (Connection conn = dataSource.getConnection(); Statement st = conn.createStatement()) {
            st.execute("VACUUM INTO '" + tmp.toString().replace("'", "''") + "'");
        }
        try {
            byte[] bytes = Files.readAllBytes(tmp);
            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=inventory.db")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(bytes.length)
                .body(new ByteArrayResource(bytes));
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    @GetMapping("/attachments")
    public List<Map<String, Object>> attachments() {
        return jdbc.queryForList(
            "SELECT id, stored_name AS storedName, mime_type AS mime FROM attachments ORDER BY id");
    }

    @PostMapping("/restore/begin")
    public Map<String, Object> begin() throws IOException {
        Path pending = dataDir.resolve("restore-pending");
        deleteRecursively(pending);
        Files.createDirectories(pending.resolve("attachments"));
        return Map.of("ok", true);
    }

    @PostMapping("/restore/file")
    public Map<String, Object> file(@RequestParam(name = "kind") String kind,
                                    @RequestParam(name = "name", required = false) String name,
                                    @RequestParam("file") MultipartFile file) throws IOException {
        Path pending = dataDir.resolve("restore-pending");
        if (!Files.isDirectory(pending)) {
            throw new IllegalArgumentException("请先调用 restore/begin");
        }
        if ("db".equals(kind)) {
            Files.copy(file.getInputStream(), pending.resolve("inventory.db"),
                StandardCopyOption.REPLACE_EXISTING);
            return Map.of("ok", true, "kind", "db");
        }
        if ("attachment".equals(kind)) {
            String stored = sanitizeRelative(name);
            if (stored.isBlank()) throw new IllegalArgumentException("附件文件名缺失");
            Path target = pending.resolve("attachments").resolve(stored);
            Files.createDirectories(target.getParent());
            Files.copy(file.getInputStream(), target, StandardCopyOption.REPLACE_EXISTING);
            return Map.of("ok", true, "kind", "attachment", "name", stored);
        }
        throw new IllegalArgumentException("未知的文件类型: " + kind);
    }

    @PostMapping("/restore/apply")
    public Map<String, Object> apply() throws IOException {
        Path pending = dataDir.resolve("restore-pending");
        Path pendingDb = pending.resolve("inventory.db");
        if (!Files.isRegularFile(pendingDb)) {
            throw new IllegalStateException("暂存区没有数据库文件，恢复取消");
        }
        byte[] header = new byte[16];
        try (InputStream in = Files.newInputStream(pendingDb)) {
            if (in.read(header) != header.length
                || !new String(header, StandardCharsets.UTF_8).startsWith("SQLite format 3")) {
                throw new IllegalStateException("备份库不是有效的 SQLite 数据库");
            }
        }
        int attachments = 0;
        Path pendingAttachments = pending.resolve("attachments");
        if (Files.isDirectory(pendingAttachments)) {
            try (var stream = Files.list(pendingAttachments)) {
                attachments = (int) stream.filter(Files::isRegularFile).count();
            }
        }
        return Map.of("ok", true, "message",
            "备份已就绪，重启服务（start.bat）后生效：数据库与附件将整体替换为备份内容");
    }

    /**
     * 附件相对路径校验：stored_name 形如 container-1/xxx.jpg（带子目录）。
     * 只允许安全段组成的相对路径，杜绝绝对路径与路径穿越。
     */
    private static String sanitizeRelative(String name) {
        if (name == null || name.isBlank()) return "";
        String normalized = name.replace('\\', '/');
        if (normalized.startsWith("/")) return "";
        for (String seg : normalized.split("/")) {
            if (seg.isBlank() || seg.equals(".") || seg.equals("..")) return "";
            if (!seg.matches("[A-Za-z0-9._-]+")) return "";
        }
        return normalized;
    }

    private static void deleteRecursively(Path dir) throws IOException {
        if (!Files.isDirectory(dir)) return;
        List<Path> all = new ArrayList<>();
        try (var stream = Files.walk(dir)) {
            stream.sorted(java.util.Comparator.reverseOrder()).forEach(all::add);
        }
        for (Path p : all) Files.deleteIfExists(p);
    }
}
