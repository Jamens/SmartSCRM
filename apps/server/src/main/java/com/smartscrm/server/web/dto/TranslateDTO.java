package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record TranslateDTO(
    @NotBlank(message = "text 不能为空") @Size(max = 5000, message = "text 最长 5000 字符") String text,
    @NotBlank(message = "type 不能为空") String type,
    Boolean input,
    Boolean noCache,
    /** 可空：会话档没命中时用它定位客户档；不带则由 `accountId` + `chatKey` 投影出会话挂的客户。 */
    Long customerId,
    /**
     * 可空：不带即按全局译，P5 的调用方一字不改。
     * 生效档的解析顺序固定为 conversation 档 -> customer 档 -> global（spec §3.2 / 裁定 D-01），
     * 与请求带了哪几个字段无关：`accountId` + `chatKey` 齐备就先查会话档，命中即止；
     * 没命中才取 `customerId`（显式带的那一个，或由 `chatKey` 投影出来的那一位）查客户档。
     * 128 与 `chat_conversation.chat_key` 同宽：主进程在盖章处已经裁过一刀，这一层是给
     * 直接打 HTTP 的调用方（记录页、契约脚本）留的兜底，超长只可能是坏请求而不是长会话。
     */
    @Size(max = 128, message = "chatKey 最长 128 字符") String chatKey,
    /** 与 chatKey 成对出现：只有 accountId 没有 chatKey 时后端不做投影。 */
    Long accountId
) {
}
