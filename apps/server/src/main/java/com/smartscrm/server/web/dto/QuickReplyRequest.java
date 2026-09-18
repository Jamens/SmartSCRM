package com.smartscrm.server.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public record QuickReplyRequest(
    @NotBlank String title,
    Long groupId,
    String shortcut,
    Integer sort,
    @Valid @NotEmpty List<QuickReplyItemRequest> items
) {
}
