package com.smartscrm.server.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** 预览入参：只需要收件人与内容，任务名与间隔都不参与渲染。 */
public class BatchPreviewDTO {

    @Valid
    @NotNull
    private List<BatchRecipientDTO> conversations;

    @NotNull
    private List<String> contents;

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
}
