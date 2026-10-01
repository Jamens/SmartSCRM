package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.ChatGroup;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.GroupMemberEvent;
import com.smartscrm.server.entity.GroupMemberState;
import com.smartscrm.server.mapper.ChatGroupMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.GroupMemberEventMapper;
import com.smartscrm.server.mapper.GroupMemberStateMapper;
import com.smartscrm.server.service.msg.ChatKeys;
import com.smartscrm.server.web.vo.GroupEventVO;
import com.smartscrm.server.web.vo.GroupExportRowVO;
import com.smartscrm.server.web.vo.GroupMemberVO;
import com.smartscrm.server.web.vo.GroupVO;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * 群成员的读侧（spec §7）。与 {@link GroupMemberService} 分开：写侧的形状是"一次上报走三步"，
 * 读侧的形状是"四个列表 + 一份导出"，两者没有共用逻辑，混在一起会让 ingest 那三条闸的边界变模糊。
 */
@Service
public class GroupMemberQueryService {

    /** 一次导出的群数上限（spec §10；与 shared 的 MAX_EXPORT_GROUPS 同一个数）。 */
    private static final int MAX_EXPORT_GROUPS = 50;

    private final ChatGroupMapper groupMapper;
    private final GroupMemberStateMapper stateMapper;
    private final GroupMemberEventMapper eventMapper;
    private final ChatMessageMapper messageMapper;
    private final CustomerMapper customerMapper;

    public GroupMemberQueryService(ChatGroupMapper groupMapper, GroupMemberStateMapper stateMapper,
                                   GroupMemberEventMapper eventMapper, ChatMessageMapper messageMapper,
                                   CustomerMapper customerMapper) {
        this.groupMapper = groupMapper;
        this.stateMapper = stateMapper;
        this.eventMapper = eventMapper;
        this.messageMapper = messageMapper;
        this.customerMapper = customerMapper;
    }

    /** 成员名单 + 本次快照的新鲜度。{@code coverage}/{@code reason} 来自最近一次 ingest 的判定。 */
    public record MemberPage(PageResult<GroupMemberVO> page, Double coverage, String reason) {}

    // -----------------------------------------------------------------------
    // 群列表
    // -----------------------------------------------------------------------

    public PageResult<GroupVO> pageGroups(Long tenantId, Long accountId, String platform, int page, int size) {
        Page<ChatGroup> p = new Page<>(Math.max(1, page), Math.min(Math.max(1, size), 200));
        groupMapper.selectPage(p, new LambdaQueryWrapper<ChatGroup>()
            .eq(ChatGroup::getTenantId, tenantId)
            .eq(ChatGroup::getAccountId, accountId)
            .eq(ChatGroup::getPlatform, platform)
            .orderByDesc(ChatGroup::getLastSnapshotAt)
            .orderByDesc(ChatGroup::getId));
        List<ChatGroup> rows = p.getRecords();
        if (rows.isEmpty()) {
            return PageResult.of(List.<GroupVO>of(), p.getTotal(), p.getCurrent(), p.getSize());
        }
        List<String> keys = rows.stream().map(ChatGroup::getChatKey).toList();
        Map<String, Map<String, Object>> agg = new HashMap<>();
        for (Map<String, Object> r : stateMapper.aggregateByGroups(tenantId, platform, accountId, keys)) {
            agg.put(String.valueOf(r.get("chatKey")), r);
        }
        List<GroupVO> vos = new ArrayList<>();
        for (ChatGroup g : rows) {
            Map<String, Object> a = agg.get(g.getChatKey());
            vos.add(new GroupVO(g.getChatKey(), g.getTitle(), g.getPlatform(), g.getParticipantCount(),
                g.getSnapshotCount(), toInt(a == null ? null : a.get("inGroupCount")),
                g.getLastSnapshotAt(), toTime(a == null ? null : a.get("lastEventAt")),
                g.getIsFinal() != null && g.getIsFinal() == 1));
        }
        return PageResult.of(vos, p.getTotal(), p.getCurrent(), p.getSize());
    }

    // -----------------------------------------------------------------------
    // 成员名单
    // -----------------------------------------------------------------------

    public MemberPage pageMembers(Long tenantId, Long accountId, String platform, String chatKey,
                                 Boolean isInGroup, String role, String q, int page, int size) {
        LambdaQueryWrapper<GroupMemberState> w = new LambdaQueryWrapper<GroupMemberState>()
            .eq(GroupMemberState::getTenantId, tenantId)
            .eq(GroupMemberState::getAccountId, accountId)
            .eq(GroupMemberState::getPlatform, platform)
            .eq(GroupMemberState::getChatKey, chatKey);
        if (isInGroup != null) {
            w.eq(GroupMemberState::getIsInGroup, isInGroup ? 1 : 0);
        }
        if (role != null && !role.isBlank()) {
            w.eq(GroupMemberState::getRoleType, role);
        }
        if (q != null && !q.isBlank()) {
            String like = "%" + q.trim() + "%";
            w.and(x -> x.like(GroupMemberState::getDisplayName, like)
                .or().like(GroupMemberState::getPhone, like)
                .or().like(GroupMemberState::getMemberKey, like));
        }
        // 排序与导出同一口径：先进群的在前，没有进群时间的排后面按"首次见到"排。
        w.orderByAsc(GroupMemberState::getLatestJoinAt).orderByAsc(GroupMemberState::getFirstSeenAt);

        Page<GroupMemberState> p = new Page<>(Math.max(1, page), Math.min(Math.max(1, size), 200));
        stateMapper.selectPage(p, w);
        List<GroupMemberVO> vos = toMemberVOs(tenantId, chatKey, p.getRecords());

        ChatGroup g = groupMapper.selectByKey(tenantId, platform, accountId, chatKey);
        // 新鲜度按当前状态推：没建过档就是 first_build，否则用"在场人数 / 上次成功快照人数"。
        Double coverage = null;
        String reason = "no_snapshot";
        if (g != null && g.getParticipantCount() != null && g.getParticipantCount() > 0) {
            int inGroup = (int) vos.stream().filter(GroupMemberVO::isInGroup).count();
            coverage = (double) inGroup / g.getParticipantCount();
            reason = coverage >= 0.6 ? "ok" : "coverage_too_low";
        } else if (g != null && g.getSnapshotCount() != null && g.getSnapshotCount() > 0) {
            reason = "first_build";
        }
        return new MemberPage(PageResult.of(vos, p.getTotal(), p.getCurrent(), p.getSize()), coverage, reason);
    }

    private List<GroupMemberVO> toMemberVOs(Long tenantId, String chatKey, List<GroupMemberState> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        List<String> senders = rows.stream().map(GroupMemberState::getMemberKey).distinct().toList();
        Map<String, Map<String, Object>> stats = new HashMap<>();
        for (Map<String, Object> r : messageMapper.statsBySenders(tenantId, chatKey, senders)) {
            stats.put(String.valueOf(r.get("senderKey")), r);
        }
        List<GroupMemberVO> out = new ArrayList<>();
        for (GroupMemberState s : rows) {
            Map<String, Object> st = stats.get(s.getMemberKey());
            out.add(new GroupMemberVO(s.getChatKey(), s.getMemberKey(), s.getPhone(), s.getDisplayName(),
                s.getRoleType(), s.getIsInGroup() != null && s.getIsInGroup() == 1, s.getJoinCount(),
                s.getLatestJoinAt(), s.getLatestLeaveAt(), s.getExitMethod(), s.getFirstSeenAt(),
                s.getLastEventAt(), s.getSnapshotSeenCount(), s.getCustomerId(),
                toTime(st == null ? null : st.get("lastMsgAt")),
                toLong(st == null ? null : st.get("dayMsgCount")),
                toLong(st == null ? null : st.get("msgCount"))));
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // 进退流水
    // -----------------------------------------------------------------------

    public PageResult<GroupEventVO> pageEvents(Long tenantId, Long accountId, String platform, String chatKey,
                                              String eventType, int page, int size) {
        LambdaQueryWrapper<GroupMemberEvent> w = new LambdaQueryWrapper<GroupMemberEvent>()
            .eq(GroupMemberEvent::getTenantId, tenantId)
            .eq(GroupMemberEvent::getAccountId, accountId)
            .eq(GroupMemberEvent::getPlatform, platform)
            .eq(GroupMemberEvent::getChatKey, chatKey);
        if (eventType != null && !eventType.isBlank()) {
            w.eq(GroupMemberEvent::getEventType, eventType);
        }
        w.orderByDesc(GroupMemberEvent::getOccurredAt).orderByDesc(GroupMemberEvent::getId);

        Page<GroupMemberEvent> p = new Page<>(Math.max(1, page), Math.min(Math.max(1, size), 200));
        eventMapper.selectPage(p, w);
        List<GroupEventVO> vos = new ArrayList<>();
        for (GroupMemberEvent e : p.getRecords()) {
            vos.add(new GroupEventVO(e.getId(), e.getChatKey(), e.getGroupTitle(), e.getMemberKey(),
                e.getActorKey(), e.getActorName(), e.getEventType(), e.getOccurredAt(), e.getSource(),
                e.getRawType(), e.getRawSubtype(), e.getBodySnapshot()));
        }
        return PageResult.of(vos, p.getTotal(), p.getCurrent(), p.getSize());
    }

    // -----------------------------------------------------------------------
    // 按客户反查所在群
    // -----------------------------------------------------------------------

    /**
     * 客户的所在群（spec §9 客户抽屉那一节的数据源）。
     *
     * 匹配用两路：已经回填的 {@code customer_id}，以及手机号相等（客户手机号改过、成员行还没回填时靠它）。
     * 两路都不是精确外键——客户与成员之间没有外键关系，所以这里是"尽力匹配"，匹配不上就是没有。
     */
    public List<GroupVO> customerGroups(Long tenantId, Long accountId, Long customerId) {
        Customer customer = customerMapper.selectById(customerId);
        if (customer == null || !tenantId.equals(customer.getTenantId())) {
            throw new BizException(40404, "客户不存在: " + customerId);
        }
        String phone = ChatKeys.normalizePhone(customer.getPhone());
        // 8b：accountId 是账号收窄的那一维（R16/R40 不许跨账号混读）。传 null 时退化为旧行为（匹配该客户全部账号的群）。
        LambdaQueryWrapper<GroupMemberState> w = new LambdaQueryWrapper<GroupMemberState>()
            .eq(GroupMemberState::getTenantId, tenantId)
            .eq(GroupMemberState::getCustomerId, customerId);
        if (accountId != null) {
            w.eq(GroupMemberState::getAccountId, accountId);
        }
        List<GroupMemberState> byCustomer = stateMapper.selectList(w);

        List<GroupMemberState> all = new ArrayList<>(byCustomer);
        if (phone != null) {
            LambdaQueryWrapper<GroupMemberState> phoneW = new LambdaQueryWrapper<GroupMemberState>()
                .eq(GroupMemberState::getTenantId, tenantId)
                .eq(GroupMemberState::getPhone, phone);
            if (accountId != null) {
                phoneW.eq(GroupMemberState::getAccountId, accountId);
            }
            List<GroupMemberState> byPhone = stateMapper.selectList(phoneW);
            Set<Long> seen = new java.util.HashSet<>();
            for (GroupMemberState s : all) {
                seen.add(s.getId());
            }
            for (GroupMemberState s : byPhone) {
                if (seen.add(s.getId())) {
                    all.add(s);
                }
            }
        }
        // 群按账号分组后查登记册：不同账号下的同名群是两回事。
        Set<String> keys = new LinkedHashSet<>();
        for (GroupMemberState s : all) {
            keys.add(s.getPlatform() + "|" + s.getAccountId() + "|" + s.getChatKey());
        }
        List<GroupVO> out = new ArrayList<>();
        for (String k : keys) {
            String[] parts = k.split("\\|", 3);
            ChatGroup g = groupMapper.selectByKey(tenantId, parts[0], Long.valueOf(parts[1]), parts[2]);
            if (g == null) {
                continue;
            }
            List<Map<String, Object>> agg = stateMapper.aggregateByGroups(tenantId, parts[0],
                Long.valueOf(parts[1]), List.of(parts[2]));
            Map<String, Object> a = agg.isEmpty() ? null : agg.get(0);
            out.add(new GroupVO(g.getChatKey(), g.getTitle(), g.getPlatform(), g.getParticipantCount(),
                g.getSnapshotCount(), toInt(a == null ? null : a.get("inGroupCount")),
                g.getLastSnapshotAt(), toTime(a == null ? null : a.get("lastEventAt")),
                g.getIsFinal() != null && g.getIsFinal() == 1));
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // 导出
    // -----------------------------------------------------------------------

    /**
     * 导出取数（spec §10）。行序钉死：群按 {@code chatKeys} 的传入顺序，
     * 群内按 {@code latest_join_at} 升序、为空的排到该群末尾并按 {@code first_seen_at} 升序；
     * {@code seq} 是整份文件内连续序号，跨群不重置。
     */
    public List<GroupExportRowVO> exportRows(Long tenantId, Long accountId, String platform, List<String> chatKeys) {
        if (chatKeys == null || chatKeys.isEmpty()) {
            throw new BizException(40000, "chatKeys 不能为空");
        }
        if (chatKeys.size() > MAX_EXPORT_GROUPS) {
            throw new BizException(40000, "一次最多导出 " + MAX_EXPORT_GROUPS + " 个群，当前 " + chatKeys.size());
        }
        List<GroupExportRowVO> out = new ArrayList<>();
        int seq = 1;
        for (String chatKey : chatKeys) {
            ChatGroup g = groupMapper.selectByKey(tenantId, platform, accountId, chatKey);
            String groupName = g == null ? null : g.getTitle();
            List<GroupMemberState> rows = stateMapper.selectByGroup(tenantId, platform, accountId, chatKey);
            rows.sort(Comparator
                .comparing(GroupMemberState::getLatestJoinAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(GroupMemberState::getFirstSeenAt, Comparator.nullsLast(Comparator.naturalOrder())));
            for (GroupMemberVO v : toMemberVOs(tenantId, chatKey, rows)) {
                out.add(new GroupExportRowVO(seq++, groupName, chatKey, v.phone(),
                    v.displayName(), v.roleType(), v.isInGroup() ? "是" : "否", v.latestJoinAt(),
                    v.joinCount(), v.latestLeaveAt(), v.exitMethod(), v.lastMsgAt(),
                    v.dayMsgCount(), v.msgCount()));
            }
        }
        return out;
    }

    // -----------------------------------------------------------------------

    private static Integer toInt(Object v) {
        if (v == null) {
            return null;
        }
        return v instanceof Number n ? n.intValue() : Integer.parseInt(String.valueOf(v));
    }

    private static Long toLong(Object v) {
        if (v == null) {
            return null;
        }
        return v instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(v));
    }

    private static LocalDateTime toTime(Object v) {
        return v instanceof LocalDateTime t ? t : null;
    }
}
