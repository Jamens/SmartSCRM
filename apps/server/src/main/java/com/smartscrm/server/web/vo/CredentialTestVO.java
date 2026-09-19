package com.smartscrm.server.web.vo;

/** Result of the "测试" button: one real probe request against the vendor. */
public record CredentialTestVO(
    boolean ok,
    Long latencyMs,
    String message
) {
}
