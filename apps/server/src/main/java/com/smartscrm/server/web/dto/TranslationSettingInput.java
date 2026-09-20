package com.smartscrm.server.web.dto;

/**
 * PUT /api/translation/settings 的入参是**局部提交**：每个字段不传即保留库里现值，
 * 所以这里没有任何 @NotBlank —— 校验挡在方法之前，会把"只带改动字段"的请求整个否掉，
 * 页面就被迫整表回写，而整表回写拿的是打开页面时的那份快照，会盖掉之后的其他写入。
 *
 * 唯一不能放开的是两个目标语言：它们非空，但这条约束归 service 管
 * （TranslationService.langOrKeep）—— 不传则保留现值，传了空白才报 40000。
 * 源语言可以留空，留空就是 auto。
 */
public record TranslationSettingInput(
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
