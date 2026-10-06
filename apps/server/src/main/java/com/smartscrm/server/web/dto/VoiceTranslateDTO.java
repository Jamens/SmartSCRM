package com.smartscrm.server.web.dto;

/**
 * POST /api/translation/voice 的入参。媒体内容以 base64 递交，服务端解码后交给 ASR 引擎。
 * 字段语义同 {@link ImageTranslateDTO}，仅媒体种类为语音。
 */
public record VoiceTranslateDTO(
    String type,
    /** 语音的 base64 编码（不含 data: 前缀）。 */
    String audioBase64,
    String mime,
    String fromLang,
    String toLang,
    Long customerId,
    Long accountId,
    String chatKey
) {
}
