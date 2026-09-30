package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ChatGroup;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.GroupMemberEvent;
import com.smartscrm.server.entity.GroupMemberState;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.ChatGroupMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.GroupMemberEventMapper;
import com.smartscrm.server.mapper.GroupMemberStateMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.service.msg.ChatKeys;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.web.dto.GroupMemberBatchDTO;
import com.smartscrm.server.web.dto.GroupMemberBatchDTO.EventItem;
import com.smartscrm.server.web.dto.GroupMemberBatchDTO.GroupItem;
import com.smartscrm.server.web.dto.GroupMemberBatchDTO.ParticipantItem;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 群成员采集的写入侧（spec §6）：群登记 → 事件先行 → 快照收口，三步同一事务。
 *
 * 顺序是设计不是随意：
 * <ul>
 *   <li>事件先行——事件说的是"什么时候、被谁"，快照给不出。</li>
 *   <li>快照收口——快照定"谁在群里"。它最后跑，所以它对在场性的判定覆盖事件的投影。</li>
 * </ul>
 * 反过来先跑快照的话，一条迟到的退群事件会被上一次快照的在场结论盖回去。
 */
@Service
public class GroupMemberService {

    /**
     * 覆盖率闸（spec §2#3 / §6）。与 shared/groupMembers.ts 的 {@code COVERAGE_MIN} 同一个数，
     * 两边改一个就得改另一个——闸值不一致时会出现"后端判退了、界面却显示覆盖不足"。
     */
    private static final double COVERAGE_MIN = 0.6;

    private static final Set<String> EVENT_TYPES =
        Set.of("added", "joined", "left", "removed", "promoted", "demoted");
    private static final Set<String> SOURCES = Set.of("system_message", "live_event");
    private static final Set<String> ROLES = Set.of("member", "admin", "super");

    private final ChatGroupMapper groupMapper;
    private final GroupMemberStateMapper stateMapper;
    private final GroupMemberEventMapper eventMapper;
    private final PlatformAccountMapper accountMapper;
    private final CustomerMapper customerMapper;

    public GroupMemberService(ChatGroupMapper groupMapper, GroupMemberStateMapper stateMapper,
                              GroupMemberEventMapper eventMapper, PlatformAccountMapper accountMapper,
                              CustomerMapper customerMapper) {
        this.groupMapper = groupMapper;
        this.stateMapper = stateMapper;
        this.eventMapper = eventMapper;
        this.accountMapper = accountMapper;
        this.customerMapper = customerMapper;
    }

    public record IngestResult(int groupsUpserted, int eventsInserted, boolean reconciled,
                               Double coverage, String reason) {}

    /** 覆盖率闸的判定结果。{@code reason} 的四值里 {@code no_snapshot} 是第四种，见 {@link #reconcileSnapshot}。 */
    public record CoverageVerdict(boolean reconciled, Double coverage, String reason) {}

    @Transactional
    public IngestResult ingest(Long tenantId, GroupMemberBatchDTO dto) {
        ResolvedAccount acc = resolveAccount(tenantId, dto.getAccountId());
        // 必须按 CHAT_ZONE 读：MsgTimes.toDbTime 的未来钳制以它为准，用系统默认时区会让整条时间轴平移。
        LocalDateTime now = LocalDateTime.now(MsgTimes.CHAT_ZONE);

        int groupsUpserted = upsertGroups(tenantId, acc, dto.getGroups(), now);
        int eventsInserted = ingestEvents(tenantId, acc, dto.getEvents(), now);
        CoverageVerdict verdict = reconcileSnapshot(tenantId, acc, dto.getSnapshot(), now);

        return new IngestResult(groupsUpserted, eventsInserted, verdict.reconciled(),
            verdict.coverage(), verdict.reason());
    }

    public record ResolvedAccount(Long accountId, String platform, Integer platformType) {}

    /** 账号必须属于本租户，且平台在支持面内；否则整批拒绝（与消息采集同一口径）。 */
    public ResolvedAccount resolveAccount(Long tenantId, Long accountId) {
        if (accountId == null) {
            throw new BizException(40000, "accountId 不能为空");
        }
        PlatformAccount account = accountMapper.selectById(accountId);
        if (account == null || !tenantId.equals(account.getTenantId())) {
            throw new BizException(40404, "账号不存在: " + accountId);
        }
        String platform = ChatKeys.platformOfAccountType(account.getPlatformType());
        if (platform == null) {
            throw new BizException(40000, "该平台暂不支持群成员采集: " + account.getPlatformType());
        }
        return new ResolvedAccount(accountId, platform, account.getPlatformType());
    }

    // -----------------------------------------------------------------------
    // 第 1 步：群登记
    // -----------------------------------------------------------------------

    private int upsertGroups(Long tenantId, ResolvedAccount acc, List<GroupItem> groups, LocalDateTime now) {
        if (groups == null || groups.isEmpty()) {
            return 0;
        }
        int n = 0;
        for (GroupItem g : groups) {
            if (g == null || isBlank(g.getChatKey()) || !isGroupKey(g.getChatKey())) {
                // 名单里混进非群键是上游的错，但让它建进登记册会污染整个群名单，所以静默跳过。
                continue;
            }
            n += groupMapper.upsertGroup(buildGroup(tenantId, acc, g.getChatKey(), g.getTitle()), now);
        }
        return n;
    }

    /**
     * 确保这个群在册。事件与快照都可能先于名单到达（订阅是长连的，名单是轮询的），
     * 少了这一步就会出现"有成员行但群不在册"——界面上群列表空着，成员却查得到。
     */
    private ChatGroup ensureGroup(Long tenantId, ResolvedAccount acc, String chatKey, LocalDateTime now) {
        ChatGroup existing = groupMapper.selectByKey(tenantId, acc.platform(), acc.accountId(), chatKey);
        if (existing != null) {
            return existing;
        }
        groupMapper.upsertGroup(buildGroup(tenantId, acc, chatKey, null), now);
        return groupMapper.selectByKey(tenantId, acc.platform(), acc.accountId(), chatKey);
    }

    private ChatGroup buildGroup(Long tenantId, ResolvedAccount acc, String chatKey, String title) {
        ChatGroup e = new ChatGroup();
        e.setTenantId(tenantId);
        e.setAccountId(acc.accountId());
        e.setPlatform(acc.platform());
        e.setChatKey(chatKey);
        e.setTitle(title);
        return e;
    }

    // -----------------------------------------------------------------------
    // 第 2 步：事件先行
    // -----------------------------------------------------------------------

    private int ingestEvents(Long tenantId, ResolvedAccount acc, List<EventItem> items, LocalDateTime now) {
        if (items == null || items.isEmpty()) {
            return 0;
        }
        Map<String, List<GroupMemberEvent>> byChat = new HashMap<>();
        for (EventItem it : items) {
            GroupMemberEvent e = toEvent(tenantId, acc, it, now);
            if (e != null) {
                byChat.computeIfAbsent(e.getChatKey(), k -> new ArrayList<>()).add(e);
            }
        }
        if (byChat.isEmpty()) {
            return 0;
        }

        int inserted = 0;
        for (Map.Entry<String, List<GroupMemberEvent>> entry : byChat.entrySet()) {
            String chatKey = entry.getKey();
            ensureGroup(tenantId, acc, chatKey, now);

            // 已经落库的键：对它们不做投影，否则 join_count 会被重报的事件重复累加，且永远回不去。
            Set<String> existing = new HashSet<>();
            for (GroupMemberEvent row : eventMapper.selectDedupKeys(tenantId, acc.platform(), acc.accountId(), chatKey)) {
                existing.add(dedupOf(row.getDedupKey(), row.getEventType(), row.getMemberKey()));
            }

            List<GroupMemberEvent> fresh = new ArrayList<>();
            Set<String> seenInBatch = new HashSet<>();
            for (GroupMemberEvent e : entry.getValue()) {
                String k = dedupOf(e.getDedupKey(), e.getEventType(), e.getMemberKey());
                if (!existing.contains(k) && seenInBatch.add(k)) {
                    fresh.add(e);
                }
            }
            if (fresh.isEmpty()) {
                continue;
            }
            // 按发生时间升序投影：同一个人一批里来了进又出，最后留下的必须是"出"。
            fresh.sort(Comparator.comparing(GroupMemberEvent::getOccurredAt)
                .thenComparing(GroupMemberEvent::getDedupKey));

            inserted += eventMapper.insertIgnoreBatch(fresh);
            for (GroupMemberEvent e : fresh) {
                projectEvent(tenantId, acc, e, now);
            }
        }
        return inserted;
    }

    private GroupMemberEvent toEvent(Long tenantId, ResolvedAccount acc, EventItem it, LocalDateTime now) {
        if (it == null || isBlank(it.getChatKey()) || isBlank(it.getMemberKey()) || isBlank(it.getDedupKey())) {
            return null;
        }
        if (!EVENT_TYPES.contains(it.getEventType()) || !SOURCES.contains(it.getSource())) {
            // 清单外的值一律丢弃：event_type 直接进 SQL，不能让原样字符串碰库。
            return null;
        }
        if (!isGroupKey(it.getChatKey())) {
            return null;
        }
        GroupMemberEvent e = new GroupMemberEvent();
        e.setTenantId(tenantId);
        e.setAccountId(acc.accountId());
        e.setPlatform(acc.platform());
        e.setChatKey(it.getChatKey());
        // 事件的 wire 不带群名（spec §4 的 GroupEventWire 没有这一位），所以这里恒 NULL：
        // 群的当前名字在 chat_group.title，而"发生时的名字"事件侧无从得知，
        // 拿当前值填上去会在群改名后把历史流水上的名字一起改掉——那正是这一列要防的事。
        e.setGroupTitle(null);
        e.setMemberKey(it.getMemberKey());
        e.setActorKey(it.getActorKey());
        e.setActorName(it.getActorName());
        e.setEventType(it.getEventType());
        e.setOccurredAt(MsgTimes.toDbTime(it.getOccurredAtEpochSec(), now));
        e.setSource(it.getSource());
        e.setDedupKey(it.getDedupKey());
        e.setRawType(it.getRawType());
        e.setRawSubtype(it.getRawSubtype());
        e.setBodySnapshot(clip(it.getBodySnapshot(), 512));
        return e;
    }

    private void projectEvent(Long tenantId, ResolvedAccount acc, GroupMemberEvent e, LocalDateTime now) {
        Long tid = tenantId;
        switch (e.getEventType()) {
            case "added", "joined" ->
                stateMapper.applyJoin(tid, acc.accountId(), acc.platform(), e.getChatKey(), e.getMemberKey(),
                    null, e.getOccurredAt(), now);
            case "left" ->
                stateMapper.applyLeave(tid, acc.accountId(), acc.platform(), e.getChatKey(), e.getMemberKey(),
                    "left", e.getOccurredAt(), now);
            case "removed" ->
                stateMapper.applyLeave(tid, acc.accountId(), acc.platform(), e.getChatKey(), e.getMemberKey(),
                    "removed", e.getOccurredAt(), now);
            case "promoted" ->
                stateMapper.applyRole(tid, acc.platform(), acc.accountId(), e.getChatKey(), e.getMemberKey(),
                    "admin", e.getOccurredAt());
            case "demoted" ->
                stateMapper.applyRole(tid, acc.platform(), acc.accountId(), e.getChatKey(), e.getMemberKey(),
                    "member", e.getOccurredAt());
            default -> {
                // 不可达：toEvent 已经把清单外的值挡掉了。
            }
        }
    }

    // -----------------------------------------------------------------------
    // 第 3 步：快照收口
    // -----------------------------------------------------------------------

    private CoverageVerdict reconcileSnapshot(Long tenantId, ResolvedAccount acc,
                                              GroupMemberBatchDTO.SnapshotItem snapshot, LocalDateTime now) {
        if (snapshot == null || isBlank(snapshot.getChatKey()) || snapshot.getParticipants() == null) {
            return new CoverageVerdict(false, null, "no_snapshot");
        }
        List<ParticipantItem> parts = new ArrayList<>();
        Set<String> present = new HashSet<>();
        for (ParticipantItem p : snapshot.getParticipants()) {
            if (p == null || isBlank(p.getMemberKey()) || !present.add(p.getMemberKey())) {
                continue;
            }
            parts.add(p);
        }
        /**
         * 空名单按"没有快照"处理，绝不走成功路径（spec §4 / §6）：
         * 把空名单当成功快照送进判退，会在闸前把整群人判成已退群——一次拉取失败就抹掉一整个群。
         * 宁可记一条缺口，也不要这个后果。
         */
        if (parts.isEmpty() || !isGroupKey(snapshot.getChatKey())) {
            return new CoverageVerdict(false, null, "no_snapshot");
        }
        String chatKey = snapshot.getChatKey();
        ChatGroup group = ensureGroup(tenantId, acc, chatKey, now);

        int prev = group == null || group.getParticipantCount() == null ? 0 : group.getParticipantCount();
        int cur = parts.size();
        boolean firstBuild = prev <= 0;
        Double coverage = firstBuild ? null : (double) cur / prev;
        boolean allowed = firstBuild || coverage >= COVERAGE_MIN;
        String reason = firstBuild ? "first_build" : (allowed ? "ok" : "coverage_too_low");

        // 先把"在场"的人写进去，再看谁不见了——顺序反了会把刚建档的人自己判成退群。
        List<GroupMemberState> before = stateMapper.selectByGroup(tenantId, acc.platform(), acc.accountId(), chatKey);
        for (ParticipantItem p : parts) {
            GroupMemberState e = new GroupMemberState();
            e.setTenantId(tenantId);
            e.setAccountId(acc.accountId());
            e.setPlatform(acc.platform());
            e.setChatKey(chatKey);
            e.setMemberKey(p.getMemberKey());
            e.setPhone(trimToNull(p.getPhone()));
            e.setDisplayName(trimToNull(p.getDisplayName()));
            e.setRoleType(ROLES.contains(p.getRoleType()) ? p.getRoleType() : "member");
            e.setCustomerId(matchCustomer(tenantId, acc.platformType(), p.getMemberKey(), p.getPhone()));
            stateMapper.upsertFromSnapshot(e, now);
        }

        if (allowed) {
            for (GroupMemberState s : before) {
                if (!present.contains(s.getMemberKey()) && s.getIsInGroup() != null && s.getIsInGroup() == 1) {
                    stateMapper.markAbsent(s.getId(), now);
                }
            }
        }

        /**
         * 记账只在闸放行时做（spec §6 陷阱①）。
         *
         * 被闸拦下的那份快照**不配叫成功快照**——它的名单是截断的。拿它的 4 人去覆盖原本 10 人的分母，
         * 下一次快照算出的覆盖率就成了 "人数 / 4"：一个 10 人的群下次回 4 人会得到 1.0，闸从此永久失效。
         * 所以这里必须一起挡住 participant_count、last_snapshot_at 与 snapshot_count 三列：
         * 分母被污染是静默的，界面上一次都看不出来，等发现时群里已经没有可信的退群判定了。
         *
         * 代价是"群真的从 10 人缩到 4 人"这种情形会被一直拦着（每次都 0.4）——
         * 这正是 spec §2#3 明写接受的那条：连续截断会一致地错，本期不解决。
         * 这里选安全而非灵敏：把在群的人误判成已退群，比漏判一次缩员贵得多。
         * last_snapshot_at 不动还有个好处：这个群会留在建档队列靠前的位置，下一轮更早被重试。
         */
        if (allowed) {
            ChatGroup after = groupMapper.selectByKey(tenantId, acc.platform(), acc.accountId(), chatKey);
            if (after != null) {
                groupMapper.markSnapshotSuccess(after.getId(), cur, now);
            }
        }
        return new CoverageVerdict(allowed, coverage, reason);
    }

    // -----------------------------------------------------------------------
    // 客户回填
    // -----------------------------------------------------------------------

    /**
     * 成员 → 客户的匹配：先用 member_key 当 open_id 精确命中，再用手机号兜底。
     * 与消息采集那条规则同形（{@code MessageService.matchCustomer}），不另立一套。
     * 匹配不上返回 null，读侧允许为空——绝不因为匹配不上就拒绝建档。
     */
    private Long matchCustomer(Long tenantId, Integer platformType, String memberKey, String phone) {
        Customer byOpenId = customerMapper.selectOne(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId)
            .eq(Customer::getPlatformType, platformType)
            .eq(Customer::getOpenId, memberKey)
            .last("LIMIT 1"));
        if (byOpenId != null) {
            return byOpenId.getId();
        }
        String fromPhone = phone != null ? ChatKeys.normalizePhone(phone) : null;
        final String target = fromPhone != null ? fromPhone : ChatKeys.peerPhoneOf(memberKey);
        if (target == null) {
            return null;
        }
        return customerMapper.selectList(new LambdaQueryWrapper<Customer>()
                .eq(Customer::getTenantId, tenantId)
                .eq(Customer::getPlatformType, platformType))
            .stream()
            .filter(c -> target.equals(ChatKeys.normalizePhone(c.getPhone())))
            .map(Customer::getId)
            .findFirst()
            .orElse(null);
    }

    // -----------------------------------------------------------------------
    // 小工具
    // -----------------------------------------------------------------------

    private static String dedupOf(String dedupKey, String eventType, String memberKey) {
        return dedupKey + "|" + eventType + "|" + memberKey;
    }

    private static boolean isGroupKey(String chatKey) {
        return chatKey != null && ChatKeys.isGroup(chatKey);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String trimToNull(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        return s.length() > 512 ? s.substring(0, 512) : s;
    }

    private static String clip(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }
}
