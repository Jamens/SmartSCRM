package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record SensitiveWordCreateRequest(
    @NotBlank(message = "word 不能为空") String word,
    String category) {
}
