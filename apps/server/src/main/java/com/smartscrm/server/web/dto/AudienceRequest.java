package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record AudienceRequest(
    @NotBlank String name,
    Integer platformType,
    String keyword,
    java.util.List<Long> tagIds
) {
}
