package com.xyblue.myhouse.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Base64;

import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;

/**
 * 服务端会话令牌：登录成功后下发给客户端的 Bearer 凭证。
 * 令牌在首次启动时随机生成并持久化到数据目录 session-token.txt，重启后保持不变，
 * 因此已登录的设备不需要重复登录。删除该文件并重启即可让所有设备下线重新登录。
 */
@Component
public class SessionTokenStore {

    private final Path dataDir;
    private String token;

    public SessionTokenStore(Path myhouseDataDir) {
        this.dataDir = myhouseDataDir;
    }

    @PostConstruct
    void ensureToken() throws IOException {
        Path file = dataDir.resolve("session-token.txt");
        if (Files.isRegularFile(file)) {
            String existing = Files.readString(file, StandardCharsets.UTF_8).trim();
            if (existing.length() >= 32) {
                this.token = existing;
                return;
            }
        }
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        String generated = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Files.writeString(file, generated, StandardCharsets.UTF_8);
        this.token = generated;
    }

    public String token() {
        return token;
    }
}
