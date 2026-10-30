package com.xyblue.myhouse.controller;

import java.util.Map;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.xyblue.myhouse.service.FamilyAccountStore;

/**
 * 账号密码登录：用数据目录 account.json 里的家庭账号换取访问密钥。
 * 发放的就是 LanAuthFilter 认可的同一个 token，客户端拿到后与手填密钥等价。
 * 该端点在 LanAuthFilter 中免鉴权（否则拿不到凭证的客户端无法登录）。
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final FamilyAccountStore accounts;
    private final String accessToken;

    public AuthController(FamilyAccountStore accounts,
                          @Value("${myhouse.lan-token:#{null}}") String accessToken) {
        this.accounts = accounts;
        this.accessToken = accessToken == null || accessToken.isBlank() ? null : accessToken.trim();
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, String> body)
            throws InterruptedException {
        String username = body.getOrDefault("username", "");
        String password = body.getOrDefault("password", "");
        if (!accounts.configured()) {
            Thread.sleep(400);
            return ResponseEntity.status(503).body(Map.of(
                "error", "account_missing",
                "message", "服务器未配置家庭账号，请改用访问密钥连接，或设置 MYHOUSE_AUTH_USERNAME / MYHOUSE_AUTH_PASSWORD 后重启"));
        }
        Optional<String> account = accounts.verify(username, password);
        if (account.isEmpty()) {
            // 失败统一延迟，减缓局域网/公网上的暴力尝试；不区分「账号不存在」和「密码错误」
            Thread.sleep(400);
            return ResponseEntity.status(401).body(Map.of(
                "error", "unauthorized",
                "message", "账号或密码不正确"));
        }
        if (accessToken == null) {
            return ResponseEntity.status(503).body(Map.of(
                "error", "token_missing",
                "message", "服务器未配置访问密钥，无法发放登录凭证，请先运行 start.bat 生成"));
        }
        return ResponseEntity.ok(Map.of("token", accessToken, "username", account.get()));
    }
}
