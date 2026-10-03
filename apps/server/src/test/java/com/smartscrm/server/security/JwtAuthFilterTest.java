package com.smartscrm.server.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import javax.crypto.SecretKey;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Regression tests for JWT parsing. The admin console introduces platform-level
 * accounts that have no tenant, so the {@code tid} claim is optional and a missing
 * claim must never throw.
 */
class JwtAuthFilterTest {

    private static final String SECRET = "smartscrm-local-dev-secret-key-please-change-32bytes-min";

    private JwtService jwtService;
    private JwtAuthFilter filter;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        jwtService = new JwtService(SECRET, 7200L, 2592000L);
        filter = new JwtAuthFilter(jwtService);
    }

    private String tokenWith(String tid, String role) {
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        var builder = Jwts.builder()
                .subject("1")
                .claim("ic", "INVITE")
                .claim("role", role)
                .claim("typ", "access")
                .issuedAt(Date.from(Instant.now()))
                .expiration(Date.from(Instant.now().plusSeconds(7200)))
                .signWith(key);
        if (tid != null) {
            builder.claim("tid", Long.valueOf(tid));
        }
        return builder.compact();
    }

    private Authentication runFilter(String token) throws Exception {
        var request = new org.springframework.mock.web.MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + token);
        var response = new org.springframework.mock.web.MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return SecurityContextHolder.getContext().getAuthentication();
    }

    @Test
    void doFilter_parsesPrincipal_whenTenantClaimPresent() throws Exception {
        Authentication auth = runFilter(tokenWith("10", "TENANT_ADMIN"));

        assertNotNull(auth);
        AuthPrincipal principal = (AuthPrincipal) auth.getPrincipal();
        assertEquals(1L, principal.userId());
        assertEquals(10L, principal.tenantId());
        assertEquals("INVITE", principal.inviteCode());
        assertEquals("TENANT_ADMIN", principal.role());
    }

    @Test
    void doFilter_tenantIdIsNull_whenTenantClaimAbsent() throws Exception {
        // Platform admins have no tenant; a missing tid claim must not throw NPE.
        Authentication auth = runFilter(tokenWith(null, "PLATFORM_ADMIN"));

        assertNotNull(auth);
        AuthPrincipal principal = (AuthPrincipal) auth.getPrincipal();
        assertNull(principal.tenantId());
        assertEquals(1L, principal.userId());
        assertEquals("PLATFORM_ADMIN", principal.role());
    }

    @Test
    void doFilter_principalCarriesPlatformScope_andEmptyMenuCodes_byDefault() throws Exception {
        Authentication auth = runFilter(tokenWith(null, "PLATFORM_ADMIN"));

        AuthPrincipal principal = (AuthPrincipal) auth.getPrincipal();
        assertNotNull(principal.menuCodes());
        assertTrue(principal.menuCodes().isEmpty());
    }

    @Test
    void doFilter_ignoresRefreshToken() throws Exception {
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        String refresh = Jwts.builder()
                .subject("1")
                .claim("tid", 10L)
                .claim("role", "TENANT_ADMIN")
                .claim("typ", "refresh")
                .issuedAt(Date.from(Instant.now()))
                .expiration(Date.from(Instant.now().plusSeconds(7200)))
                .signWith(key)
                .compact();

        Authentication auth = runFilter(refresh);

        assertNull(auth);
    }

    @Test
    void doFilter_ignoresGarbageToken() throws Exception {
        Authentication auth = runFilter("not-a-jwt");

        assertNull(auth);
    }

    @Test
    void parse_returnsNull_whenTokenGarbage() {
        assertNull(jwtService.parse("expired.token.value"));
    }

    @Test
    void issueAccessToken_roundTripsAllClaims() {
        String token = jwtService.issueAccessToken(7L, 42L, "CODE", "TENANT_ADMIN");
        Claims claims = jwtService.parse(token);

        assertNotNull(claims);
        assertEquals("7", claims.getSubject());
        assertEquals(42L, claims.get("tid", Number.class).longValue());
        assertEquals("CODE", claims.get("ic", String.class));
        assertEquals("TENANT_ADMIN", claims.get("role", String.class));
        assertEquals("access", claims.get("typ", String.class));
    }
}
