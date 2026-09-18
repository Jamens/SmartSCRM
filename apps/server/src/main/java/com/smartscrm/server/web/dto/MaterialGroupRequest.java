package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record MaterialGroupRequest(
    @NotBlank String name,
    Integer sort
) {
}
