package com.smartscrm.server.security;

public record AuthPrincipal(Long userId, Long tenantId, String inviteCode, String role) {
}
