package com.xyblue.myhouse.controller;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 家庭账号登录：/api/auth/login 免鉴权可访问；凭据正确时发放访问密钥 token；
 * 未配置账号返回 503，凭据错误返回 401。
 */
@SpringBootTest(properties = {
    "myhouse.data-dir=target/test-data-auth", "myhouse.rabbitmq.enabled=false",
    "server.address=127.0.0.1"
})
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AuthLoginTests {
    @Autowired MockMvc mvc;
    @Autowired com.xyblue.myhouse.service.SessionTokenStore sessionToken;
    private static final Path ACCOUNT = Path.of("target/test-data-auth/account.json");

    private static void writeAccount(String username, String password) throws Exception {
        byte[] salt = HexFormat.of().parseHex("00112233445566778899aabbccddeeff");
        String hash = HexFormat.of().formatHex(
            MessageDigest.getInstance("SHA-256").digest((HexFormat.of().formatHex(salt) + ":" + password).getBytes(StandardCharsets.UTF_8)));
        String json = "{\"username\":\"" + username + "\",\"salt\":\"" + HexFormat.of().formatHex(salt)
            + "\",\"passwordHash\":\"" + hash + "\"}";
        Files.createDirectories(ACCOUNT.getParent());
        Files.writeString(ACCOUNT, json);
    }

    @Test
    @Order(1)
    void loginWithoutConfiguredAccountIsRejected() throws Exception {
        Files.deleteIfExists(ACCOUNT);
        mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"xyblue\",\"password\":\"whatever\"}"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.message").value(
                org.hamcrest.Matchers.containsString("未配置家庭账号")));
    }

    @Test
    @Order(2)
    void wrongPasswordIsRejectedWithGenericMessage() throws Exception {
        writeAccount("xyblue", "right-password");
        mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"xyblue\",\"password\":\"wrong-password\"}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.message").value("账号或密码不正确"));
    }

    @Test
    @Order(3)
    void correctCredentialsReturnSessionToken() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"xyblue\",\"password\":\"right-password\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.token").value(sessionToken.token()))
            .andExpect(jsonPath("$.username").value("xyblue"));
    }

    @Test
    @Order(4)
    void issuedTokenAuthenticatesRegularApiCalls() throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .get("/api/connection").header("Authorization", "Bearer " + sessionToken.token()))
            .andExpect(status().isOk());
    }
}
