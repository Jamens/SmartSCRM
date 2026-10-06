package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.FingerprintProfile;
import com.smartscrm.server.mapper.FingerprintProfileMapper;
import java.util.List;
import java.util.Set;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** B14 单测：归属校验（跨租户 404）/ 缺名 400 / os·browser·status 归一 / 列表隔离 / 生成确定性。 */
class FingerprintProfileServiceTest {

    private static final Long TENANT = 1L, OTHER = 2L;
    private static final Set<String> TIMEZONES = Set.of(
        "Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore", "America/New_York",
        "Europe/London", "Europe/Berlin", "Asia/Hong_Kong", "Australia/Sydney");
    private static final Set<String> WEBGL_VENDORS = Set.of(
        "Google Inc. (NVIDIA)", "Google Inc. (Intel)", "Apple", "Mesa", "Microsoft");

    private FingerprintProfileMapper mapper;
    private FingerprintProfileService svc;

    @BeforeEach
    void setUp() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), FingerprintProfile.class);
        mapper = mock(FingerprintProfileMapper.class);
        svc = new FingerprintProfileService(mapper);
    }

    private static FingerprintProfile profile(Long id, Long tenantId) {
        FingerprintProfile d = new FingerprintProfile();
        d.setId(id);
        d.setTenantId(tenantId);
        d.setName("fp-" + id);
        d.setOs("windows");
        d.setBrowser("chrome");
        d.setStatus("inactive");
        return d;
    }

    private static boolean isHex(String s, int len) {
        if (s == null || s.length() != len) return false;
        return s.chars().allMatch(c -> "0123456789abcdef".indexOf(c) >= 0);
    }

    @Test
    void createRejectsBlankName() {
        assertThrows(BizException.class,
            () -> svc.create(TENANT, "  ", "windows", "chrome", "inactive", null));
    }

    @Test
    void createNormalizesOsAndBrowser() {
        FingerprintProfile created = svc.create(TENANT, "FP", "LINUX", "Firefox", "Active", "r");
        verify(mapper).insert(any(FingerprintProfile.class));
        assertEquals("linux", created.getOs());     // 大写→小写，仍识别
        assertEquals("firefox", created.getBrowser());
        assertEquals("active", created.getStatus());
        assertEquals(TENANT, created.getTenantId());
        // 未知值归一默认
        FingerprintProfile d2 = svc.create(TENANT, "FP2", "bogus", "weird", "weird", null);
        assertEquals("windows", d2.getOs());
        assertEquals("chrome", d2.getBrowser());
        assertEquals("inactive", d2.getStatus());
    }

    @Test
    void listIsTenantScoped() {
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(profile(10L, TENANT)));
        List<FingerprintProfile> out = svc.list(TENANT);
        assertEquals(1, out.size());
        verify(mapper).selectList(any(LambdaQueryWrapper.class));
    }

    @Test
    void getEnforcesTenantIsolation() {
        when(mapper.selectById(10L)).thenReturn(profile(10L, TENANT));
        assertEquals(10L, svc.get(TENANT, 10L).getId());
        when(mapper.selectById(11L)).thenReturn(profile(11L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.get(TENANT, 11L));
        assertEquals(40404, ex.getCode());
        when(mapper.selectById(99L)).thenReturn(null);
        assertThrows(BizException.class, () -> svc.get(TENANT, 99L));
    }

    @Test
    void updateAppliesPartialAndNormalizes() {
        FingerprintProfile existing = profile(10L, TENANT);
        when(mapper.selectById(10L)).thenReturn(existing);
        FingerprintProfile up = svc.update(TENANT, 10L, null, "macos", "SAFARI", "Active", null);
        assertEquals("macos", up.getOs());
        assertEquals("safari", up.getBrowser());
        assertEquals("active", up.getStatus());
        verify(mapper).updateById(any(FingerprintProfile.class));
        // 空名拒绝
        assertThrows(BizException.class,
            () -> svc.update(TENANT, 10L, "  ", null, null, null, null));
    }

    @Test
    void deleteEnforcesTenantIsolation() {
        when(mapper.selectById(10L)).thenReturn(profile(10L, TENANT));
        svc.delete(TENANT, 10L);
        verify(mapper).deleteById(10L);
        when(mapper.selectById(11L)).thenReturn(profile(11L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.delete(TENANT, 11L));
        assertEquals(40404, ex.getCode());
    }

    @Test
    void generateProducesValidFingerprint() {
        FingerprintProfile existing = profile(10L, TENANT);
        when(mapper.selectById(10L)).thenReturn(existing);
        FingerprintProfile gen = svc.generate(TENANT, 10L);
        assertEquals("active", gen.getStatus());
        assertNotNull(gen.getGeneratedAt());
        assertNotNull(gen.getUserAgent());
        assertTrue(gen.getUserAgent().contains("Mozilla"), "UA 应带 Mozilla 前缀");
        assertTrue(TIMEZONES.contains(gen.getTimezone()), "时区应在固定池内");
        assertTrue(WEBGL_VENDORS.contains(gen.getWebglVendor()), "WebGL 厂商应在固定池内");
        assertNotNull(gen.getWebglRenderer());
        assertNotNull(gen.getLocale());
        assertTrue(isHex(gen.getCanvasNoise(), 32), "Canvas 噪声应为 32 位 hex");
        assertTrue(isHex(gen.getAudioNoise(), 32), "Audio 噪声应为 32 位 hex");
        assertTrue(gen.getHardwareConcurrency() >= 2 && gen.getHardwareConcurrency() <= 16, "核数应在 2..16");
        assertTrue(Set.of(2, 4, 8, 16).contains(gen.getDeviceMemory()), "内存应在 {2,4,8,16}");
        verify(mapper).updateById(any(FingerprintProfile.class));
        // 跨租户 → 404（生成也受归属约束）
        when(mapper.selectById(11L)).thenReturn(profile(11L, OTHER));
        assertThrows(BizException.class, () -> svc.generate(TENANT, 11L));
    }

    @Test
    void applyFingerprintIsDeterministicBySeed() {
        FingerprintProfile a = profile(10L, TENANT);
        FingerprintProfile b = profile(10L, TENANT);
        svc.applyFingerprint(a, 123456789L);
        svc.applyFingerprint(b, 123456789L);
        // 同 seed → 所有指纹字段一致
        assertEquals(a.getUserAgent(), b.getUserAgent());
        assertEquals(a.getScreenResolution(), b.getScreenResolution());
        assertEquals(a.getTimezone(), b.getTimezone());
        assertEquals(a.getLocale(), b.getLocale());
        assertEquals(a.getWebglVendor(), b.getWebglVendor());
        assertEquals(a.getWebglRenderer(), b.getWebglRenderer());
        assertEquals(a.getCanvasNoise(), b.getCanvasNoise());
        assertEquals(a.getAudioNoise(), b.getAudioNoise());
        assertEquals(a.getHardwareConcurrency(), b.getHardwareConcurrency());
        assertEquals(a.getDeviceMemory(), b.getDeviceMemory());
        // 不同 seed → Canvas 噪声不同（高概率）
        FingerprintProfile c = profile(10L, TENANT);
        svc.applyFingerprint(c, 987654321L);
        assertTrue(!a.getCanvasNoise().equals(c.getCanvasNoise()), "不同 seed 应产出不同噪声");
    }
}
