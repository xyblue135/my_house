package com.xyblue.myhouse.controller;

import java.util.Map;
import java.util.Optional;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.xyblue.myhouse.service.FamilyAccountStore;
import com.xyblue.myhouse.service.SessionTokenStore;

/**
 * 账号密码登录：家庭账号验证通过后下发服务端会话令牌。
 * 该端点在 LanAuthFilter 中免鉴权（否则未登录的客户端无法登录）。
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final FamilyAccountStore accounts;
    private final SessionTokenStore sessionToken;

    public AuthController(FamilyAccountStore accounts, SessionTokenStore sessionToken) {
        this.accounts = accounts;
        this.sessionToken = sessionToken;
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
                "message", "服务器未配置家庭账号，请设置 MYHOUSE_AUTH_USERNAME / MYHOUSE_AUTH_PASSWORD 后重启一次"));
        }
        Optional<String> account = accounts.verify(username, password);
        if (account.isEmpty()) {
            // 失败统一延迟，减缓局域网/公网上的暴力尝试；不区分「账号不存在」和「密码错误」
            Thread.sleep(400);
            return ResponseEntity.status(401).body(Map.of(
                "error", "unauthorized",
                "message", "账号或密码不正确"));
        }
        return ResponseEntity.ok(Map.of("token", sessionToken.token(), "username", account.get()));
    }
}
