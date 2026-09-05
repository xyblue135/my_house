package com.xyblue.itemnest.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;

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

/**
 * 局域网模式鉴权：当服务监听 0.0.0.0 且设置了 ITEMNEST_LAN_TOKEN 时启用。
 * 客户端必须通过以下任一方式提供 token：
 *   1) Authorization: Bearer <token>
 *   2) X-ItemNest-Token: <token>
 *   3) URL 查询参数 ?token=<token>（用于 Web 端 / PWA 初始化时不易加 Header）
 *
 * 同源（127.0.0.1 / localhost）请求自动放行；静态资源也放行。
 * 没有配置 token 时（默认 127.0.0.1）整个过滤器不生效。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class LanAuthFilter extends OncePerRequestFilter {

    private static final Set<String> STATIC_PREFIXES = Set.of("/sw.js", "/icons/", "/manifest.webmanifest");
    private static final Set<String> PROTECTED_PREFIXES = Set.of("/api/");

    private final String lanToken;
    private final String bindAddress;

    public LanAuthFilter(@Value("${itemnest.lan-token:#{null}}") String configured,
                          @Value("${ITEMNEST_BIND_ADDRESS:127.0.0.1}") String bind) {
        this.lanToken = configured == null || configured.isBlank() ? null : configured.trim();
        this.bindAddress = bind == null ? "127.0.0.1" : bind.trim();
    }

    private boolean authRequired() {
        return lanToken != null && !"127.0.0.1".equals(bindAddress) && !"localhost".equals(bindAddress);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!authRequired()) { chain.doFilter(request, response); return; }

        String path = request.getRequestURI();
        if (!PROTECTED_PREFIXES.stream().anyMatch(path::startsWith)) {
            chain.doFilter(request, response);
            return;
        }

        // 同源放行（避免本机浏览器被自己挡）
        String remote = request.getRemoteAddr();
        if (remote != null && (remote.equals("127.0.0.1") || remote.equals("0:0:0:0:0:0:0:1") || remote.equals("::1"))) {
            chain.doFilter(request, response);
            return;
        }

        String provided = extractToken(request);
        if (provided != null && constantTimeEquals(provided, lanToken)) {
            chain.doFilter(request, response);
            return;
        }

        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        // 不在 401 响应里回显 lanToken，避免被浏览器缓存泄漏
        response.getWriter().write("{\"error\":\"unauthorized\",\"message\":\"局域网访问需要有效 token（Authorization: Bearer <token>）\"}");
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) return header.substring(7).trim();
        String h2 = request.getHeader("X-ItemNest-Token");
        if (h2 != null && !h2.isBlank()) return h2.trim();
        return request.getParameter("token");
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) return false;
        byte[] ab = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        if (ab.length != bb.length) return false;
        int diff = 0;
        for (int i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
        return diff == 0;
    }
}
