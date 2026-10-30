package com.xyblue.myhouse.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import jakarta.annotation.PostConstruct;

/**
 * 家庭账号（可选的账号密码登录）。凭据保存在数据目录 account.json：
 * { "username": "...", "salt": "...", "passwordHash": "sha256(salt + ':' + password)" }
 * 密码本身不落盘。文件缺失时登录不可用，访问密钥仍可正常连接。
 * 首次启动时可设 MYHOUSE_AUTH_USERNAME / MYHOUSE_AUTH_PASSWORD 自动生成该文件；
 * 删除文件即停用账号登录。家庭只有这一个账号，权限与访问密钥完全相同。
 */
@Component
public class FamilyAccountStore {

    private final Path dataDir;
    private final ObjectMapper mapper;
    private final String seedUsername;
    private final String seedPassword;

    public FamilyAccountStore(Path myhouseDataDir, ObjectMapper mapper,
                              @Value("${myhouse.auth-username:}") String seedUsername,
                              @Value("${myhouse.auth-password:}") String seedPassword) {
        this.dataDir = myhouseDataDir;
        this.mapper = mapper;
        this.seedUsername = blankToNull(seedUsername);
        this.seedPassword = blankToNull(seedPassword);
    }

    @PostConstruct
    void seedFromEnvironment() {
        if (seedUsername == null || seedPassword == null || Files.isRegularFile(accountFile())) return;
        try {
            write(seedUsername, seedPassword);
        } catch (IOException ex) {
            throw new IllegalStateException("写入 account.json 失败: " + ex.getMessage(), ex);
        }
    }

    private Path accountFile() {
        return dataDir.resolve("account.json");
    }

    /** 数据目录里是否存在可用的 account.json。 */
    public boolean configured() {
        if (!Files.isRegularFile(accountFile())) return false;
        try {
            JsonNode node = mapper.readTree(accountFile().toFile());
            return !node.path("username").asText("").isBlank()
                && !node.path("salt").asText("").isBlank()
                && !node.path("passwordHash").asText("").isBlank();
        } catch (Exception ex) {
            return false;
        }
    }

    /** 校验账号密码；成功返回用户名，未配置或凭据错误返回 empty。每次都重新读文件，改动即时生效。 */
    public java.util.Optional<String> verify(String username, String password) {
        Path file = accountFile();
        if (!Files.isRegularFile(file)) return java.util.Optional.empty();
        try {
            JsonNode node = mapper.readTree(file.toFile());
            String storedUser = node.path("username").asText("");
            String salt = node.path("salt").asText("");
            String hash = node.path("passwordHash").asText("");
            if (salt.isBlank() || hash.isBlank() || storedUser.isBlank()) return java.util.Optional.empty();
            String candidate = hashHex(salt, password == null ? "" : password);
            boolean userOk = MessageDigest.isEqual(
                storedUser.getBytes(StandardCharsets.UTF_8),
                (username == null ? "" : username.trim()).getBytes(StandardCharsets.UTF_8));
            boolean passOk = MessageDigest.isEqual(
                hash.toLowerCase().getBytes(StandardCharsets.UTF_8),
                candidate.getBytes(StandardCharsets.UTF_8));
            return userOk && passOk ? java.util.Optional.of(storedUser) : java.util.Optional.empty();
        } catch (Exception ex) {
            return java.util.Optional.empty();
        }
    }

    private void write(String username, String password) throws IOException {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        ObjectNode node = mapper.createObjectNode();
        node.put("username", username.trim());
        node.put("salt", HexFormat.of().formatHex(salt));
        node.put("passwordHash", hashHex(HexFormat.of().formatHex(salt), password));
        node.put("note", "家庭账号登录；删除此文件即停用，访问密钥不受影响。请勿提交到 Git。");
        mapper.writerWithDefaultPrettyPrinter().writeValue(accountFile().toFile(), node);
    }

    private static String hashHex(String salt, String password) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] out = digest.digest((salt + ":" + password).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(out);
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 不可用", ex);
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
