package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotNull;

/**
 * B17 P3 — material create/update payload.
 *
 * <p>{@code url} and {@code buttonPayload} are mutually exclusive by type:
 * types 1–4 (media) require a non-blank {@code url}; type 5 (button) requires a valid
 * {@code buttonPayload} and carries no url. The service enforces this rather than bean
 * validation, because "which field is required" depends on another field's value.
 *
 * <p>{@code ownerKey} is honoured only for {@code contact} scope (customer id). For
 * {@code personal} the backend stamps the caller's own user id; see {@code MaterialScope#keyFor}.
 */
public record MaterialRequest(
    Long groupId,
    @NotNull Integer type,
    String name,
    String url,
    /** type=5 时的按钮载荷 JSON；其它类型忽略。 */
    String buttonPayload,
    String mimeType,
    Long sizeBytes,
    String remark,
    /** public | personal | contact；缺省按 public 处理。 */
    String ownerScope,
    /** 仅 contact 档需要：客户 id。personal 档不接受客户端指定。 */
    String ownerKey
) {
}
