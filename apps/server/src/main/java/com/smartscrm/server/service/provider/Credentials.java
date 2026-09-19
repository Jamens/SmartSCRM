package com.smartscrm.server.service.provider;

/** Server-side credentials for one online translation provider. Never leaves the backend. */
public record Credentials(String appId, String secret, String region) {
}
