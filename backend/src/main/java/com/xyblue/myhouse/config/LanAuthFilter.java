package com.xyblue.myhouse.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.security.MessageDigest;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.cors.CorsUtils;

import com.xyblue.myhouse.service.SessionTokenStore;

/**
 * 会话令牌鉴权：所有 API 请求都需要登录后下发的凭证（浏览器/客户端在登录后自动携带）。
 * 客户端必须通过以下任一方式提供 token：
 *   1) Authorization: Bearer <token>
 *   2) X-Myhouse-Token: <token>
 *   3) URL 查询参数 ?token=<token>（仅附件内容 GET/HEAD，供 <img> 标签使用）
 *
 * 登录端点 /api/auth/login 免鉴权（用账号密码换取 token）。
 * 静态资源放行。令牌由 SessionTokenStore 在首次启动时自动生成，无需人工配置。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class LanAuthFilter extends OncePerRequestFilter {

    private static final Set<String> PROTECTED_PREFIXES = Set.of("/api/");

    private final SessionTokenStore sessionToken;

    public LanAuthFilter(SessionTokenStore sessionToken) {
        this.sessionToken = sessionToken;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getServletPath();
        if (path == null || path.isEmpty()) path = request.getRequestURI();
        if (!PROTECTED_PREFIXES.stream().anyMatch(path::startsWith)) {
            chain.doFilter(request, response);
            return;
        }
        // 登录端点免鉴权：它用家庭账号密码换取会话令牌（账号错误时控制器内部返回 401 并带延迟）。
        if ("/api/auth/login".equals(path)) {
            chain.doFilter(request, response);
            return;
        }

        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Content-Type-Options", "nosniff");
        // Preflight has header names, not credentials. MVC still validates origin/headers.
        if (CorsUtils.isPreFlightRequest(request)) {
            chain.doFilter(request, response);
            return;
        }

        String provided = extractToken(request, path);
        if (provided != null && constantTimeEquals(provided, sessionToken.token())) {
            chain.doFilter(request, response);
            return;
        }

        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        // 不在 401 响应里回显 token，避免被浏览器缓存泄漏
        response.getWriter().write("{\"error\":\"unauthorized\",\"message\":\"请先使用家庭账号登录\"}");
    }

    private String extractToken(HttpServletRequest request, String path) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) return header.substring(7).trim();
        String h2 = request.getHeader("X-Myhouse-Token");
        if (h2 != null && !h2.isBlank()) return h2.trim();
        // Only media GET/HEAD may use a query key; never allow it to authorize writes.
        if (("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod()))
                && path.matches("/api/attachments/[0-9]+/content")) return request.getParameter("token");
        return null;
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) return false;
        byte[] ab = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(ab, bb);
    }
}
