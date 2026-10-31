package com.xyblue.myhouse.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.xyblue.myhouse.service.SessionTokenStore;

/**
 * 会话令牌鉴权：所有 API 默认 401，附件媒体可用查询参数，登录端点免鉴权，
 * 查询参数永不授权写入。令牌由 SessionTokenStore 在启动时自动生成。
 */
@SpringBootTest(properties = {
    "myhouse.data-dir=target/test-data-connection", "myhouse.rabbitmq.enabled=false",
    "server.address=127.0.0.1"
})
@AutoConfigureMockMvc
class ConnectionSecurityTests {
    @Autowired MockMvc mvc;
    @Autowired SessionTokenStore sessionToken;
    @Autowired com.xyblue.myhouse.repository.InventoryRepository inventory;
    @Autowired com.xyblue.myhouse.service.AttachmentService attachments;

    private String token() { return sessionToken.token(); }

    @Test void activeDocumentAttachmentsDownloadInsteadOfExecuting() throws Exception {
        long containerId = ((Number) inventory.createContainer(java.util.Map.of(
            "name", "attachment-test-" + java.util.UUID.randomUUID(), "owner_id", 1)).get("id")).longValue();
        var file = new org.springframework.mock.web.MockMultipartFile("file", "test.html", "text/html", "<h1>Test</h1>".getBytes());
        long id = ((Number) attachments.saveForContainer(containerId, file).get("id")).longValue();
        try {
            mvc.perform(get("/api/attachments/" + id + "/content").param("token", token()))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Security-Policy", "sandbox"))
                .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("attachment;")));
        } finally { attachments.delete(id); inventory.deleteContainer(containerId); }
    }

    @Test void requestsWithoutSessionTokenAreUnauthorized() throws Exception {
        mvc.perform(get("/api/connection").with(r -> { r.setRemoteAddr("127.0.0.1"); return r; }))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/connection").with(r -> { r.setRemoteAddr("::1"); return r; }))
            .andExpect(status().isUnauthorized());
    }

    @Test void ipv6ClientWithSessionTokenCanConnect() throws Exception {
        mvc.perform(get("/api/connection").header("Authorization", "Bearer " + token())
            .with(r -> { r.setRemoteAddr("2001:db8::1234"); return r; }))
            .andExpect(status().isOk()).andExpect(jsonPath("$.service").value("myhouse"))
            .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test void androidPreflightAcceptsAuthorizationHeader() throws Exception {
        mvc.perform(get("/api/connection").header("Origin", "https://localhost"))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("Access-Control-Allow-Origin", "https://localhost"));
        mvc.perform(options("/api/members").header("Origin", "https://localhost")
            .header("Access-Control-Request-Method", "POST")
            .header("Access-Control-Request-Headers", "authorization,content-type,x-myhouse-token"))
            .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "https://localhost"));
        mvc.perform(options("/api/members").header("Origin", "https://untrusted.example")
            .header("Access-Control-Request-Method", "POST"))
            .andExpect(status().isForbidden());
    }

    @Test void loginEndpointIsReachableWithoutTokenAndQueryKeyNeverAuthorizesWrites() throws Exception {
        // 登录端点免鉴权可访问（测试数据目录未配置账号，由控制器返回 503 而不是过滤器的 401）
        mvc.perform(post("/api/auth/login").contentType("application/json").content("{}"))
            .andExpect(status().isServiceUnavailable());
        mvc.perform(post("/api/members").param("token", token()).contentType("application/json").content("{\"name\":\"bad\"}"))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/connection").param("token", token())).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/attachments/999999999/content").param("token", token()))
            .andExpect(status().isNotFound());
    }
}
