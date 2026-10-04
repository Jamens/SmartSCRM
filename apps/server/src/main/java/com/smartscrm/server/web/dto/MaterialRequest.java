package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * B17 P1 — material create/update payload.
 *
 * <p>{@code ownerKey} is honoured only for {@code contact} scope (it is the customer id).
 * For {@code personal} the backend stamps the caller's own user id regardless of what is
 * sent here, and for {@code public} the key is cleared — see
 * {@code MaterialScope#keyFor}.
 */
public record MaterialRequest(
    Long groupId,
    @NotNull Integer type,
    @NotBlank String name,
    @NotBlank String url,
    String mimeType,
    Long sizeBytes,
    String remark,
    /** public | personal | contact；缺省按 public 处理。 */
    String ownerScope,
    /** 仅 contact 档需要：客户 id。personal 档不接受客户端指定。 */
    String ownerKey
) {
}
