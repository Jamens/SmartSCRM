package com.smartscrm.server.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.smartscrm.server.mapper.AdminPermissionMapper;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.method.HandlerMethod;

class AdminPermissionInterceptorTest {

    private AdminPermissionMapper mapper;
    private AdminPermissionInterceptor interceptor;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        mapper = mock(AdminPermissionMapper.class);
        interceptor = new AdminPermissionInterceptor(mapper);
    }

    private void authenticate(boolean platformScope, long userId) {
        AuthPrincipal p = new AuthPrincipal(userId, platformScope ? null : 10L, "IC", "owner",
                platformScope, Set.of());
        Authentication auth = new UsernamePasswordAuthenticationToken(p, null, Set.of());
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    private boolean run(String uri) throws Exception {
        var req = new MockHttpServletRequest("GET", uri);
        req.setRequestURI(uri);
        var res = new MockHttpServletResponse();
        return interceptor.preHandle(req, res, new Object());
    }

    @Test
    void preHandle_skipsLookup_whenPathIsNotAdmin() throws Exception {
        authenticate(false, 1L);

        boolean ok = run("/api/customers");

        assertTrue(ok);
        verifyNoInteractions(mapper);
    }

    @Test
    void preHandle_skipsLookup_whenPrincipalIsNotAuthPrincipal() throws Exception {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("anonymous", null, Set.of()));

        boolean ok = run("/api/admin/menus");

        assertTrue(ok);
        verifyNoInteractions(mapper);
    }

    @Test
    void preHandle_skipsLookup_whenUnauthenticated() throws Exception {
        boolean ok = run("/api/admin/menus");

        assertTrue(ok);
        verifyNoInteractions(mapper);
    }

    @Test
    void preHandle_populatesMenuCodes_forAdminPath() throws Exception {
        authenticate(true, 7L);
        when(mapper.selectMenuCodesByUserId(7L)).thenReturn(Set.of("tenant:list", "tenant:view"));

        boolean ok = run("/api/admin/menus");

        assertTrue(ok);
        AuthPrincipal after = (AuthPrincipal) SecurityContextHolder.getContext()
                .getAuthentication().getPrincipal();
        assertEquals(Set.of("tenant:list", "tenant:view"), after.menuCodes());
        verify(mapper).selectMenuCodesByUserId(7L);
    }

    @Test
    void preHandle_setsEmptyCodes_whenUserHasNoRoles() throws Exception {
        authenticate(false, 3L);
        when(mapper.selectMenuCodesByUserId(3L)).thenReturn(Set.of());

        run("/api/admin/roles");

        AuthPrincipal after = (AuthPrincipal) SecurityContextHolder.getContext()
                .getAuthentication().getPrincipal();
        assertTrue(after.menuCodes().isEmpty());
    }

    @Test
    void preHandle_setsEmptyCodes_whenMapperReturnsNull() throws Exception {
        authenticate(false, 3L);
        when(mapper.selectMenuCodesByUserId(3L)).thenReturn(null);

        run("/api/admin/roles");

        AuthPrincipal after = (AuthPrincipal) SecurityContextHolder.getContext()
                .getAuthentication().getPrincipal();
        assertTrue(after.menuCodes().isEmpty(), "null from mapper must degrade to empty set");
    }

    @Test
    void preHandle_preservesPlatformScopeFlag() throws Exception {
        authenticate(true, 9L);
        when(mapper.selectMenuCodesByUserId(9L)).thenReturn(Set.of("tenant:list"));

        run("/api/admin/menus");

        AuthPrincipal after = (AuthPrincipal) SecurityContextHolder.getContext()
                .getAuthentication().getPrincipal();
        assertTrue(after.platformScope());
        assertNull(after.tenantId());
    }

    @Test
    void preHandle_keepsTenantId_forTenantScopedCaller() throws Exception {
        authenticate(false, 4L);
        when(mapper.selectMenuCodesByUserId(4L)).thenReturn(Set.of("role:list"));

        run("/api/admin/menus");

        AuthPrincipal after = (AuthPrincipal) SecurityContextHolder.getContext()
                .getAuthentication().getPrincipal();
        assertFalse(after.platformScope());
        assertEquals(10L, after.tenantId());
    }

    @Test
    void preHandle_replacesAuthenticationWithSameIdentity() throws Exception {
        authenticate(false, 5L);
        when(mapper.selectMenuCodesByUserId(5L)).thenReturn(Set.of("user:list"));
        Authentication before = SecurityContextHolder.getContext().getAuthentication();

        run("/api/admin/teams");

        Authentication after = SecurityContextHolder.getContext().getAuthentication();
        assertSame(before.getCredentials(), after.getCredentials());
        assertEquals(((AuthPrincipal) before.getPrincipal()).userId(),
                ((AuthPrincipal) after.getPrincipal()).userId());
    }

    @Test
    void preHandle_doesNotQuery_forAdminPathWhenPrincipalAbsent() throws Exception {
        run("/api/admin/menus");

        verify(mapper, never()).selectMenuCodesByUserId(anyLong());
    }

    @Test
    void preHandle_publishesCodesAsAuthorities() throws Exception {
        // @PreAuthorize("hasAuthority('tenant:list')") resolves against the authority
        // collection, not the principal, so the codes must land there or every check denies.
        authenticate(true, 11L);
        when(mapper.selectMenuCodesByUserId(11L)).thenReturn(Set.of("tenant:list", "tenant:view"));

        run("/api/admin/menus");

        Authentication after = SecurityContextHolder.getContext().getAuthentication();
        assertTrue(after.getAuthorities().stream()
                .anyMatch(g -> "tenant:list".equals(g.getAuthority())));
        assertTrue(after.getAuthorities().stream()
                .anyMatch(g -> "tenant:view".equals(g.getAuthority())));
    }

    @Test
    void preHandle_keepsLegacyRoleAuthority() throws Exception {
        // JwtAuthFilter grants ROLE_<role>; dropping it would break any existing check.
        AuthPrincipal p = new AuthPrincipal(12L, 10L, "IC", "owner", false, Set.of());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(p, null,
                        List.of(new SimpleGrantedAuthority("ROLE_OWNER"))));
        when(mapper.selectMenuCodesByUserId(12L)).thenReturn(Set.of("role:list"));

        run("/api/admin/roles");

        Authentication after = SecurityContextHolder.getContext().getAuthentication();
        assertTrue(after.getAuthorities().stream()
                .anyMatch(g -> "ROLE_OWNER".equals(g.getAuthority())), "legacy authority must survive");
        assertTrue(after.getAuthorities().stream()
                .anyMatch(g -> "role:list".equals(g.getAuthority())));
    }

    @Test
    void preHandle_authoritiesEmpty_whenNoGrants() throws Exception {
        AuthPrincipal p = new AuthPrincipal(13L, null, "IC", "owner", true, Set.of());
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(p, null, List.of()));
        when(mapper.selectMenuCodesByUserId(13L)).thenReturn(Set.of());

        run("/api/admin/menus");

        Authentication after = SecurityContextHolder.getContext().getAuthentication();
        assertTrue(after.getAuthorities().isEmpty());
    }

    // ===== A16 桌面侧授权（业务路径）· 反向证据 =====
    // 正向（有码→放行）已用真接口验过；这里补反向：未授予的码不会被 publish，
    // 因此 @PreAuthorize("hasAuthority('该码')") 必然拒绝。mock 即可，不建真实用户。

    /** 带/不带 @PreAuthorize 的哑控制器，用来造业务端点的 HandlerMethod。 */
    static class Biz {
        @PreAuthorize("hasAuthority('label:read')")
        public void guarded() {}
        public void plain() {}
    }

    private static HandlerMethod handlerFor(String method) throws Exception {
        Method m = Biz.class.getMethod(method);
        return new HandlerMethod(new Biz(), m);
    }

    private void runBiz(String uri, Object handler) throws Exception {
        var req = new MockHttpServletRequest("GET", uri);
        req.setRequestURI(uri);
        interceptor.preHandle(req, new MockHttpServletResponse(), handler);
    }

    private Set<String> businessCodes() {
        return SecurityContextHolder.getContext().getAuthentication().getAuthorities().stream()
            .map(g -> g.getAuthority())
            .filter(s -> !s.startsWith("ROLE_"))
            .collect(java.util.stream.Collectors.toSet());
    }

    /** 反向核心：只授予 label:read 时，未授予的 label:write 绝不能进 authority（否则误放行）。 */
    @Test
    void businessAuthzHandler_publishesOnlyGranted_ungrantedAbsent() throws Exception {
        authenticate(false, 7L);
        when(mapper.selectMenuCodesByUserId(7L)).thenReturn(Set.of("label:read"));

        runBiz("/api/label-groups", handlerFor("guarded"));

        assertTrue(businessCodes().contains("label:read"), "授予的码应被 publish");
        assertFalse(businessCodes().contains("label:write"), "未授予的码不能被 publish");
    }

    /** 空授权角色（无任何码）→ authority 里没有业务码，标注端点全部会被拒。 */
    @Test
    void businessAuthzHandler_emptyGrant_publishesNoBusinessCode() throws Exception {
        authenticate(false, 8L);
        when(mapper.selectMenuCodesByUserId(8L)).thenReturn(Set.of());

        runBiz("/api/label-groups", handlerFor("guarded"));

        assertTrue(businessCodes().isEmpty(), "空授权不应产生任何业务 authority");
    }

    /** 业务端点带 @PreAuthorize：会查库并 publish（桌面侧判定生效的路径）。 */
    @Test
    void businessAuthzHandler_resolvesPermissions() throws Exception {
        authenticate(false, 7L);
        when(mapper.selectMenuCodesByUserId(7L)).thenReturn(Set.of("label:read"));

        runBiz("/api/label-groups", handlerFor("guarded"));

        verify(mapper).selectMenuCodesByUserId(7L);
    }

    /** 业务端点没带 @PreAuthorize：一次库都不查（零成本、零行为变更的守卫）。 */
    @Test
    void businessPlainHandler_skipsLookup() throws Exception {
        authenticate(false, 7L);

        runBiz("/api/messages/unread-total", handlerFor("plain"));

        verifyNoInteractions(mapper);
    }
}
