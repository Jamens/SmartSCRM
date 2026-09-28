package com.smartscrm.server.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 创建群发任务的入参（spec §3）。
 * 四个间隔用包装类型 `Integer` 且 `@NotNull`：基本类型 `int` 会让"前端少传一个字段"静默变成 0，
 * 而 0 在演练档是合法值，这条链上就再也看不出是漏传还是故意。
 */
public class BatchTaskCreateDTO {

    @NotBlank
    @Size(max = 64)
    private String name;

    @NotBlank
    @Size(max = 16)
    private String platform;

    @NotNull
    private Boolean dryRun;

    @NotNull
    private List<Long> accountIds;

    @Valid
    @NotNull
    private List<BatchRecipientDTO> conversations;

    @Valid
    @NotNull
    private List<String> contents;

    @NotNull
    private Integer msgIntervalMin;

    @NotNull
    private Integer msgIntervalMax;

    @NotNull
    private Integer chatIntervalMin;

    @NotNull
    private Integer chatIntervalMax;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPlatform() {
        return platform;
    }

    public void setPlatform(String platform) {
        this.platform = platform;
    }

    public Boolean getDryRun() {
        return dryRun;
    }

    public void setDryRun(Boolean dryRun) {
        this.dryRun = dryRun;
    }

    public List<Long> getAccountIds() {
        return accountIds;
    }

    public void setAccountIds(List<Long> accountIds) {
        this.accountIds = accountIds;
    }

    public List<BatchRecipientDTO> getConversations() {
        return conversations;
    }

    public void setConversations(List<BatchRecipientDTO> conversations) {
        this.conversations = conversations;
    }

    public List<String> getContents() {
        return contents;
    }

    public void setContents(List<String> contents) {
        this.contents = contents;
    }

    public Integer getMsgIntervalMin() {
        return msgIntervalMin;
    }

    public void setMsgIntervalMin(Integer msgIntervalMin) {
        this.msgIntervalMin = msgIntervalMin;
    }

    public Integer getMsgIntervalMax() {
        return msgIntervalMax;
    }

    public void setMsgIntervalMax(Integer msgIntervalMax) {
        this.msgIntervalMax = msgIntervalMax;
    }

    public Integer getChatIntervalMin() {
        return chatIntervalMin;
    }

    public void setChatIntervalMin(Integer chatIntervalMin) {
        this.chatIntervalMin = chatIntervalMin;
    }

    public Integer getChatIntervalMax() {
        return chatIntervalMax;
    }

    public void setChatIntervalMax(Integer chatIntervalMax) {
        this.chatIntervalMax = chatIntervalMax;
    }
}
