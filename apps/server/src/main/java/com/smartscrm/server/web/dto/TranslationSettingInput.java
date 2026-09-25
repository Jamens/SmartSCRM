package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.Size;

/**
 * PUT /api/translation/settings 的入参是**局部提交**：每个字段不传即保留库里现值，
 * 所以这里没有任何 @NotBlank —— 校验挡在方法之前，会把"只带改动字段"的请求整个否掉，
 * 页面就被迫整表回写，而整表回写拿的是打开页面时的那份快照，会盖掉之后的其他写入。
 *
 * 唯一不能放开的是两个目标语言：它们非空，但这条约束归 service 管
 * （TranslationService.langOrKeep）—— 不传则保留现值，传了空白才报 40000。
 * 源语言可以留空，留空就是 auto。
 * <p>
 * `chatKey` 上的 `@Size(max = 128)` 是**顺手的早退**，不是权威：真正的长度闸在
 * `ConversationScopeKey.rejectReason`（常量 `CHAT_KEY_MAX` 在那里），写入与删除两条路都过它。
 * 两处数字万一不同步，先触发的是 `@Valid`，走 `GlobalExceptionHandler.handleValidation`
 * 也是 `HTTP 400 + code:40000`，只是文案换成 `chatKey 最长 128 字符`。
 * 所以 Task 5 第 5b 行断的是 `code===40000` 而不是具体文案——两道闸谁先响都算守住。
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
    Boolean disableChinesePreventSend,
    /** 可空：缺省即 global；'customer' 时必须带 scopeKey=客户 id；'conversation' 时不接受 scopeKey。 */
    String scope,
    String scopeKey,
    /** scope='conversation' 时必填：`platform_account` 主键。会话档的键由服务端合成，这里只交半件。 */
    Long accountId,
    /** 原样 chat_key（含 `@c.us` / `@g.us` 后缀），不 trim、不折叠大小写。 */
    @Size(max = 128, message = "chatKey 最长 128 字符")
    String chatKey
) {
}
