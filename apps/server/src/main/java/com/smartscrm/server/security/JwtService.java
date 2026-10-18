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
        @Value("${app.jwt.access-ttl-seconds:604800}") long accessTtlSeconds,
        @Value("${app.jwt.refresh-ttl-seconds:5184000}") long refreshTtlSeconds
    ) {
        // 密钥缺失/过短时给一句人话，而不是让 Keys.hmacShaKeyFor 抛 WeakKeyException。
        // 这里**刻意不做兜底默认值**：一个可预测的弱密钥等于没有鉴权，
        // 宁可启动失败。开发时复制 application-local.yml.example 填自己的值即可。
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                "SCRM_JWT_SECRET 未配置：JWT 签名密钥不得为空。"
                    + "本地开发请复制 src/main/resources/application-local.yml.example 为 "
                    + "application-local.yml 并填入 ≥32 字节的随机串（"
                    + "可用 openssl rand -base64 48 生成）");
        }
        byte[] raw = secret.getBytes(StandardCharsets.UTF_8);
        if (raw.length < 32) {
            throw new IllegalStateException(
                "SCRM_JWT_SECRET 长度不足：HMAC-SHA 要求至少 32 字节，当前 " + raw.length + " 字节");
        }
        this.key = Keys.hmacShaKeyFor(raw);
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
