package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import java.time.OffsetDateTime;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class HealthController {

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/health")
    public ApiResponse<Map<String, String>> health() {
        String dbVersion = jdbcTemplate.queryForObject("SELECT VERSION()", String.class);
        return ApiResponse.ok(Map.of(
            "app", "scrm-server",
            "dbVersion", String.valueOf(dbVersion),
            "time", OffsetDateTime.now().toString()
        ));
    }
}
