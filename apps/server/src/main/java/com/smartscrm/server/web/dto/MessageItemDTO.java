package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 一条归一化消息。字段名与桌面端 src/shared/chatTypes.ts 的 NormalizedMessage 一一对应。 */
public record MessageItemDTO(
    @NotBlank @Size(max = 128) String chatKey,
    @NotBlank @Size(max = 128) String msgKey,
    @NotBlank String direction,
    @Size(max = 128) String senderKey,
    @Size(max = 128) String senderName,
    String body,
    String mediaType,
    @Size(max = 256) String mediaSummary,
    @NotNull Long msgTimeEpochSec,
    String status,
    @NotBlank String source,
    @Size(max = 64) String sendLocalId,
    @Size(max = 256) String chatTitle
) {
}
