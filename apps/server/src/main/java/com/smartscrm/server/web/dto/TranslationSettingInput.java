package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;

public record TranslationSettingInput(
    String server,
    String serverMode,
    String channel,
    Boolean receiveEnabled,
    String receiveFromLang,
    @NotBlank(message = "receiveToLang 不能为空") String receiveToLang,
    Boolean sendEnabled,
    String sendFromLang,
    @NotBlank(message = "sendToLang 不能为空") String sendToLang,
    Boolean voiceEnabled,
    Boolean previewEnabled,
    Boolean enterToSend,
    Boolean disableChinese,
    Boolean disableChinesePreventSend
) {
}
