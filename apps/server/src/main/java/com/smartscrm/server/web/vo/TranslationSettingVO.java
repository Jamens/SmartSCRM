package com.smartscrm.server.web.vo;

public record TranslationSettingVO(
    Long id,
    String server,
    String serverMode,
    String channel,
    Boolean receiveEnabled,
    String receiveFromLang,
    String receiveToLang,
    Boolean sendEnabled,
    String sendFromLang,
    String sendToLang,
    Boolean voiceEnabled,
    Boolean previewEnabled,
    Boolean enterToSend,
    Boolean disableChinese,
    Boolean disableChinesePreventSend
) {
}
