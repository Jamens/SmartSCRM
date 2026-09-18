package com.smartscrm.server.web.dto;

public record LoginResponse(
    String accessToken,
    String refreshToken,
    long expiresIn,
    UserInfo user
) {

    public record UserInfo(
        Long id,
        String username,
        String nickname,
        String avatar,
        String role,
        Long tenantId,
        String inviteCode,
        String tenantName
    ) {
    }
}
