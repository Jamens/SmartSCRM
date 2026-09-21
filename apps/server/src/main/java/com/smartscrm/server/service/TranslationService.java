package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.TranslationCache;
import com.smartscrm.server.entity.TranslationCredential;
import com.smartscrm.server.entity.TranslationNode;
import com.smartscrm.server.entity.TranslationSetting;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.TranslationCacheMapper;
import com.smartscrm.server.mapper.TranslationCredentialMapper;
import com.smartscrm.server.mapper.TranslationNodeMapper;
import com.smartscrm.server.mapper.TranslationSettingMapper;
import com.smartscrm.server.service.msg.ScopeSettings;
import com.smartscrm.server.service.provider.Credentials;
import com.smartscrm.server.service.provider.ProviderException;
import com.smartscrm.server.service.provider.ProviderResult;
import com.smartscrm.server.service.provider.TranslationProvider;
import com.smartscrm.server.web.dto.CredentialTestDTO;
import com.smartscrm.server.web.dto.TranslateDTO;
import com.smartscrm.server.web.dto.TranslationCredentialInput;
import com.smartscrm.server.web.dto.TranslationSettingInput;
import com.smartscrm.server.web.vo.CredentialTestVO;
import com.smartscrm.server.web.vo.ServerDelayVO;
import com.smartscrm.server.web.vo.TranslateVO;
import com.smartscrm.server.web.vo.TranslationCacheEntryVO;
import com.smartscrm.server.web.vo.TranslationCacheStatsVO;
import com.smartscrm.server.web.vo.TranslationCredentialVO;
import com.smartscrm.server.web.vo.TranslationNodeVO;
import com.smartscrm.server.web.vo.TranslationSettingVO;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import net.openhft.hashing.LongHashFunction;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TranslationService {

    private static final Pattern CHINESE = Pattern.compile("[\\u4e00-\\u9fa5]");
    private static final Set<String> CHANNELS = Set.of("1", "2", "3", "4", "5", "6", "7");

    /** Channels backed by a real vendor; every other channel stays on the simulated engine. */
    private static final Map<String, String> CHANNEL_TO_PROVIDER = Map.of(
        "5", "baidu",
        "7", "tencent");

    private final TranslationSettingMapper settingMapper;
    private final TranslationNodeMapper nodeMapper;
    private final TranslationCacheMapper cacheMapper;
    private final TranslationCredentialMapper credentialMapper;
    private final CustomerMapper customerMapper;
    private final SimulatedTranslationEngine engine;
    private final Map<String, TranslationProvider> providers;

    public TranslationService(TranslationSettingMapper settingMapper, TranslationNodeMapper nodeMapper,
                              TranslationCacheMapper cacheMapper, TranslationCredentialMapper credentialMapper,
                              CustomerMapper customerMapper,
                              SimulatedTranslationEngine engine, List<TranslationProvider> providerBeans) {
        this.settingMapper = settingMapper;
        this.nodeMapper = nodeMapper;
        this.cacheMapper = cacheMapper;
        this.credentialMapper = credentialMapper;
        this.customerMapper = customerMapper;
        this.engine = engine;
        this.providers = providerBeans.stream()
            .collect(Collectors.toMap(TranslationProvider::providerId, Function.identity()));
    }

    // ============ settings ============

    public TranslationSettingVO getSettings(Long tenantId) {
        return getSettings(tenantId, null);
    }

    /** 带 customerId 就按 客户覆盖行 -> 全局 解析；不带与 P5 完全一致（inherited=true）。 */
    public TranslationSettingVO getSettings(Long tenantId, Long customerId) {
        TranslationSetting customer = customerId == null ? null : customerRow(tenantId, customerId);
        ScopeSettings.Resolved resolved = ScopeSettings.resolve(customerId, customer, requireSettings(tenantId));
        return toVO(resolved.setting(), resolved.inherited());
    }

    public TranslationSettingVO updateSettings(Long tenantId, TranslationSettingInput input) {
        return saveInto(requireSettings(tenantId), tenantId, input);
    }

    /** 保存：scope=customer 时从全局整份复制后覆盖，保证"整行取用"成立。 */
    @Transactional
    public TranslationSettingVO updateScopedSettings(Long tenantId, String scope, Long scopeKey,
                                                     TranslationSettingInput input) {
        if (!"global".equals(scope) && !"customer".equals(scope)) {
            throw new BizException(40000, "scope 只能是 global 或 customer");
        }
        if ("global".equals(scope)) {
            return updateSettings(tenantId, input);
        }
        if (scopeKey == null) {
            throw new BizException(40000, "scope=customer 时必须带 scopeKey");
        }
        Customer customer = customerMapper.selectOne(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId).eq(Customer::getId, scopeKey).last("LIMIT 1"));
        if (customer == null) {
            throw new BizException(40404, "客户不存在: " + scopeKey);
        }
        TranslationSetting existing = customerRow(tenantId, scopeKey);
        if (existing == null) {
            existing = copyOf(requireSettings(tenantId), tenantId, scopeKey);
            settingMapper.insert(existing);
        }
        // updateSettings 只认全局行，这里复用它同样的校验 + 赋值：把行 id 换掉即可。
        return saveInto(existing, tenantId, input);
    }

    @Transactional
    public int clearCustomerSettings(Long tenantId, Long customerId) {
        return settingMapper.delete(new LambdaQueryWrapper<TranslationSetting>()
            .eq(TranslationSetting::getTenantId, tenantId)
            .eq(TranslationSetting::getScope, "customer")
            .eq(TranslationSetting::getScopeKey, String.valueOf(customerId)));
    }

    /**
     * 校验 + 逐字段赋值 + 写库，全局行与客户行共用同一份（R5：规则不出现两份）。
     * current 由调用方给：requireSettings 的兜底行，或 updateScopedSettings 的复制行。
     */
    private TranslationSettingVO saveInto(TranslationSetting current, Long tenantId, TranslationSettingInput input) {
        String channel = defaultIfBlank(input.channel(), current.getChannel());
        String server = defaultIfBlank(input.server(), current.getServer());
        if (!CHANNELS.contains(channel)) {
            throw new BizException(40000, "channel 只能是 1..7");
        }
        Set<String> nodeNames = nodeMapper.selectList(new LambdaQueryWrapper<TranslationNode>())
            .stream().map(TranslationNode::getName).collect(java.util.stream.Collectors.toSet());
        if (!nodeNames.contains(server)) {
            throw new BizException(40000, "未知翻译节点: " + server);
        }
        if ("hk".equals(server) && !"1".equals(channel)) {
            throw new BizException(40000, "hk 节点只支持 Google 线路");
        }
        current.setChannel(channel);
        current.setServer(server);
        current.setServerMode(defaultIfBlank(input.serverMode(), current.getServerMode()));
        current.setReceiveEnabled(input.receiveEnabled() == null ? current.getReceiveEnabled() : input.receiveEnabled());
        current.setReceiveFromLang(input.receiveFromLang() == null ? current.getReceiveFromLang() : input.receiveFromLang().trim());
        current.setReceiveToLang(langOrKeep(input.receiveToLang(), current.getReceiveToLang(), "receiveToLang"));
        current.setSendEnabled(input.sendEnabled() == null ? current.getSendEnabled() : input.sendEnabled());
        current.setSendFromLang(input.sendFromLang() == null ? current.getSendFromLang() : input.sendFromLang().trim());
        current.setSendToLang(langOrKeep(input.sendToLang(), current.getSendToLang(), "sendToLang"));
        current.setVoiceEnabled(input.voiceEnabled() == null ? current.getVoiceEnabled() : input.voiceEnabled());
        current.setPreviewEnabled(input.previewEnabled() == null ? current.getPreviewEnabled() : input.previewEnabled());
        current.setEnterToSend(input.enterToSend() == null ? current.getEnterToSend() : input.enterToSend());
        current.setDisableChinese(input.disableChinese() == null ? current.getDisableChinese() : input.disableChinese());
        current.setDisableChinesePreventSend(input.disableChinesePreventSend() == null
            ? current.getDisableChinesePreventSend() : input.disableChinesePreventSend());
        settingMapper.updateById(current);
        TranslationSetting saved = settingMapper.selectById(current.getId());
        return toVO(saved, "global".equals(saved.getScope()));
    }

    /** 从全局整份复制一条客户覆盖行——除定位列外的全部字段照抄，之后由 saveInto 打上本次改动。 */
    private static TranslationSetting copyOf(TranslationSetting global, Long tenantId, Long customerId) {
        TranslationSetting row = new TranslationSetting();
        row.setTenantId(tenantId);
        row.setScope("customer");
        row.setScopeKey(String.valueOf(customerId));
        row.setServer(global.getServer());
        row.setServerMode(global.getServerMode());
        row.setChannel(global.getChannel());
        row.setReceiveEnabled(global.getReceiveEnabled());
        row.setReceiveFromLang(global.getReceiveFromLang());
        row.setReceiveToLang(global.getReceiveToLang());
        row.setSendEnabled(global.getSendEnabled());
        row.setSendFromLang(global.getSendFromLang());
        row.setSendToLang(global.getSendToLang());
        row.setVoiceEnabled(global.getVoiceEnabled());
        row.setPreviewEnabled(global.getPreviewEnabled());
        row.setEnterToSend(global.getEnterToSend());
        row.setDisableChinese(global.getDisableChinese());
        row.setDisableChinesePreventSend(global.getDisableChinesePreventSend());
        return row;
    }

    /**
     * 目标语言的局部提交语义：不传就保留库里现值（PUT 因此可以只带改动的那一个字段），
     * 传了就不能是空白 —— 目标语言没有 auto，空串会一路带到厂商再失败，
     * 表面看着像"线路降级"，实际是配置写坏了。
     */
    private static String langOrKeep(String incoming, String current, String field) {
        if (incoming == null) {
            return current;
        }
        String trimmed = incoming.trim();
        if (trimmed.isEmpty()) {
            throw new BizException(40000, field + " 不能为空白");
        }
        return trimmed;
    }

    // 1) 取设置：按 scope 定位，global 保持 P5 的兜底建行行为不变
    private TranslationSetting settingRow(Long tenantId, String scope, String scopeKey) {
        LambdaQueryWrapper<TranslationSetting> query = new LambdaQueryWrapper<TranslationSetting>()
            .eq(TranslationSetting::getTenantId, tenantId)
            .eq(TranslationSetting::getScope, scope);
        // 全局行的 scope_key 是 NULL：`eq(column, null)` 编译成 `scope_key = NULL`，
        // 在 SQL 里永假，会把既有全局行也判成"不存在"——必须显式 isNull（P5 行为不变的前提）。
        if (scopeKey == null) {
            query.isNull(TranslationSetting::getScopeKey);
        } else {
            query.eq(TranslationSetting::getScopeKey, scopeKey);
        }
        return settingMapper.selectOne(query.last("LIMIT 1"));
    }

    /** 客户行的读取：不建行。没有覆盖行就是"跟随全局"。 */
    private TranslationSetting customerRow(Long tenantId, Long customerId) {
        return settingRow(tenantId, "customer", String.valueOf(customerId));
    }

    private TranslationSetting requireSettings(Long tenantId) {
        TranslationSetting setting = settingRow(tenantId, "global", null);
        if (setting != null) {
            return setting;
        }
        setting = new TranslationSetting();
        setting.setTenantId(tenantId);
        setting.setScope("global");
        settingMapper.insert(setting);
        return settingMapper.selectById(setting.getId());
    }

    // ============ nodes ============

    public List<TranslationNodeVO> nodes() {
        return nodeMapper.selectList(new LambdaQueryWrapper<TranslationNode>()
                .orderByAsc(TranslationNode::getSort))
            .stream()
            .map(n -> new TranslationNodeVO(n.getId(), n.getName(), n.getLabel(), n.getUrl(),
                n.getBaseDelayMs(), n.getReachable()))
            .toList();
    }

    /** R9: delay is arithmetic, never a sleep. Unreachable nodes report null. */
    public List<ServerDelayVO> delays() {
        return nodeMapper.selectList(new LambdaQueryWrapper<TranslationNode>()
                .orderByAsc(TranslationNode::getSort))
            .stream()
            .map(n -> new ServerDelayVO(n.getName(),
                Boolean.FALSE.equals(n.getReachable()) ? null : n.getBaseDelayMs() + ThreadLocalRandom.current().nextInt(31)))
            .toList();
    }

    // ============ translate ============

    // 2) translate()：入口先解析生效行，其余逻辑一律读 s.* 而不是全局
    public TranslateVO translate(Long tenantId, TranslateDTO dto) {
        if (!"receive".equals(dto.type()) && !"send".equals(dto.type())) {
            throw new BizException(40000, "type 只能是 receive 或 send");
        }
        TranslationSetting customer = dto.customerId() == null ? null : customerRow(tenantId, dto.customerId());
        ScopeSettings.Resolved resolved = ScopeSettings.resolve(dto.customerId(), customer, requireSettings(tenantId));
        TranslationSetting s = resolved.setting();
        // 缓存 key 不变：key 里已经含 type + channel + from + to（buildCacheKey），
        // 语向不同天然分键，所以按客户切换语向不需要新增失效逻辑（spec §5）。
        String fromLang = "receive".equals(dto.type()) ? s.getReceiveFromLang() : s.getSendFromLang();
        String toLang = "receive".equals(dto.type()) ? s.getReceiveToLang() : s.getSendToLang();
        String channel = s.getChannel();
        String normalized = SimulatedTranslationEngine.normalize(dto.text());
        if (normalized.isEmpty()) {
            throw new BizException(40000, "text 不能为空白");
        }
        String cacheKey = buildCacheKey(dto.type(), channel, fromLang, toLang, normalized);
        boolean keepInCache = !Boolean.TRUE.equals(dto.input());

        if (!Boolean.TRUE.equals(dto.noCache())) {
            TranslationCache hit = cacheMapper.selectOne(new LambdaQueryWrapper<TranslationCache>()
                .eq(TranslationCache::getTenantId, tenantId)
                .eq(TranslationCache::getCacheKey, cacheKey));
            if (hit != null) {
                cacheMapper.update(null, new LambdaUpdateWrapper<TranslationCache>()
                    .eq(TranslationCache::getId, hit.getId())
                    .setSql("hit_count = hit_count + 1"));
                return new TranslateVO(hit.getTargetText(), true, Boolean.TRUE.equals(hit.getPartial()),
                    containsChinese(hit.getTargetText()), dto.type(), channel,
                    displayFrom(fromLang, hit.getFromLang()), toLang, cacheKey, false, null);
            }
        }

        // R7: same in and out language — hand back the source, and do not cache it.
        if (fromLang != null && fromLang.equals(toLang)) {
            return new TranslateVO(normalized, false, false, containsChinese(normalized), dto.type(), channel,
                fromLang, toLang, cacheKey, false, null);
        }

        String providerId = CHANNEL_TO_PROVIDER.get(channel);
        if (providerId != null) {
            Credentials creds = loadCredentials(tenantId, providerId);
            if (creds != null) {
                try {
                    ProviderResult online = providers.get(providerId).translate(creds, normalized, fromLang, toLang);
                    if (keepInCache) {
                        writeCache(tenantId, cacheKey, dto.type(), channel, fromLang, toLang,
                            normalized, online.translation(), false);
                    }
                    return new TranslateVO(online.translation(), false, false,
                        containsChinese(online.translation()), dto.type(), channel,
                        displayFrom(fromLang, online.detectedFrom()), toLang, cacheKey, false, null);
                } catch (ProviderException e) {
                    // The request already carries a 4s timeout; one fall-through to the
                    // simulated engine, with the vendor error surfaced instead of swallowed.
                    SimulatedTranslationEngine.EngineResult fallback =
                        engine.translate(normalized, fromLang, toLang, channel);
                    return new TranslateVO(fallback.translation(), false, fallback.partial(),
                        containsChinese(fallback.translation()), dto.type(), channel,
                        fallback.fromLang(), toLang, cacheKey, true, e.getMessage());
                }
            }
            SimulatedTranslationEngine.EngineResult fallback =
                engine.translate(normalized, fromLang, toLang, channel);
            return new TranslateVO(fallback.translation(), false, fallback.partial(),
                containsChinese(fallback.translation()), dto.type(), channel,
                fallback.fromLang(), toLang, cacheKey, true,
                providerId + " 未配置密钥，此结果来自本地模拟引擎");
        }

        SimulatedTranslationEngine.EngineResult result = engine.translate(normalized, fromLang, toLang, channel);
        if (keepInCache) {
            writeCache(tenantId, cacheKey, dto.type(), channel, fromLang, toLang,
                normalized, result.translation(), result.partial());
        }
        return new TranslateVO(result.translation(), false, result.partial(), containsChinese(result.translation()),
            dto.type(), channel, result.fromLang(), toLang, cacheKey, false, null);
    }

    private void writeCache(Long tenantId, String cacheKey, String type, String channel, String fromLang,
                            String toLang, String sourceText, String targetText, boolean partial) {
        TranslationCache row = new TranslationCache();
        row.setTenantId(tenantId);
        row.setCacheKey(cacheKey);
        row.setType(type);
        row.setChannel(channel);
        row.setFromLang(fromLang == null ? "" : fromLang);
        row.setToLang(toLang);
        row.setSourceText(sourceText);
        row.setTargetText(targetText);
        row.setPartial(partial);
        row.setHitCount(0);
        try {
            cacheMapper.insert(row);
        } catch (org.springframework.dao.DuplicateKeyException race) {
            // Another request for the same phrase won the race; its value is identical.
            cacheMapper.update(null, new LambdaUpdateWrapper<TranslationCache>()
                .eq(TranslationCache::getTenantId, tenantId)
                .eq(TranslationCache::getCacheKey, cacheKey)
                .setSql("hit_count = hit_count + 1"));
        }
    }

    public static String buildCacheKey(String type, String channel, String fromLang, String toLang, String normalized) {
        long hash = LongHashFunction.xx().hashChars(normalized);
        String from = (fromLang == null || fromLang.isBlank()) ? "auto" : fromLang;
        return type + "-" + channel + "-" + from + "-" + toLang + "-" + String.format("%016x", hash);
    }

    // ============ stats ============

    public TranslationCacheStatsVO cacheStats(Long tenantId) {
        List<TranslationCacheEntryVO> top = cacheMapper.selectList(new LambdaQueryWrapper<TranslationCache>()
                .eq(TranslationCache::getTenantId, tenantId)
                .orderByDesc(TranslationCache::getHitCount)
                .orderByDesc(TranslationCache::getId)
                .last("LIMIT 5"))
            .stream()
            .map(c -> new TranslationCacheEntryVO(c.getCacheKey(), c.getSourceText(), c.getTargetText(),
                c.getHitCount(), c.getPartial()))
            .toList();
        return new TranslationCacheStatsVO(cacheMapper.countKeys(tenantId), cacheMapper.sumHits(tenantId), top);
    }

    // ============ credentials ============

    public List<TranslationCredentialVO> credentials(Long tenantId) {
        return credentialMapper.selectList(new LambdaQueryWrapper<TranslationCredential>()
                .eq(TranslationCredential::getTenantId, tenantId)
                .orderByAsc(TranslationCredential::getProvider))
            .stream()
            .map(c -> new TranslationCredentialVO(c.getProvider(), c.getAppId(),
                c.getSecretKey() != null && !c.getSecretKey().isBlank(), c.getRegion(), c.getUpdatedAt()))
            .toList();
    }

    public TranslationCredentialVO putCredential(Long tenantId, TranslationCredentialInput input) {
        String providerId = input.provider().trim();
        if (!providers.containsKey(providerId)) {
            throw new BizException(40000, "未知翻译服务商: " + providerId);
        }
        TranslationCredential existing = credentialMapper.selectOne(new LambdaQueryWrapper<TranslationCredential>()
            .eq(TranslationCredential::getTenantId, tenantId)
            .eq(TranslationCredential::getProvider, providerId));
        String secret = input.secretKey() == null || input.secretKey().isBlank()
            ? (existing == null ? null : existing.getSecretKey())
            : input.secretKey().trim();
        if (secret == null || secret.isBlank()) {
            throw new BizException(40000, "secretKey 不能为空（首次配置必须填写密钥）");
        }
        TranslationCredential row = existing == null ? new TranslationCredential() : existing;
        row.setTenantId(tenantId);
        row.setProvider(providerId);
        row.setAppId(input.appId().trim());
        row.setSecretKey(secret);
        row.setRegion(input.region() == null || input.region().isBlank() ? null : input.region().trim());
        if (existing == null) {
            credentialMapper.insert(row);
        } else {
            credentialMapper.updateById(row);
            if (row.getRegion() == null) {
                // updateById skips null fields; clearing the region needs an explicit set.
                credentialMapper.update(null, new LambdaUpdateWrapper<TranslationCredential>()
                    .eq(TranslationCredential::getId, row.getId())
                    .set(TranslationCredential::getRegion, null));
            }
        }
        TranslationCredential saved = credentialMapper.selectById(row.getId());
        return new TranslationCredentialVO(saved.getProvider(), saved.getAppId(), true,
            saved.getRegion(), saved.getUpdatedAt());
    }

    /** One real probe request against the vendor: zh-CN -> en, a fixed short sentence. */
    public CredentialTestVO testCredential(Long tenantId, CredentialTestDTO dto) {
        String providerId = dto.provider().trim();
        TranslationProvider provider = providers.get(providerId);
        if (provider == null) {
            throw new BizException(40000, "未知翻译服务商: " + providerId);
        }
        Credentials creds = loadCredentials(tenantId, providerId);
        if (creds == null) {
            return new CredentialTestVO(false, null, "未配置密钥");
        }
        long start = System.nanoTime();
        try {
            ProviderResult result = provider.translate(creds, "你好，很高兴认识你", "zh-CN", "en");
            long ms = (System.nanoTime() - start) / 1_000_000;
            return new CredentialTestVO(true, ms, "可用 · " + ms + "ms · " + result.translation());
        } catch (ProviderException e) {
            long ms = (System.nanoTime() - start) / 1_000_000;
            return new CredentialTestVO(false, ms, e.getMessage());
        }
    }

    /** Null when the tenant has never stored a key for this provider. */
    private Credentials loadCredentials(Long tenantId, String providerId) {
        TranslationCredential row = credentialMapper.selectOne(new LambdaQueryWrapper<TranslationCredential>()
            .eq(TranslationCredential::getTenantId, tenantId)
            .eq(TranslationCredential::getProvider, providerId));
        if (row == null || row.getAppId() == null || row.getAppId().isBlank()
            || row.getSecretKey() == null || row.getSecretKey().isBlank()) {
            return null;
        }
        return new Credentials(row.getAppId(), row.getSecretKey(), row.getRegion());
    }

    // ============ helpers ============

    private boolean containsChinese(String text) {
        return text != null && CHINESE.matcher(text).find();
    }

    private String displayFrom(String configured, String cachedFrom) {
        return (configured == null || configured.isBlank()) ? cachedFrom : configured;
    }

    private String defaultIfBlank(String value, String fallback) {
        return (value == null || value.isBlank()) ? fallback : value.trim();
    }

    private TranslationSettingVO toVO(TranslationSetting s, boolean inherited) {
        return new TranslationSettingVO(s.getId(), s.getServer(), s.getServerMode(), s.getChannel(),
            s.getReceiveEnabled(), s.getReceiveFromLang(), s.getReceiveToLang(),
            s.getSendEnabled(), s.getSendFromLang(), s.getSendToLang(),
            s.getVoiceEnabled(), s.getPreviewEnabled(), s.getEnterToSend(),
            s.getDisableChinese(), s.getDisableChinesePreventSend(),
            s.getScope(), s.getScopeKey(), inherited);
    }
}
