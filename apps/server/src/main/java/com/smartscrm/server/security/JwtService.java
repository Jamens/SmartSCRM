package com.smartscrm.server.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class JwtService {

    private final SecretKey key;
    private final long accessTtlSeconds;
    private final long refreshTtlSeconds;

    public JwtService(
        @Value("${app.jwt.secret}") String secret,
        @Value("${app.jwt.access-ttl-seconds:7200}") long accessTtlSeconds,
        @Value("${app.jwt.refresh-ttl-seconds:2592000}") long refreshTtlSeconds
    ) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTtlSeconds = accessTtlSeconds;
        this.refreshTtlSeconds = refreshTtlSeconds;
    }

    public long getAccessTtlSeconds() {
        return accessTtlSeconds;
    }

    public String issueAccessToken(Long userId, Long tenantId, String inviteCode, String role) {
        return build(userId, tenantId, inviteCode, role, "access", accessTtlSeconds);
    }

    public String issueRefreshToken(Long userId, Long tenantId, String inviteCode, String role) {
        return build(userId, tenantId, inviteCode, role, "refresh", refreshTtlSeconds);
    }

    private String build(Long userId, Long tenantId, String inviteCode, String role, String type, long ttl) {
        Instant now = Instant.now();
        return Jwts.builder()
            .subject(String.valueOf(userId))
            .id(UUID.randomUUID().toString())
            .claim("tid", tenantId)
            .claim("ic", inviteCode)
            .claim("role", role)
            .claim("typ", type)
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plusSeconds(ttl)))
            .signWith(key)
            .compact();
    }

    /** @return parsed claims, or null when the token is invalid/expired. */
    public Claims parse(String token) {
        try {
            return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
        } catch (Exception e) {
            return null;
        }
    }
}
