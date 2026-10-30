package com.xyblue.myhouse.controller;

import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ConnectionController {
    private final JdbcTemplate jdbc;
    public ConnectionController(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @GetMapping("/api/connection")
    public Map<String, Object> connection() {
        jdbc.queryForObject("SELECT 1", Integer.class);
        return Map.of("service", "myhouse", "api_version", 1, "status", "ok");
    }
}
