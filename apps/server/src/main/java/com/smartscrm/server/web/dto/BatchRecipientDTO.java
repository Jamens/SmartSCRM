package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 一条收件人寻址：账号 + 会话键，对应 `chat_conversation(tenant_id, account_id, chat_key)`。
 * 本项目 DTO 用显式 getter/setter（不用 Lombok @Data），形制照 `web/dto/AudienceRequest.java` 的字段声明。
 */
public class BatchRecipientDTO {

    @NotNull
    private Long accountId;

    @NotBlank
    @Size(max = 128)
    private String chatKey;

    public Long getAccountId() {
        return accountId;
    }

    public void setAccountId(Long accountId) {
        this.accountId = accountId;
    }

    public String getChatKey() {
        return chatKey;
    }

    public void setChatKey(String chatKey) {
        this.chatKey = chatKey;
    }
}
