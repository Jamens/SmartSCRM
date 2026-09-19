package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record CredentialTestDTO(
    @NotBlank(message = "provider 不能为空") String provider
) {
}
