package com.xyblue.itemnest.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.security.MessageDigest;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.cors.CorsUtils;

/**
 * 家庭共享密钥鉴权：配置后所有 API 请求都需要认证，包括本机反向代理。
 * 客户端必须通过以下任一方式提供 token：
 *   1) Authorization: Bearer <token>
 *   2) X-ItemNest-Token: <token>
 *   3) URL 查询参数 ?token=<token>（仅附件内容 GET/HEAD）
 *
 * 静态资源放行。未配置密钥只允许本机监听；公网部署必须配置密钥和 HTTPS。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class LanAuthFilter extends OncePerRequestFilter {

    private static final Set<String> LOOPBACK = Set.of("127.0.0.1", "localhost", "::1", "[::1]", "0:0:0:0:0:0:0:1");
    private static final Set<String> PROTECTED_PREFIXES = Set.of("/api/");

    private final String lanToken;
    private final String bindAddress;

    public LanAuthFilter(@Value("${itemnest.lan-token:#{null}}") String configured,
                          @Value("${server.address:127.0.0.1}") String bind,
                          @Value("${itemnest.require-auth:false}") boolean requireAuth) {
        this.lanToken = configured == null || configured.isBlank() ? null : configured.trim();
        this.bindAddress = bind == null ? "127.0.0.1" : bind.trim();
        if (lanToken == null && (requireAuth || !LOOPBACK.contains(this.bindAddress))) {
            throw new IllegalStateException("公开监听需要设置 ITEMNEST_ACCESS_TOKEN（至少 32 位随机字符）");
        }
        if (lanToken != null && lanToken.length() < 32) {
            throw new IllegalStateException("ITEMNEST_ACCESS_TOKEN / ITEMNEST_LAN_TOKEN 至少需要 32 位随机字符");
        }
    }

    private boolean authRequired() {
        return lanToken != null;
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

        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Content-Type-Options", "nosniff");
        // Preflight has header names, not credentials. MVC still validates origin/headers.
        if (!authRequired() || CorsUtils.isPreFlightRequest(request)) {
            chain.doFilter(request, response);
            return;
        }

        String provided = extractToken(request, path);
        if (provided != null && constantTimeEquals(provided, lanToken)) {
            chain.doFilter(request, response);
            return;
        }

        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        // 不在 401 响应里回显 lanToken，避免被浏览器缓存泄漏
        response.getWriter().write("{\"error\":\"unauthorized\",\"message\":\"请填写有效的家庭访问密钥\"}");
    }

    private String extractToken(HttpServletRequest request, String path) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) return header.substring(7).trim();
        String h2 = request.getHeader("X-ItemNest-Token");
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
