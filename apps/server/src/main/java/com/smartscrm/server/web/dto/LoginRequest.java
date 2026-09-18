package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
    @NotBlank String username,
    @NotBlank String password,
    @NotBlank String inviteCode,
    @NotBlank String deviceId,
    String deviceName,
    String osVersion
) {
}
