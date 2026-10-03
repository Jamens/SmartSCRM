package com.smartscrm.server.security;

import com.smartscrm.server.mapper.AdminPermissionMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Resolves admin permissions once per request and attaches them to the principal.
 *
 * <p>Permissions live in the database, not in the JWT. The access token now lasts a
 * week, so embedding menu codes would delay a revoked role by up to seven days.
 * Reading them per request means revocation takes effect on the very next call.
 *
 * <p>Only {@code /api/admin/**} pays the lookup; every other path is untouched, so
 * tenant-scoped desktop traffic keeps its current behaviour and cost.
 */
public class AdminPermissionInterceptor implements HandlerInterceptor {

    static final String ADMIN_PREFIX = "/api/admin/";

    private final AdminPermissionMapper permissionMapper;

    public AdminPermissionInterceptor(AdminPermissionMapper permissionMapper) {
        this.permissionMapper = permissionMapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!isAdminPath(request)) {
            return true;
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof AuthPrincipal principal)) {
            return true;
        }

        Set<String> codes = permissionMapper.selectMenuCodesByUserId(principal.userId());
        Set<String> granted = codes == null ? Collections.emptySet() : codes;
        AuthPrincipal enriched = new AuthPrincipal(
                principal.userId(),
                principal.tenantId(),
                principal.inviteCode(),
                principal.role(),
                principal.platformScope(),
                granted);

        // @PreAuthorize("hasAuthority('...')") reads the authority collection, not the
        // principal, so the resolved menu codes must be published there as well. Without
        // this the interceptor fills menuCodes but every check still denies.
        Set<GrantedAuthority> authorities = new HashSet<>();
        for (String code : granted) {
            authorities.add(new SimpleGrantedAuthority(code));
        }
        authorities.addAll(auth.getAuthorities());

        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(enriched, auth.getCredentials(), authorities));
        return true;
    }

    private boolean isAdminPath(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return uri != null && uri.startsWith(ADMIN_PREFIX);
    }
}
