package com.smartscrm.server.service.provider;

/**
 * One real translation vendor behind an adapter channel. Providers are stateless Spring
 * beans; per-tenant keys arrive as {@link Credentials} on every call so a single bean can
 * serve any tenant.
 */
public interface TranslationProvider {

    /** Stable id stored in `translation_credential.provider`: "baidu", "tencent", ... */
    String providerId();

    /** Whether this vendor's language map covers both codes. Blank fromLang means "auto". */
    boolean supports(String fromLang, String toLang);

    ProviderResult translate(Credentials creds, String text, String fromLang, String toLang);
}
