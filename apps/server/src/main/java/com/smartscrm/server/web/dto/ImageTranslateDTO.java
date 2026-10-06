package com.smartscrm.server.web.dto;

/**
 * POST /api/translation/image 的入参。媒体内容以 base64 递交（前端不持久化媒体字节，
 * 见 MessageBubble 的隐私口径），服务端解码后交给 OCR 引擎。fromLang/toLang 缺省时回落到
 * 当前生效行的接收/发送语向。
 */
public record ImageTranslateDTO(
    /** "receive" | "send"：决定用哪一组语向。 */
    String type,
    /** 图片的 base64 编码（不含 data: 前缀）。 */
    String imageBase64,
    /** 媒体 MIME，如 image/png；可空，仅用于厂商引擎的格式推断。 */
    String mime,
    String fromLang,
    String toLang,
    Long customerId,
    Long accountId,
    String chatKey
) {
}
