package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record QuickReplyGroupRequest(
    @NotBlank String name,
    Integer sort
) {
}
