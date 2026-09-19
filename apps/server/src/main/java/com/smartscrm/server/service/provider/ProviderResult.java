package com.smartscrm.server.service.provider;

/**
 * Online translation answer. {@code detectedFrom} is the provider's own source-language
 * detection when the caller sent an empty fromLang, otherwise the code we sent.
 */
public record ProviderResult(String translation, String detectedFrom) {
}
