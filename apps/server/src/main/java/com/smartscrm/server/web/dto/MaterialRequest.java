package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record MaterialRequest(
    Long groupId,
    @NotNull Integer type,
    @NotBlank String name,
    @NotBlank String url,
    String mimeType,
    Long sizeBytes,
    String remark
) {
}
