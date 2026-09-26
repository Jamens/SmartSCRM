package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.entity.TranslationCache;
import com.smartscrm.server.entity.TranslationCredential;
import com.smartscrm.server.entity.TranslationNode;
import com.smartscrm.server.entity.TranslationSetting;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.mapper.TranslationCacheMapper;
import com.smartscrm.server.mapper.TranslationCredentialMapper;
import com.smartscrm.server.mapper.TranslationNodeMapper;
import com.smartscrm.server.mapper.TranslationSettingMapper;
import com.smartscrm.server.service.msg.ConversationScopeKey;
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
    private final ChatConversationMapper conversationMapper;
    private final PlatformAccountMapper accountMapper;
    private final SimulatedTranslationEngine engine;
    private final Map<String, TranslationProvider> providers;

    public TranslationService(TranslationSettingMapper settingMapper, TranslationNodeMapper nodeMapper,
                              TranslationCacheMapper cacheMapper, TranslationCredentialMapper credentialMapper,
                              CustomerMapper customerMapper, ChatConversationMapper conversationMapper,
                              PlatformAccountMapper accountMapper,
                              SimulatedTranslationEngine engine, List<TranslationProvider> providerBeans) {
        this.settingMapper = settingMapper;
        this.nodeMapper = nodeMapper;
        this.cacheMapper = cacheMapper;
        this.credentialMapper = credentialMapper;
        this.customerMapper = customerMapper;
        this.conversationMapper = conversationMapper;
        this.accountMapper = accountMapper;
        this.engine = engine;
        this.providers = providerBeans.stream()
            .collect(Collectors.toMap(TranslationProvider::providerId, Function.identity()));
    }

    // ============ settings ============

    /**
     * 生效行解析：会话档 -> 客户档 -> 全局。**GET 与 translate 共用这一处**（spec §3.2），
     * 所以两个入口不可能读出不同的生效值——回复框旁的摘要与那次发送真正用的语向是同一份。
     * <p>
     * 答的是"这个作用域下的生效行"，不是"这一档有没有行"：会话档不存在时回落到生效档，
     * `inherited` 按 resolve 的结论（spec §3.1 的三态表）。
     */
    public TranslationSettingVO getSettings(Long tenantId, Long customerId, Long accountId, String chatKey) {
        ScopeSettings.Resolved resolved = resolveSetting(tenantId, customerId, accountId, chatKey);
        return toVO(resolved.setting(), resolved.scope(), resolved.inherited());
    }

    private ScopeSettings.Resolved resolveSetting(Long tenantId, Long customerId, Long accountId, String chatKey) {
        String key = ConversationScopeKey.composeOrNull(accountId, chatKey);
        TranslationSetting conversation = key == null ? null : settingRow(tenantId, "conversation", key);
        if (conversation != null) {
            // 命中就不再往下查：优先级与下面两档无关（spec §3.2），传 null 是把"未被咨询"写进调用形状。
            return ScopeSettings.resolve(conversation, null, null);
        }
        Long projected = customerId != null ? customerId : customerOfChat(tenantId, accountId, chatKey);
        TranslationSetting customer = projected == null ? null : customerRow(tenantId, projected);
        return ScopeSettings.resolve(null, customer, requireSettings(tenantId));
    }

    /** 全局档：唯一不需要定位参数的档位，"库里还没有全局行"由 requireSettings 兜底建行。 */
    @Transactional
    public TranslationSettingVO updateSettings(Long tenantId, TranslationSettingInput input) {
        return saveInto(requireSettings(tenantId), tenantId, input);
    }

    /**
     * 客户档：从**全局行**整份复制后覆盖。这里的"整份"是 P6 定下的语义（未提交的列不能是 NULL，
     * 得是复制那一刻全局的值），复制源不含会话档——客户那一行是全局给这位客户的默认，
     * 与某一条会话里改过什么无关。
     * customerId 由控制器解好数字（P-06：档位形态的判定只在一处），所以这里判 null 只可能是
     * 调用方漏了参数，直接 40000。
     */
    @Transactional
    public TranslationSettingVO updateCustomerSettings(Long tenantId, Long customerId, TranslationSettingInput input) {
        if (customerId == null) {
            throw new BizException(40000, "scope=customer 时必须带 scopeKey");
        }
        Customer customer = customerMapper.selectOne(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId).eq(Customer::getId, customerId).last("LIMIT 1"));
        if (customer == null) {
            throw new BizException(40404, "客户不存在: " + customerId);
        }
        TranslationSetting existing = customerRow(tenantId, customerId);
        // 客户档与会话档共用同一个"撞键就 adopts 对手那一行"的口子（R5：规则不出现两份）。
        // 现实概率并不比会话档低：这一档的两个写入口（客户抽屉、记录页会话头）落在同一个人身上是日常态。
        if (existing == null) {
            String key = String.valueOf(customerId);
            existing = insertOrAdopt(copyOf(requireSettings(tenantId), tenantId, "customer", key),
                tenantId, "customer", "该客户", key);
        }
        // saveInto 只认"改哪些字段"，行由调用方给：三档共用同一份校验 + 赋值（R5：规则不出现两份）。
        return saveInto(existing, tenantId, input);
    }

    /**
     * 会话档。键在 service 内合成（P-06 裁定）：spec §3.3 要求复制源是"这一条会话此刻的生效值"
     * = `cust ?? global`，而找那位客户要的是 `accountId` + `chatKey` 的投影——只给一条成形键就
     * 必须反解析它。键只整串比对、不反解析，比参数形态的字面一致更重要。
     * <p>
     * 首次建行抄的是 `customerRow ?? global`：从弹层里第一次保存时前端手里那份就是 resolve 的结果，
     * 整份复制让"新出现的会话行"与"用户此刻看到的值"逐字段相同。合成链与读侧同一条
     * （`customerOfChat` → `customerRow` → `requireSettings`），所以第一次 PUT 建出的行，
     * 与 PUT 之前 GET 读到的那一行只差本次改动的那几个字段。
     */
    @Transactional
    public TranslationSettingVO updateConversationSettings(Long tenantId, TranslationSettingInput input) {
        Long accountId = requireAccount(tenantId, input.accountId());
        String key = ConversationScopeKey.compose(accountId, input.chatKey());
        TranslationSetting existing = settingRow(tenantId, "conversation", key);
        if (existing != null) {
            return saveInto(existing, tenantId, input);
        }
        Long projected = customerOfChat(tenantId, accountId, input.chatKey());
        TranslationSetting source = projected == null ? null : customerRow(tenantId, projected);
        if (source == null) {
            source = requireSettings(tenantId);
        }
        TranslationSetting created = copyOf(source, tenantId, "conversation", key);
        return saveInto(insertOrAdopt(created, tenantId, "conversation", "该会话", key), tenantId, input);
    }

    /**
     * 建一行覆盖档，并把"并发首存"这一格处理成业务码而不是 50000（C12）。会话档与客户档共用它
     * （R5：同一份竞态规则不写两遍）。三条出口：
     * <ol>
     *   <li><b>建成</b> —— 返回手里这条新行，调用方继续 {@code saveInto} 打上本次改动。</li>
     *   <li><b>撞键</b>（{@link org.springframework.dao.DuplicateKeyException}）—— 另一个窗口把同一键的
     *       那一行同时首存了。InnoDB 的重复键只回滚该语句、事务仍可继续，而撞键这个事实本身就说明对手
     *       已经提交（重复键判定要等它的写锁），所以用**当前读**去拿那一行、把本次改动落到它上面——
     *       与不撞键时的行为逐字相同（整份覆盖的既有语义：两边都 200，后写胜出）。
     *       快照读拿不到那一行，见 {@link #settingRowForUpdate} 的注释。</li>
     *   <li><b>撞键但那一行已经没了</b> —— 只可能是撞键之后有人并发删了它（{@code DELETE} 那两个口）。
     *       此时库里确实没有行，回 40901 + 请重试。</li>
     * </ol>
     * 另外单独挡一支 {@link org.springframework.dao.ConcurrencyFailureException}：≥3 发同时首存同一键时，
     * 各支都会在重复键错误上持住那条记录的 S 锁，再各自要 {@code FOR UPDATE} 的 X 锁 —— S→X 升级是
     * InnoDB 的经典死锁形状，被选为牺牲者那支的**整个事务**已被 InnoDB 回滚，所以这里不能"继续往下写"
     * （写的就不是本事务读到的值了），只能回 40901 让调用方重试。两发不死锁：loser 拿到重复键时
     * winner 已经提交并放锁，实测（2026-09-26 四次真并发跑）loser 只在 insert 上等约 10ms。
     * 这一支未被实跑触发（要 ≥3 发同一毫秒、且 InnoDB 恰好选牺牲者），属**读码**的兜底。
     */
    private TranslationSetting insertOrAdopt(TranslationSetting draft, Long tenantId, String scope,
                                             String noun, String scopeKey) {
        try {
            settingMapper.insert(draft);
            return draft;
        } catch (org.springframework.dao.DuplicateKeyException race) {
            TranslationSetting winner = settingRowForUpdate(tenantId, scope, scopeKey);
            if (winner == null) {
                throw new BizException(40901, noun + "的语向行刚被别处创建又被删除，请重试");
            }
            return winner;
        } catch (org.springframework.dao.ConcurrencyFailureException lock) {
            throw new BizException(40901, noun + "的语向刚被别处改动，请重试");
        }
    }

    @Transactional
    public int clearCustomerSettings(Long tenantId, Long customerId) {
        return settingMapper.delete(new LambdaQueryWrapper<TranslationSetting>()
            .eq(TranslationSetting::getTenantId, tenantId)
            .eq(TranslationSetting::getScope, "customer")
            .eq(TranslationSetting::getScopeKey, String.valueOf(customerId)));
    }

    /**
     * 删会话覆盖行 = 这条会话回到"客户档，没有客户档再回全局"。
     * 形状判定用 `rejectReason` 而不是 `compose`：两者抛的都是 40000，但这条方法要把
     * "参数不合法"与"库里没有这一行"分开报（C12）——后者是 `cleared:0` 的正常成功，
     * 拿异常去表达它，界面读到的就是"按钮坏了"。
     */
    @Transactional
    public int clearConversationSettings(Long tenantId, Long accountId, String chatKey) {
        String reason = ConversationScopeKey.rejectReason(accountId, chatKey);
        if (reason != null) {
            throw new BizException(40000, reason);
        }
        requireAccount(tenantId, accountId);
        return settingMapper.delete(new LambdaQueryWrapper<TranslationSetting>()
            .eq(TranslationSetting::getTenantId, tenantId)
            .eq(TranslationSetting::getScope, "conversation")
            .eq(TranslationSetting::getScopeKey, ConversationScopeKey.compose(accountId, chatKey)));
    }

    /**
     * 会话档的定位半边之一：`accountId` 必须是**本租户**的账号。判 40000 而不是 40404（spec §7），
     * 因为调用方拿到的是"你给的这半件配不成一条键"，不是"某个资源不见了"。
     * <p>
     * 不拦的后果不自愈：合成出的 `scope_key` 挂在别人家账号名下，读侧按同一条合成链永远查不到这一行，
     * 界面表现为「保存成功、徽标却不动」，而后端一句不响。
     */
    private Long requireAccount(Long tenantId, Long accountId) {
        if (accountId == null) {
            throw new BizException(40000, "scope=conversation 时必须带 accountId");
        }
        Long owned = accountMapper.selectCount(new LambdaQueryWrapper<PlatformAccount>()
            .eq(PlatformAccount::getTenantId, tenantId)
            .eq(PlatformAccount::getId, accountId));
        if (owned == 0) {
            throw new BizException(40000, "accountId 不属于本租户: " + accountId);
        }
        return accountId;
    }

    /**
     * 校验 + 逐字段赋值 + 写库，三档共用同一份（R5：规则不出现两份）。
     * current 由调用方给：这一档此刻该写的那一行——全局兜底行、客户档的复制行、会话档按合成键
     * 定位到（或新建）的行。档位判定不在这里，所以这里不可能把行写到别的档上。
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
        // 刚写入的那行：档位就是它自己的列值，`inherited` 只有全局行算真。
        return toVO(saved, saved.getScope(), "global".equals(saved.getScope()));
    }

    /**
     * 整份复制一条覆盖行：除定位列外的全部字段照抄，之后由 saveInto 打上本次改动。
     * `source` 不必是全局行——客户档从全局复制，会话档从"该会话此刻的生效行"复制（见调用处），
     * 所以源与目标档位都是参数。
     */
    private static TranslationSetting copyOf(TranslationSetting source, Long tenantId, String scope, String scopeKey) {
        TranslationSetting row = new TranslationSetting();
        row.setTenantId(tenantId);
        row.setScope(scope);
        row.setScopeKey(scopeKey);
        row.setServer(source.getServer());
        row.setServerMode(source.getServerMode());
        row.setChannel(source.getChannel());
        row.setReceiveEnabled(source.getReceiveEnabled());
        row.setReceiveFromLang(source.getReceiveFromLang());
        row.setReceiveToLang(source.getReceiveToLang());
        row.setSendEnabled(source.getSendEnabled());
        row.setSendFromLang(source.getSendFromLang());
        row.setSendToLang(source.getSendToLang());
        row.setVoiceEnabled(source.getVoiceEnabled());
        row.setPreviewEnabled(source.getPreviewEnabled());
        row.setEnterToSend(source.getEnterToSend());
        row.setDisableChinese(source.getDisableChinese());
        row.setDisableChinesePreventSend(source.getDisableChinesePreventSend());
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
        return settingMapper.selectOne(settingQuery(tenantId, scope, scopeKey).last("LIMIT 1"));
    }

    /**
     * 同一条定位条件的**当前读**（{@code FOR UPDATE}）。只给 {@link #insertOrAdopt} 撞键那一支用：
     * MySQL 默认 REPEATABLE READ 下，事务里的普通 SELECT 读的是本事务第一次读建立的快照，
     * 所以"对手刚提交的那一行"在撞键之后仍然看不见——2026-09-26 一次真并发跑里，撞键那支的快照读
     * 拿到的就是 {@code null}，只能退回 40901，而库里那一行明明已经存在（逐条现场值见
     * {@code docs/notes/2026-09-25-conversation-settings-verification.md} 的"后端"一节）。
     * 加锁读走的是当前读，看得见对手已提交的行，因此本次保存能落到那一行上（后写覆盖，两边都 200）。
     * 锁的代价：三列等值正好覆盖唯一键 {@code uk_tset_tenant_scope} 的全部列，查到行时锁的就是那一条
     * 索引记录，且拿到锁之后本来就要写它——等于把 {@code updateById} 的 X 锁提前到读的位置；
     * 查不到行时（并发删除那一格）锁的是该键位置上的**间隙**，随后抛 {@code BizException} 触发回滚、
     * 毫秒级释放。两种情形的持有时长都到本事务结束。
     */
    private TranslationSetting settingRowForUpdate(Long tenantId, String scope, String scopeKey) {
        return settingMapper.selectOne(settingQuery(tenantId, scope, scopeKey).last("LIMIT 1 FOR UPDATE"));
    }

    /** 三档共用的那条定位条件。尾串（{@code LIMIT} / {@code FOR UPDATE}）由各调用方自己接——
     *  MyBatis-Plus 的 {@code last()} 是覆盖式的，在这儿先占就会被后面那次 {@code last()} 抹掉。 */
    private LambdaQueryWrapper<TranslationSetting> settingQuery(Long tenantId, String scope, String scopeKey) {
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
        return query;
    }

    /** 客户行的读取：不建行。没有覆盖行就是"跟随全局"。 */
    private TranslationSetting customerRow(Long tenantId, Long customerId) {
        return settingRow(tenantId, "customer", String.valueOf(customerId));
    }

    /**
     * 客户档的会话投影：把"当前会话"换成客户 id。三种情况一律返回 null 回落全局——
     * 请求没带齐 accountId/chatKey、查不到会话行、行上没挂客户。
     * `resolveSetting` 只在**会话档没命中**时才调它（D-01：会话档优先，与投影无关）。
     * 只按 uk_conv 的三列精确匹配，不做前缀模糊：猜错语向译出的是别人家的语言，
     * 比"没译"更难排查。
     * <p>
     * 第四列 platform 不必再进 WHERE：account_id 是 platform_accounts 的主键，一个账号只属于
     * 一个平台，拿它筛过的行再筛平台是恒真的附加条件。所以"账号与会话不是一对"的请求
     * （TG 账号 id 配一个 WA 的 chatKey）落到"查不到行"这一档，而不是 400。
     */
    private Long customerOfChat(Long tenantId, Long accountId, String chatKey) {
        if (accountId == null || chatKey == null || chatKey.isBlank()) {
            return null;
        }
        ChatConversation conv = conversationMapper.selectOne(new LambdaQueryWrapper<ChatConversation>()
            .eq(ChatConversation::getTenantId, tenantId)
            .eq(ChatConversation::getAccountId, accountId)
            .eq(ChatConversation::getChatKey, chatKey)
            .last("LIMIT 1"));
        return conv == null ? null : conv.getCustomerId();
    }

    /**
     * 全局行：读不到就建一条（P5 起的兜底行为，不改）。
     * <p>
     * 这一支与 {@link #insertOrAdopt} 修掉的是同一个"先查后插"形状，**刻意不套那个口子**，两条理由：
     * 它同时被读路径（{@code resolveSetting} → GET / translate）调用，而那两个入口没有 {@code @Transactional}，
     * insert 跑在 autocommit 里——"事务内改用当前读"的前提在这里不成立，为它给 GET 加事务是反向的代价。
     * 而可达窗口只有一次：该租户**第一条**全局行（现网库里的行由 {@code V5} 末尾那句
     * {@code INSERT INTO translation_setting (tenant_id)} 建好，正常运营下不再走到）。
     * 真撞上了就是 {@code 50000} + 重试，数据不坏。已按这一口径记进验收文档的"已知限制"。
     */
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
        ScopeSettings.Resolved resolved = resolveSetting(tenantId, dto.customerId(), dto.accountId(), dto.chatKey());
        TranslationSetting s = resolved.setting();
        // 生效档随响应带出去：记录页要在"这一条实际按哪一档译出"上说一句话（spec §4③）。
        // 档位取 resolve 的结论而不是行上的列——列写坏了也不该让这里报出一个不存在的档。
        String scope = resolved.scope();
        // 缓存 key 不变：key 里已经含 type + channel + from + to（buildCacheKey），
        // 语向不同天然分键，所以按客户 / 按会话切换语向都不需要新增失效逻辑（spec §5）。
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
                    displayFrom(fromLang, hit.getFromLang()), toLang, cacheKey, false, null, scope);
            }
        }

        // R7: same in and out language — hand back the source, and do not cache it.
        if (fromLang != null && fromLang.equals(toLang)) {
            return new TranslateVO(normalized, false, false, containsChinese(normalized), dto.type(), channel,
                fromLang, toLang, cacheKey, false, null, scope);
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
                        displayFrom(fromLang, online.detectedFrom()), toLang, cacheKey, false, null, scope);
                } catch (ProviderException e) {
                    // The request already carries a 4s timeout; one fall-through to the
                    // simulated engine, with the vendor error surfaced instead of swallowed.
                    SimulatedTranslationEngine.EngineResult fallback =
                        engine.translate(normalized, fromLang, toLang, channel);
                    return new TranslateVO(fallback.translation(), false, fallback.partial(),
                        containsChinese(fallback.translation()), dto.type(), channel,
                        fallback.fromLang(), toLang, cacheKey, true, e.getMessage(), scope);
                }
            }
            SimulatedTranslationEngine.EngineResult fallback =
                engine.translate(normalized, fromLang, toLang, channel);
            return new TranslateVO(fallback.translation(), false, fallback.partial(),
                containsChinese(fallback.translation()), dto.type(), channel,
                fallback.fromLang(), toLang, cacheKey, true,
                providerId + " 未配置密钥，此结果来自本地模拟引擎", scope);
        }

        SimulatedTranslationEngine.EngineResult result = engine.translate(normalized, fromLang, toLang, channel);
        if (keepInCache) {
            writeCache(tenantId, cacheKey, dto.type(), channel, fromLang, toLang,
                normalized, result.translation(), result.partial());
        }
        return new TranslateVO(result.translation(), false, result.partial(), containsChinese(result.translation()),
            dto.type(), channel, result.fromLang(), toLang, cacheKey, false, null, scope);
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

    /**
     * VO 上那一格 `scope` 写的是"这次生效的是哪一档"，由调用方给：读侧给 `ScopeSettings.resolve`
     * 的结论，写侧给刚写入那行自己的列值。不再从 `s.getScope()` 反推——优先级的唯一定义是 resolve，
     * 让 VO 从列上猜会绕开它（spec §3.1 / §3.2）。
     */
    private TranslationSettingVO toVO(TranslationSetting s, String scope, boolean inherited) {
        return new TranslationSettingVO(s.getId(), s.getServer(), s.getServerMode(), s.getChannel(),
            s.getReceiveEnabled(), s.getReceiveFromLang(), s.getReceiveToLang(),
            s.getSendEnabled(), s.getSendFromLang(), s.getSendToLang(),
            s.getVoiceEnabled(), s.getPreviewEnabled(), s.getEnterToSend(),
            s.getDisableChinese(), s.getDisableChinesePreventSend(),
            scope, s.getScopeKey(), inherited);
    }
}
