package com.smartscrm.server.service;

import com.smartscrm.server.service.msg.MsgTimes;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.FingerprintProfile;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.FingerprintProfileMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.web.vo.FingerprintRuntimeVO;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B14 浏览器指纹配置 · 数据层（租户隔离，spec §3）。
 *
 * <p>v1 不含自动轮换/调度（spec §2 裁定），{@code status} 由表单显式设置，不自动流转。
 * {@link #generate(Long, Long)} 是本次交付里唯一带"生成指纹"语义的动作，但遵循开源红线——
 * 不探测任何真实设备、不发起任何真实外连，由 seed 派生确定性演示数据（UA/分辨率/时区/WebGL/噪声）。
 * 同一 seed 必得同一指纹（可复现）；regenerate 用新 seed 刷新（rotate）。所有写操作校验归属。
 */
@Service
public class FingerprintProfileService {

    private static final Set<String> OSES = Set.of("windows", "macos", "linux", "android", "ios");
    private static final Set<String> BROWSERS = Set.of("chrome", "firefox", "safari", "edge");
    private static final Set<String> STATUSES = Set.of("active", "inactive");

    // 生成用的固定池：由 LCG 落入，确定性可复现。
    private static final List<String> TIMEZONES = List.of(
        "Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore", "America/New_York",
        "Europe/London", "Europe/Berlin", "Asia/Hong_Kong", "Australia/Sydney");
    private static final List<String> LOCALES = List.of(
        "zh-CN", "en-US", "ja-JP", "ko-KR", "en-GB", "de-DE", "fr-FR", "es-ES");
    private static final List<String> RESOLUTIONS = List.of(
        "1920x1080", "1366x768", "1536x864", "2560x1440", "1440x900", "1280x720", "3840x2160");
    private static final List<String> WEBGL_VENDORS = List.of(
        "Google Inc. (NVIDIA)", "Google Inc. (Intel)", "Apple", "Mesa", "Microsoft");
    private static final List<String> WEBGL_RENDERERS = List.of(
        "ANGLE (NVIDIA GeForce GTX 1060 Direct3D11)",
        "ANGLE (Intel HD Graphics Direct3D11)",
        "Apple M1", "Mesa Intel(R) UHD Graphics", "AMD Radeon RX 580");
    private static final int[] DEVICE_MEMS = {2, 4, 8, 16};

    /** 解析 brands_json 用。形制同 service/batch 与 service/provider：自备一份，不注册 Spring 的 mapper bean。 */
    private static final ObjectMapper JSON = new ObjectMapper();

    private final FingerprintProfileMapper mapper;
    private final PlatformAccountMapper accountMapper;

    public FingerprintProfileService(FingerprintProfileMapper mapper, PlatformAccountMapper accountMapper) {
        this.mapper = mapper;
        this.accountMapper = accountMapper;
    }

    /**
     * 账号的运行时指纹参数（spec R2/R7）：未绑档案返回 {@code null}——未绑定是合法状态，
     * 不施加任何指纹，也不兜底生成一份。档案不存在或不属于本租户同样返回 {@code null}：
     * 读到别的租户的档案等于把人家的运行环境配置交出去，宁可什么都不给。
     *
     * <p>解析一律「缺项不改」：brands 的 JSON 坏了就只有 brands 为 null，噪声种子没写（null/空白）
     * 就只有那一个种子为 null，其余字段照常下发。一个字段坏掉不能带走整个指纹。
     */
    public FingerprintRuntimeVO runtimeOf(Long tenantId, Long accountId) {
        PlatformAccount account = accountMapper.selectById(accountId);
        if (account == null || !tenantId.equals(account.getTenantId())) {
            throw new BizException(40404, "账号不存在");
        }
        Long profileId = account.getFingerprintProfileId();
        if (profileId == null) {
            return null;
        }
        FingerprintProfile d = mapper.selectById(profileId);
        if (d == null || !tenantId.equals(d.getTenantId())) {
            return null;
        }
        return new FingerprintRuntimeVO(
            d.getId(),
            d.getSeed(),
            d.getUserAgent(),
            d.getUaPlatform(),
            d.getUaPlatformVersion(),
            parseBrands(d.getBrandsJson()),
            d.getLocale(),
            d.getTimezone(),
            d.getHardwareConcurrency(),
            d.getDeviceMemory(),
            d.getWebglVendor(),
            d.getWebglRenderer(),
            parseSeed(d.getCanvasNoise()),
            parseSeed(d.getAudioNoise()));
    }

    /** brands_json → BrandVO 列表。null/空/非法 JSON/不是数组 → null（该项不改），不抛。 */
    private static List<FingerprintRuntimeVO.BrandVO> parseBrands(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            JsonNode arr = JSON.readTree(json);
            if (!arr.isArray()) {
                return null;
            }
            List<FingerprintRuntimeVO.BrandVO> out = new ArrayList<>();
            for (JsonNode node : arr) {
                out.add(new FingerprintRuntimeVO.BrandVO(
                    node.path("brand").asText(null), node.path("version").asText(null)));
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 噪声种子：任意非空字符串 → 稳定的 32 位无符号数（FNV-1a 32）。
     * 不按十进制/十六进制解析——生成器写的是 32 位 hex 串，且 "12345678" 这类形态有二义性；
     * 哈希对旧数据（hex）与新数据都成立，且同串恒同值（指纹要"稳定"）。null/空白 = 缺项 -> null（R7）。
     */
    private static Long parseSeed(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        // 手写 FNV-1a 而不是 String.hashCode()：后者只是"当前实现碰巧如此"，不是跨版本的契约。
        long hash = 0x811c9dc5L;
        for (byte b : raw.getBytes(StandardCharsets.UTF_8)) {
            hash = (hash ^ (b & 0xff)) & 0xffffffffL;
            hash = (hash * 0x01000193L) & 0xffffffffL;
        }
        return hash;
    }

    /** 新建指纹档案。name 必填；os/browser 落库归一（未知→windows/chrome）；status 默认 inactive。 */
    @Transactional
    public FingerprintProfile create(Long tenantId, String name, String os, String browser,
                                     String status, String remark) {
        if (name == null || name.isBlank()) {
            throw new BizException(40000, "指纹名称不能为空");
        }
        FingerprintProfile d = new FingerprintProfile();
        d.setTenantId(tenantId);
        d.setName(name.trim());
        d.setOs(normalizeOs(os));
        d.setBrowser(normalizeBrowser(browser));
        d.setStatus(normalizeStatus(status));
        d.setRemark(remark == null || remark.isBlank() ? null : remark.trim());
        mapper.insert(d);
        return d;
    }

    public List<FingerprintProfile> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<FingerprintProfile>()
            .eq(FingerprintProfile::getTenantId, tenantId).orderByDesc(FingerprintProfile::getId));
    }

    public FingerprintProfile get(Long tenantId, Long id) {
        FingerprintProfile d = mapper.selectById(id);
        if (d == null || !tenantId.equals(d.getTenantId())) {
            throw new BizException(40404, "指纹档案不存在: " + id);
        }
        return d;
    }

    /** 改：仅更新非 null 字段（name/os/browser/status/remark），指纹字段由 generate 生成，不走表单。 */
    @Transactional
    public FingerprintProfile update(Long tenantId, Long id, String name, String os,
                                     String browser, String status, String remark) {
        FingerprintProfile d = get(tenantId, id);
        if (name != null) {
            if (name.isBlank()) throw new BizException(40000, "指纹名称不能为空");
            d.setName(name.trim());
        }
        if (os != null) d.setOs(normalizeOs(os));
        if (browser != null) d.setBrowser(normalizeBrowser(browser));
        if (status != null) d.setStatus(normalizeStatus(status));
        if (remark != null) d.setRemark(remark.isBlank() ? null : remark.trim());
        mapper.updateById(d);
        return d;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        get(tenantId, id); // 归属校验，非本租户抛 404
        mapper.deleteById(id);
    }

    /**
     * 模拟生成指纹：由新 seed 派生 UA/分辨率/时区/语言/WebGL/噪声等演示数据，绝不真实探测设备。
     * regenerate 刷新 seed → 得到新指纹；同一 seed 必得同一指纹（{@link #applyFingerprint} 可复现）。
     */
    @Transactional
    public FingerprintProfile generate(Long tenantId, Long id) {
        FingerprintProfile d = get(tenantId, id);
        long seed = Math.floorMod(
            (d.getName() + "|" + d.getId() + "|" + d.getOs() + "|" + d.getBrowser()).hashCode() * 2654435761L
                + System.nanoTime(), 1L << 48);
        applyFingerprint(d, seed);
        d.setStatus("active");
        d.setGeneratedAt(LocalDateTime.now(MsgTimes.CHAT_ZONE));
        mapper.updateById(d);
        return d;
    }

    /** 由 seed 确定性填充指纹字段（同 seed → 同结果）。包内可见，便于单测断言可复现性。 */
    void applyFingerprint(FingerprintProfile d, long seed) {
        Lcg r = new Lcg(seed);
        String os = d.getOs();
        String browser = d.getBrowser();
        int v = 110 + r.next(40); // 大版本号 110..149
        d.setUserAgent(buildUa(os, browser, v));
        d.setScreenResolution(RESOLUTIONS.get(r.next(RESOLUTIONS.size())));
        d.setTimezone(TIMEZONES.get(r.next(TIMEZONES.size())));
        d.setLocale(LOCALES.get(r.next(LOCALES.size())));
        d.setWebglVendor(WEBGL_VENDORS.get(r.next(WEBGL_VENDORS.size())));
        d.setWebglRenderer(WEBGL_RENDERERS.get(r.next(WEBGL_RENDERERS.size())));
        d.setCanvasNoise(hexToken(r, 32));
        d.setAudioNoise(hexToken(r, 32));
        d.setHardwareConcurrency(2 + r.next(15));          // 2..16
        d.setDeviceMemory(DEVICE_MEMS[r.next(DEVICE_MEMS.length)]);
        d.setSeed(seed);
    }

    private static String buildUa(String os, String browser, int v) {
        String plat = switch (os) {
            case "windows" -> "Windows NT 10.0; Win64; x64";
            case "macos" -> "Macintosh; Intel Mac OS X 10_15_7";
            case "linux" -> "X11; Linux x86_64";
            case "android" -> "Linux; Android 13; Pixel 7";
            case "ios" -> "iPhone; CPU iPhone OS 16_5 like Mac OS X";
            default -> "Windows NT 10.0; Win64; x64";
        };
        return switch (browser) {
            case "firefox" -> "Mozilla/5.0 (" + plat + "; rv:" + v + ".0) Gecko/20100101 Firefox/" + v + ".0";
            case "safari" -> "Mozilla/5.0 (" + plat + ") AppleWebKit/605.1.15 (KHTML, like Gecko) Version/"
                + (v - 80) + ".0 Safari/605.1.15";
            case "edge" -> "Mozilla/5.0 (" + plat + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
                + v + ".0.0.0 Safari/537.36 Edg/" + v + ".0.0.0";
            default -> "Mozilla/5.0 (" + plat + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
                + v + ".0.0.0 Safari/537.36";
        };
    }

    /** 确定性 LCG（glibc 风格），next(bound) 返回 [0, bound)。seed 经无符号处理避免负模。 */
    private static final class Lcg {
        private long s;
        Lcg(long seed) { this.s = seed & 0x7fffffffffffffffL; }
        int next(int bound) {
            s = (s * 1103515245L + 12345L) & 0x7fffffffffffffffL;
            return (int) ((s >>> 17) % bound);
        }
    }

    private static String hexToken(Lcg r, int len) {
        StringBuilder sb = new StringBuilder();
        String hex = "0123456789abcdef";
        for (int i = 0; i < len; i++) sb.append(hex.charAt(r.next(16)));
        return sb.toString();
    }

    private static String normalizeOs(String os) {
        if (os == null) return "windows";
        String o = os.trim().toLowerCase();
        return OSES.contains(o) ? o : "windows";
    }

    private static String normalizeBrowser(String browser) {
        if (browser == null) return "chrome";
        String b = browser.trim().toLowerCase();
        return BROWSERS.contains(b) ? b : "chrome";
    }

    private static String normalizeStatus(String status) {
        if (status == null) return "inactive";
        String s = status.trim().toLowerCase();
        return STATUSES.contains(s) ? s : "inactive";
    }
}
