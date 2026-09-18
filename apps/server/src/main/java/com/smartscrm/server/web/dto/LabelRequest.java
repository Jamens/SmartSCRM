package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record LabelRequest(
    @NotBlank String name,
    String color,
    Integer sort
) {
}
