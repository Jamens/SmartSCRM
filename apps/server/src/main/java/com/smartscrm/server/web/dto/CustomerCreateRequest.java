package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * openId 必填的理由：`uk_customer_tenant_platform_openid` 是 NOT NULL 的唯一键，
 * 且 P6 的客户匹配靠的就是"`open_id` 与 `chat_key` 同形"（收敛 4）。
 * 手机号能靠"建为客户"按钮预填，但不能当主键——同号可多平台。
 */
public record CustomerCreateRequest(
    @NotNull(message = "platformType 不能为空") Integer platformType,
    @NotBlank(message = "openId 不能为空") @Size(max = 128) String openId,
    @Size(max = 128) String nickname,
    @Size(max = 64) String phone,
    @Size(max = 128) String email,
    @Size(max = 64) String country,
    @Size(max = 255) String remark,
    Integer sex
) {
}
