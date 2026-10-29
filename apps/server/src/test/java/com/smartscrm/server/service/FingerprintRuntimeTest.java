package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.FingerprintProfile;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.FingerprintProfileMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.web.vo.FingerprintRuntimeVO;
import com.smartscrm.server.web.vo.FingerprintRuntimeVO.BrandVO;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * B14 指纹注入 · 账号侧运行时参数的解析（spec R2 / R7）。
 *
 * <p>守的是三条：**未绑定不施加**（null 不是错误，是"该账号什么都不改"）、**越权不给**
 * （读到别租户的档案等于把人家的运行环境交出去）、**缺项不改**（一个字段坏掉只让它自己
 * 为 null，其余照常下发——绝不能因为 brands 的 JSON 写坏了就让整个账号的指纹全丢）。
 */
class FingerprintRuntimeTest {

    private static final Long TENANT = 1L, OTHER = 2L;
    private static final Long ACCOUNT = 7L;
    private static final Long PROFILE = 11L;

    private PlatformAccountMapper accountMapper;
    private FingerprintProfileMapper profileMapper;
    private FingerprintProfileService fingerprintService;
    private PlatformAccountService accountService;

    @BeforeEach
    void setUp() {
        // 纯单测没有 Spring 上下文，MP 的 lambda 列缓存不会自动初始化；绑定走 LambdaUpdateWrapper，
        // 不登记实体就会在 .set() 处炸（同 FingerprintProfileServiceTest 的处理）。
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), PlatformAccount.class);
        accountMapper = mock(PlatformAccountMapper.class);
        profileMapper = mock(FingerprintProfileMapper.class);
        fingerprintService = new FingerprintProfileService(profileMapper, accountMapper);
        accountService = new PlatformAccountService(accountMapper, fingerprintService);
    }

    private static PlatformAccount account(Long tenantId, Long profileId) {
        PlatformAccount a = new PlatformAccount();
        a.setId(ACCOUNT);
        a.setTenantId(tenantId);
        a.setViewId("view-" + ACCOUNT);
        a.setFingerprintProfileId(profileId);
        return a;
    }

    private static FingerprintProfile profile(Long tenantId) {
        FingerprintProfile p = new FingerprintProfile();
        p.setId(PROFILE);
        p.setTenantId(tenantId);
        p.setName("fp-" + PROFILE);
        p.setOs("windows");
        p.setBrowser("chrome");
        p.setStatus("active");
        p.setSeed(424242L);
        p.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36");
        p.setUaPlatform("Windows");
        p.setUaPlatformVersion("15.0.0");
        p.setBrandsJson("[{\"brand\":\"Chromium\",\"version\":\"140\"}]");
        p.setLocale("en-US");
        p.setTimezone("America/New_York");
        p.setHardwareConcurrency(8);
        p.setDeviceMemory(16);
        p.setWebglVendor("Google Inc. (NVIDIA)");
        p.setWebglRenderer("ANGLE (NVIDIA GeForce GTX 1060 Direct3D11)");
        p.setCanvasNoise("123456789");
        p.setAudioNoise("987654321");
        return p;
    }

    /**
     * 噪声种子不是"把字符串当数字读"，而是对字符串做 FNV-1a 32 哈希：生成器写的是 32 位 hex 串，
     * 十进制解析必然失败；而 "12345678" 到底是十进制还是十六进制本身就是道无解的判断题。
     * 这两个常量把哈希算法钉死——哪天实现换了算法（比如退回 String.hashCode），这里必须红。
     */
    private static final long HASH_123456789 = 3146166556L;
    private static final long HASH_987654321 = 2236327244L;

    @Test
    void runtime_unboundAccount_isNull() {
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, null));

        assertNull(fingerprintService.runtimeOf(TENANT, ACCOUNT),
            "未绑档案的账号不施加任何指纹（R2）；返回 null 而不是一份空配置");
    }

    @Test
    void runtime_profileOfOtherTenant_isNull() {
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, PROFILE));
        when(profileMapper.selectById(PROFILE)).thenReturn(profile(OTHER));

        assertNull(fingerprintService.runtimeOf(TENANT, ACCOUNT),
            "档案属于别的租户时读作未绑定：把别人的运行环境配置下发出去就是泄露");
    }

    @Test
    void runtime_missingProfile_isNull() {
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, PROFILE));
        when(profileMapper.selectById(PROFILE)).thenReturn(null);

        assertNull(fingerprintService.runtimeOf(TENANT, ACCOUNT),
            "绑着一个已被删掉的档案时降级为不施加，而不是报错");
    }

    @Test
    void runtime_boundAccount_mapsEveryField() {
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, PROFILE));
        when(profileMapper.selectById(PROFILE)).thenReturn(profile(TENANT));

        FingerprintRuntimeVO vo = fingerprintService.runtimeOf(TENANT, ACCOUNT);

        assertNotNull(vo);
        assertEquals(PROFILE, vo.profileId());
        assertEquals(Long.valueOf(424242L), vo.seed());
        assertEquals(profile(TENANT).getUserAgent(), vo.userAgent());
        assertEquals("Windows", vo.uaPlatform());
        assertEquals("15.0.0", vo.uaPlatformVersion());
        assertEquals(List.of(new BrandVO("Chromium", "140")), vo.brands());
        assertEquals("en-US", vo.locale());
        assertEquals("America/New_York", vo.timezone());
        assertEquals(Integer.valueOf(8), vo.hardwareConcurrency());
        assertEquals(Integer.valueOf(16), vo.deviceMemory());
        assertEquals("Google Inc. (NVIDIA)", vo.webglVendor());
        assertEquals("ANGLE (NVIDIA GeForce GTX 1060 Direct3D11)", vo.webglRenderer());
        assertEquals(Long.valueOf(HASH_123456789), vo.canvasNoiseSeed());
        assertEquals(Long.valueOf(HASH_987654321), vo.audioNoiseSeed());
    }

    @Test
    void runtime_illegalBrandsJson_onlyBrandsIsNull() {
        FingerprintProfile p = profile(TENANT);
        p.setBrandsJson("{not json at all");
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, PROFILE));
        when(profileMapper.selectById(PROFILE)).thenReturn(p);

        FingerprintRuntimeVO vo = fingerprintService.runtimeOf(TENANT, ACCOUNT);

        assertNotNull(vo, "一个字段解析失败不能让整个指纹全丢（R7）");
        assertNull(vo.brands(), "brands 坏了就只有 brands 为 null —— 该项不改，不猜");
        // 其余字段照常下发：这是"缺项不改"的反面——不能因为一处坏了让整个账号的指纹全丢
        assertEquals(PROFILE, vo.profileId());
        assertEquals(profile(TENANT).getUserAgent(), vo.userAgent());
        assertEquals("America/New_York", vo.timezone());
        assertEquals(Integer.valueOf(8), vo.hardwareConcurrency());
        assertEquals(Long.valueOf(HASH_123456789), vo.canvasNoiseSeed());
        assertEquals(Long.valueOf(HASH_987654321), vo.audioNoiseSeed());
    }

    @Test
    void runtime_blankCanvasSeed_onlyThatSeedIsNull() {
        FingerprintProfile p = profile(TENANT);
        p.setCanvasNoise("   "); // 空白 = 没写（R7 缺项），不是"一个待解析的字符串"
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, PROFILE));
        when(profileMapper.selectById(PROFILE)).thenReturn(p);

        FingerprintRuntimeVO vo = fingerprintService.runtimeOf(TENANT, ACCOUNT);

        assertNotNull(vo);
        assertNull(vo.canvasNoiseSeed(), "没写噪声种子 = 不加 canvas 噪声，不猜一个");
        assertEquals(Long.valueOf(HASH_987654321), vo.audioNoiseSeed(), "另一个种子不受牵连");
        assertEquals(List.of(new BrandVO("Chromium", "140")), vo.brands());
        assertEquals("America/New_York", vo.timezone());
    }

    /** 噪声种子走的是字符串哈希：hex 串、十进制串、任何形态都成立，且同串恒同值。 */
    @Test
    void runtime_seedIsStableHashOfTheString() {
        FingerprintProfile a = profile(TENANT);
        a.setCanvasNoise("123456789");
        a.setAudioNoise("123456789");
        FingerprintProfile b = profile(TENANT);
        b.setCanvasNoise("123456789");
        b.setAudioNoise("987654321");
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, PROFILE));
        when(profileMapper.selectById(PROFILE)).thenReturn(a);
        FingerprintRuntimeVO first = fingerprintService.runtimeOf(TENANT, ACCOUNT);
        when(profileMapper.selectById(PROFILE)).thenReturn(b);
        FingerprintRuntimeVO second = fingerprintService.runtimeOf(TENANT, ACCOUNT);

        // 同串 → 同值（指纹要"稳定"：两次读同一个档案不能得到两个种子）
        assertEquals(first.canvasNoiseSeed(), first.audioNoiseSeed());
        assertEquals(first.canvasNoiseSeed(), second.canvasNoiseSeed());
        // 异串 → 异值
        assertNotEquals(second.canvasNoiseSeed(), second.audioNoiseSeed());
        // 固定常量：算法被换掉时会红（String.hashCode 的实现细节不是契约，不能拿来当种子）
        assertEquals(Long.valueOf(HASH_123456789), first.canvasNoiseSeed());
        assertEquals(Long.valueOf(HASH_987654321), second.audioNoiseSeed());
    }

    /**
     * 生成器写的是 32 位 hex 串（{@code hexToken(r, 32)}），十进制解析必然抛 NumberFormatException
     * → 两个噪声种子恒为 null → "生成出来的档案不带噪声种子"，页内 Canvas/Audio 噪声无从施加。
     * 哈希对 hex 与十进制都成立，这条锁住这个回归。
     */
    @Test
    void runtime_hexNoiseSeedFromGenerator_isNotNull() {
        FingerprintProfile p = profile(TENANT);
        fingerprintService.applyFingerprint(p, 20251029L); // 与生成器同一条路径：写入 32 位 hex
        assertTrue(p.getCanvasNoise().matches("[0-9a-f]{32}"), "生成器写的应是 32 位 hex，否则这条就测不到点上");
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, PROFILE));
        when(profileMapper.selectById(PROFILE)).thenReturn(p);

        FingerprintRuntimeVO vo = fingerprintService.runtimeOf(TENANT, ACCOUNT);

        assertNotNull(vo.canvasNoiseSeed(), "hex 串必须能解析出种子：解析不出就等于生成的档案没有噪声");
        assertNotNull(vo.audioNoiseSeed());
        assertTrue(vo.canvasNoiseSeed() > 0, "无符号 32 位 → 正数");
        assertTrue(vo.audioNoiseSeed() > 0);
        assertTrue(vo.canvasNoiseSeed() <= 0xffffffffL, "32 位");
    }

    @Test
    void runtime_nullNoiseSeed_isNull() {
        FingerprintProfile p = profile(TENANT);
        p.setCanvasNoise(null);
        p.setAudioNoise(null);
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, PROFILE));
        when(profileMapper.selectById(PROFILE)).thenReturn(p);

        FingerprintRuntimeVO vo = fingerprintService.runtimeOf(TENANT, ACCOUNT);

        assertNull(vo.canvasNoiseSeed(), "null = 缺项 → 该项不改（R7）");
        assertNull(vo.audioNoiseSeed());
    }

    @Test
    void runtime_afterUnbind_isNull() {
        when(accountMapper.selectById(ACCOUNT)).thenReturn(account(TENANT, PROFILE));
        when(profileMapper.selectById(PROFILE)).thenReturn(profile(TENANT));
        assertNotNull(fingerprintService.runtimeOf(TENANT, ACCOUNT), "解绑前应有指纹");

        accountService.bindFingerprint(TENANT, ACCOUNT, null);

        assertNull(fingerprintService.runtimeOf(TENANT, ACCOUNT),
            "解绑后回到不施加任何指纹的状态（R2）");
    }

    @Test
    void bind_profileOfOtherTenant_isRejected() {
        PlatformAccount owned = account(TENANT, null);
        when(accountMapper.selectById(ACCOUNT)).thenReturn(owned);
        when(profileMapper.selectById(PROFILE)).thenReturn(profile(OTHER));

        BizException error = assertThrows(BizException.class,
            () -> accountService.bindFingerprint(TENANT, ACCOUNT, PROFILE));

        assertEquals(40404, error.getCode(), "绑别租户的档案 = 越权，必须挡住而不是静默接受");
        assertNull(owned.getFingerprintProfileId(), "被拒绝的绑定一个字都不能落到账号上");
    }
}
