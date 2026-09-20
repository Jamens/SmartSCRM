package com.smartscrm.server.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record MessageBatchDTO(
    @NotNull Long accountId,
    /** 当前视图里正打开的会话：不属于它的 in 消息才计未读。 */
    String activeChatKey,
    @NotEmpty @Size(max = 500) List<@Valid MessageItemDTO> messages
) {
}
