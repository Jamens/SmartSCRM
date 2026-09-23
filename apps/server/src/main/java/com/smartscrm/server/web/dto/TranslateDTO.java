package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record TranslateDTO(
    @NotBlank(message = "text 不能为空") @Size(max = 5000, message = "text 最长 5000 字符") String text,
    @NotBlank(message = "type 不能为空") String type,
    Boolean input,
    Boolean noCache,
    /** 可空：带上即按该客户的语向解析（scope=customer 覆盖行优先，缺省回全局）。 */
    Long customerId,
    /**
     * 可空：不带即按全局译，P5 的调用方一字不改。
     * 生效语向的解析顺序固定为 显式 customerId -> (tenantId, accountId, chatKey) 的会话投影 -> 全局，
     * 会话投影是显式 customerId 的缺省填充，不是能压过它的另一条通道。
     * 128 与 `chat_conversation.chat_key` 同宽：主进程在盖章处已经裁过一刀，这一层是给
     * 直接打 HTTP 的调用方（记录页、契约脚本）留的兜底，超长只可能是坏请求而不是长会话。
     */
    @Size(max = 128, message = "chatKey 最长 128 字符") String chatKey,
    /** 与 chatKey 成对出现：只有 accountId 没有 chatKey 时后端不做投影。 */
    Long accountId
) {
}
