package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AppUser;
import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.AppUserMapper;
import com.smartscrm.server.mapper.DeviceMapper;
import com.smartscrm.server.mapper.TenantMapper;
import com.smartscrm.server.security.JwtService;
import com.smartscrm.server.web.dto.LoginResponse;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.impl.DefaultClaims;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {

    private final TenantMapper tenantMapper = mock(TenantMapper.class);
    private final AppUserMapper userMapper = mock(AppUserMapper.class);
    private final DeviceMapper deviceMapper = mock(DeviceMapper.class);
    private final PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
    private final JwtService jwtService = mock(JwtService.class);

    private AuthService service() {
        return new AuthService(tenantMapper, userMapper, deviceMapper, passwordEncoder, jwtService);
    }

    private AppUser sampleUser() {
        AppUser u = new AppUser();
        u.setId(1L);
        u.setTenantId(10L);
        u.setUsername("admin");
        u.setPasswordHash("old-hash");
        u.setStatus(1);
        return u;
    }

    @Test
    void changePassword_updatesHash_whenOldMatchesAndNewDiffers() {
        AppUser u = sampleUser();
        when(userMapper.selectById(1L)).thenReturn(u);
        when(passwordEncoder.matches("old", "old-hash")).thenReturn(true);
        when(passwordEncoder.matches("new-password", "old-hash")).thenReturn(false);
        when(passwordEncoder.encode("new-password")).thenReturn("new-hash");

        service().changePassword(1L, "old", "new-password");

        assertEquals("new-hash", u.getPasswordHash());
        verify(userMapper).updateById(any(AppUser.class));
    }

    @Test
    void changePassword_rejects_wrongOldPassword() {
        AppUser u = sampleUser();
        when(userMapper.selectById(1L)).thenReturn(u);
        when(passwordEncoder.matches("wrong", "old-hash")).thenReturn(false);

        BizException ex = assertThrows(BizException.class, () -> service().changePassword(1L, "wrong", "new-password"));
        assertEquals(40001, ex.getCode());
    }

    @Test
    void changePassword_rejects_samePassword() {
        AppUser u = sampleUser();
        when(userMapper.selectById(1L)).thenReturn(u);
        when(passwordEncoder.matches("old", "old-hash")).thenReturn(true);

        BizException ex = assertThrows(BizException.class, () -> service().changePassword(1L, "old", "old"));
        assertEquals(40002, ex.getCode());
    }

    @Test
    void changePassword_rejects_missingUser() {
        when(userMapper.selectById(99L)).thenReturn(null);

        BizException ex = assertThrows(BizException.class, () -> service().changePassword(99L, "old", "new-password"));
        assertEquals(40100, ex.getCode());
    }

    // ---- refresh：与 login 同一道租户闸（管理端设计 §7 第 6 步的收尾） ----

    private Claims refreshClaims() {
        Claims claims = mock(Claims.class);
        when(claims.getSubject()).thenReturn("1");
        when(claims.get("typ", String.class)).thenReturn("refresh");
        return claims;
    }

    private Tenant sampleTenant(Integer status) {
        Tenant t = new Tenant();
        t.setId(10L);
        t.setInviteCode("DEMO0001");
        t.setName("demo");
        t.setStatus(status);
        return t;
    }

    private void stubRefreshUser() {
        AppUser u = sampleUser();
        u.setRole("tenant_admin");
        // 先构造 claims 再 stub：`refreshClaims()` 本身在打桩，塞进 `when(jwtService.parse("rt"))`
        // 的参数位会形成嵌套 stubbing，Mockito 直接报 "Unfinished stubbing detected"。
        Claims claims = refreshClaims();
        when(jwtService.parse("rt")).thenReturn(claims);
        when(userMapper.selectById(1L)).thenReturn(u);
    }

    @Test
    void refresh_reissues_whenTenantActive() {
        stubRefreshUser();
        when(tenantMapper.selectById(10L)).thenReturn(sampleTenant(1));
        when(jwtService.issueAccessToken(1L, 10L, "DEMO0001", "tenant_admin")).thenReturn("at2");
        when(jwtService.issueRefreshToken(1L, 10L, "DEMO0001", "tenant_admin")).thenReturn("rt2");
        when(jwtService.getAccessTtlSeconds()).thenReturn(604800L);

        LoginResponse res = service().refresh("rt");

        assertEquals("at2", res.accessToken());
        assertEquals("rt2", res.refreshToken());
        assertNotNull(res.user());
    }

    @Test
    void refresh_rejects_disabledTenant() {
        stubRefreshUser();
        when(tenantMapper.selectById(10L)).thenReturn(sampleTenant(0));

        BizException ex = assertThrows(BizException.class, () -> service().refresh("rt"));
        assertEquals(40100, ex.getCode());
    }

    /** 租户行缺失时必须是"挡住"而不是 NPE——NPE 会变成 500，把鉴权漏洞伪装成服务端故障。 */
    @Test
    void refresh_rejects_missingTenant_insteadOfNpe() {
        stubRefreshUser();
        when(tenantMapper.selectById(10L)).thenReturn(null);

        BizException ex = assertThrows(BizException.class, () -> service().refresh("rt"));
        assertEquals(40100, ex.getCode());
    }

    /** `status` 为 NULL 同样按未启用处理：`!= 1` 在 NULL 上会直接抛 NPE。 */
    @Test
    void refresh_rejects_nullTenantStatus() {
        stubRefreshUser();
        when(tenantMapper.selectById(10L)).thenReturn(sampleTenant(null));

        BizException ex = assertThrows(BizException.class, () -> service().refresh("rt"));
        assertEquals(40100, ex.getCode());
    }
}
