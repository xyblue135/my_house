package com.xyblue.itemnest.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "itemnest.data-dir=target/test-data-connection", "itemnest.rabbitmq.enabled=false",
    "itemnest.lan-token=test-only-0123456789abcdef0123456789abcdef", "server.address=127.0.0.1"
})
@AutoConfigureMockMvc
class ConnectionSecurityTests {
    private static final String TOKEN = "test-only-0123456789abcdef0123456789abcdef";
    @Autowired MockMvc mvc;
    @Autowired com.xyblue.itemnest.repository.InventoryRepository inventory;
    @Autowired com.xyblue.itemnest.service.AttachmentService attachments;

    @Test void activeDocumentAttachmentsDownloadInsteadOfExecuting() throws Exception {
        long containerId = ((Number) inventory.createContainer(java.util.Map.of(
            "name", "attachment-test-" + java.util.UUID.randomUUID(), "owner_id", 1)).get("id")).longValue();
        var file = new org.springframework.mock.web.MockMultipartFile("file", "test.html", "text/html", "<h1>Test</h1>".getBytes());
        long id = ((Number) attachments.saveForContainer(containerId, file).get("id")).longValue();
        try {
            mvc.perform(get("/api/attachments/" + id + "/content").param("token", TOKEN))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Security-Policy", "sandbox"))
                .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("attachment;")));
        } finally { attachments.delete(id); inventory.deleteContainer(containerId); }
    }

    @Test void loopbackProxyCannotBypassAuthentication() throws Exception {
        mvc.perform(get("/api/connection").with(r -> { r.setRemoteAddr("127.0.0.1"); return r; }))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/connection").with(r -> { r.setRemoteAddr("::1"); return r; }))
            .andExpect(status().isUnauthorized());
    }

    @Test void ipv6ClientWithValidKeyCanConnect() throws Exception {
        mvc.perform(get("/api/connection").header("Authorization", "Bearer " + TOKEN)
            .with(r -> { r.setRemoteAddr("2001:db8::1234"); return r; }))
            .andExpect(status().isOk()).andExpect(jsonPath("$.service").value("itemnest"))
            .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test void androidPreflightAcceptsAuthorizationHeader() throws Exception {
        mvc.perform(get("/api/connection").header("Origin", "https://localhost"))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("Access-Control-Allow-Origin", "https://localhost"));
        mvc.perform(options("/api/members").header("Origin", "https://localhost")
            .header("Access-Control-Request-Method", "POST")
            .header("Access-Control-Request-Headers", "authorization,content-type,x-itemnest-token"))
            .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "https://localhost"));
        mvc.perform(options("/api/members").header("Origin", "https://untrusted.example")
            .header("Access-Control-Request-Method", "POST"))
            .andExpect(status().isForbidden());
    }

    @Test void queryKeyNeverAuthorizesWritesOrGeneralApiReads() throws Exception {
        mvc.perform(post("/api/members").param("token", TOKEN).contentType("application/json").content("{\"name\":\"bad\"}"))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/connection").param("token", TOKEN)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/attachments/999999999/content").param("token", TOKEN))
            .andExpect(status().isNotFound());
    }

    @Test void publicListenerRequiresStrongKeyIncludingIpv6() {
        assertThatThrownBy(() -> new LanAuthFilter("", "::", false)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new LanAuthFilter("", "0.0.0.0", false)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new LanAuthFilter("", "127.0.0.1", true)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new LanAuthFilter("itemnest-lan", "127.0.0.1", false)).isInstanceOf(IllegalStateException.class);
        new LanAuthFilter("", "::1", false);
        new LanAuthFilter(TOKEN, "::", true);
    }
}
