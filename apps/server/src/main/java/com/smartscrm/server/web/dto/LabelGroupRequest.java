package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record LabelGroupRequest(
    @NotBlank String name,
    String color,
    Integer selectType,
    Integer sort
) {
}
