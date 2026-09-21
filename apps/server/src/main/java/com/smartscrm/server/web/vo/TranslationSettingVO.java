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
    Boolean disableChinesePreventSend,
    String scope,
    String scopeKey,
    /** true = 该客户没有覆盖行，这份设置来自全局（UI 据此显示「跟随全局」）。 */
    boolean inherited
) {
}
