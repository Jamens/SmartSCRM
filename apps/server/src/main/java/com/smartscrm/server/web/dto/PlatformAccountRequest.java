package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record PlatformAccountRequest(
    @NotNull Integer platformType,
    @NotBlank String name,
    String phone,
    String avatar,
    @NotBlank String viewId,
    String remark
) {
}
