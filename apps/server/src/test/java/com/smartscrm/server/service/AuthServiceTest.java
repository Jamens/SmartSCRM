package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AppUser;
import com.smartscrm.server.mapper.AppUserMapper;
import com.smartscrm.server.mapper.DeviceMapper;
import com.smartscrm.server.mapper.TenantMapper;
import com.smartscrm.server.security.JwtService;
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
}
