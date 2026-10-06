package com.smartscrm.server.service.media;

import com.smartscrm.server.service.provider.Credentials;

/**
 * One media-understanding backend behind an OCR/ASR adapter. Engines are stateless Spring beans;
 * per-tenant keys arrive as {@link Credentials} on every call so a single bean can serve any tenant.
 * A real vendor that cannot answer (missing key, network, quota) throws {@link
 * com.smartscrm.server.service.provider.ProviderException} so the caller falls back to the local
 * simulated engine — the same "本地模拟优先" contract as {@code TranslationProvider}.
 */
public interface MediaEngine {

    /** Stable id stored in the engine map: "tencent", "simulated", ... */
    String providerId();

    /** OCR: image bytes -> extracted plain text. Throws to trigger the simulated fallback. */
    String ocr(Credentials creds, byte[] image, String mime);

    /** ASR: audio bytes -> transcribed plain text. Throws to trigger the simulated fallback. */
    String asr(Credentials creds, byte[] audio, String mime);
}
