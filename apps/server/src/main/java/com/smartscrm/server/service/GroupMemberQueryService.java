package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
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
import com.smartscrm.server.service.msg.SearchPattern;
import com.smartscrm.server.web.vo.GroupEventVO;
import com.smartscrm.server.web.vo.GroupExportRowVO;
import com.smartscrm.server.web.vo.GroupMemberVO;
import com.smartscrm.server.web.vo.GroupVO;
import com.smartscrm.server.web.vo.MemberPageVO;
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

    // -----------------------------------------------------------------------
    // 群列表
    // -----------------------------------------------------------------------

    public PageResult<GroupVO> pageGroups(Long tenantId, Long accountId, String platform,
                                          int page, int size, String sort) {
        Page<ChatGroup> p = new Page<>(Math.max(1, page), Math.min(Math.max(1, size), 200));
        // ⑥：用 QueryWrapper 的字符串列，为的是 sort=stale 那条 ISNULL(...) 表达式——lambda 排序给不出表达式。
        QueryWrapper<ChatGroup> w = new QueryWrapper<ChatGroup>()
            .eq("tenant_id", tenantId).eq("account_id", accountId).eq("platform", platform);
        if ("stale".equals(sort)) {
            // 建档泵那一支（R28 / R41）：没成功快照的最前，其余按上次成功快照从旧到新。
            w.orderByAsc("ISNULL(last_snapshot_at)", "last_snapshot_at", "id");
        } else {
            w.orderByDesc("last_snapshot_at").orderByDesc("id");
        }
        groupMapper.selectPage(p, w);
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
                g.getIsFinal() != null && g.getIsFinal() == 1, g.getLastCoverage(), g.getLastReconcileReason()));
        }
        return PageResult.of(vos, p.getTotal(), p.getCurrent(), p.getSize());
    }

    // -----------------------------------------------------------------------
    // 成员名单
    // -----------------------------------------------------------------------

    /**
     * 成员名单 + 本次快照的新鲜度（③）：一次返回 {@link MemberPageVO}，名单与读数同一份响应。
     * 新鲜度读的是闸写在群行上的两列，coverage 可空就空——不许折成 {@code ""}，也不在这里现场算。
     */
    public MemberPageVO pageMembers(Long tenantId, Long accountId, String platform, String chatKey,
                                    Boolean isInGroup, String role, String q, int page, int size) {
        // ①②：用 QueryWrapper 的字符串列名，为的是那条 ORDER BY——MP 的 lambda 排序给不出 ISNULL(...) 表达式，
        // 而 MySQL 的 ASC 会把 NULL 排在最前，于是"没有进群时间的人"占满第一页——那正是 R36 要消掉的形状。
        QueryWrapper<GroupMemberState> w = new QueryWrapper<GroupMemberState>()
            .eq("tenant_id", tenantId).eq("account_id", accountId)
            .eq("platform", platform).eq("chat_key", chatKey);
        if (isInGroup != null) {
            w.eq("is_in_group", isInGroup ? 1 : 0);
        }
        if (role != null && !role.isBlank()) {
            w.eq("role_type", role);
        }
        if (q != null && !q.isBlank()) {
            // ①：搜索词交给 SearchPattern（返回**已带 %、且把 %/_ 转义过**的模式）。这里必须先分两种 null：
            // q 本就为空 → 跳过整个搜索块查全量；q 非空而 like==null（只由 %/_ 组成）→ 按「不搜」给空名单，
            // 当成"没有过滤条件"就是一次全表扫。写成"like==null 一律返回空名单"会让不带 q 的名单永远空。
            String like = SearchPattern.like(q);
            if (like == null) {
                return new MemberPageVO(PageResult.of(List.<GroupMemberVO>of(), 0L, Math.max(1, page),
                    Math.min(Math.max(1, size), 200)), null, "no_snapshot");
            }
            // MP 的 like() 会把参数再包一层 %，与 SearchPattern 已包的那一层叠成 %%…%%（搜 % 变搜全表）；
            // 所以走 apply("col LIKE {0}", like)，让已转义的模式原样进绑定值。{0} 是 MP 的占位，不是 ?。
            w.and(x -> x.apply("display_name LIKE {0}", like)
                .or().apply("phone LIKE {0}", like)
                .or().apply("member_key LIKE {0}", like));
        }
        w.orderByAsc("ISNULL(latest_join_at)", "latest_join_at", "first_seen_at", "id");

        Page<GroupMemberState> p = new Page<>(Math.max(1, page), Math.min(Math.max(1, size), 200));
        stateMapper.selectPage(p, w);
        List<GroupMemberVO> vos = toMemberVOs(tenantId, chatKey, p.getRecords());

        ChatGroup g = groupMapper.selectByKey(tenantId, platform, accountId, chatKey);
        // ③：新鲜度读闸落下来的那两列，不在这里现场算——现场算用的是当前这一页的在群数，翻页会给出
        // 不同的 coverage，而 §8 那句"本次未做退群判定"必须只有一个答案。
        Double coverage = g == null ? null : g.getLastCoverage();
        String reason = (g == null || g.getLastReconcileReason() == null)
            ? "no_snapshot" : g.getLastReconcileReason();
        return new MemberPageVO(PageResult.of(vos, p.getTotal(), p.getCurrent(), p.getSize()), coverage, reason);
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
    public List<GroupVO> customerGroups(Long tenantId, Long accountId, String platform, Long customerId) {
        Customer customer = customerMapper.selectById(customerId);
        if (customer == null || !tenantId.equals(customer.getTenantId())) {
            throw new BizException(40404, "客户不存在: " + customerId);
        }
        String phone = ChatKeys.normalizePhone(customer.getPhone());
        // ④：accountId 是账号收窄的那一维（R16 / spec §9 不许跨账号混读），两路查询都按 (platform, account_id) 过滤。
        LambdaQueryWrapper<GroupMemberState> w = new LambdaQueryWrapper<GroupMemberState>()
            .eq(GroupMemberState::getTenantId, tenantId)
            .eq(GroupMemberState::getAccountId, accountId)
            .eq(GroupMemberState::getPlatform, platform)
            .eq(GroupMemberState::getCustomerId, customerId);
        List<GroupMemberState> byCustomer = stateMapper.selectList(w);

        List<GroupMemberState> all = new ArrayList<>(byCustomer);
        if (phone != null) {
            LambdaQueryWrapper<GroupMemberState> phoneW = new LambdaQueryWrapper<GroupMemberState>()
                .eq(GroupMemberState::getTenantId, tenantId)
                .eq(GroupMemberState::getAccountId, accountId)
                .eq(GroupMemberState::getPlatform, platform)
                .eq(GroupMemberState::getPhone, phone);
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
                g.getIsFinal() != null && g.getIsFinal() == 1, g.getLastCoverage(), g.getLastReconcileReason()));
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // 导出
    // -----------------------------------------------------------------------

    /**
     * 导出取数（spec §10）。行序钉死：群按 {@code chatKeys} 的传入顺序，
     * 群内按 {@code latest_join_at} 升序、为空的排到该群末尾并按 {@code first_seen_at} 升序，
     * 最后按 {@code id} 定全序——与 {@link #pageMembers} 那条 ORDER BY 同一份行序，名单与导出不许分叉；
     * {@code seq} 是整份文件内连续序号，跨群不重置。
     */
    public List<GroupExportRowVO> exportRows(Long tenantId, Long accountId, String platform, List<String> chatKeys) {
        if (chatKeys == null || chatKeys.isEmpty()) {
            throw new BizException(40000, "chatKeys 不能为空");
        }
        // ⑤：先去重（R40）再剔非群键再计数——拦的是工作量，重复勾选不该被计成两拨活。
        List<String> keys = new ArrayList<>(new LinkedHashSet<>(chatKeys));
        keys.removeIf(k -> k == null || k.isBlank() || !ChatKeys.isGroup(k));
        if (keys.isEmpty()) {
            throw new BizException(40000, "chatKeys 里没有一个是群键");
        }
        if (keys.size() > MAX_EXPORT_GROUPS) {
            // 40016 而不是 40000：界面要能把"选太多"与"参数不对"分成两句文案说，
            // 前者的下一步是少勾两个群，后者的下一步是看请求怎么拼的。
            throw new BizException(40016, "一次最多导出 " + MAX_EXPORT_GROUPS + " 个群，当前 " + keys.size());
        }
        List<GroupExportRowVO> out = new ArrayList<>();
        int seq = 1;
        for (String chatKey : keys) {   // 行序：入参顺序 = 去重后保留的首次出现顺序；seq 只由这一段写（R22）
            ChatGroup g = groupMapper.selectByKey(tenantId, platform, accountId, chatKey);
            String groupName = g == null ? null : g.getTitle();
            // 取可变副本再原地排：mapper 给回的列表不保证可 sort（MyBatis 平时给 ArrayList，但只读实现会拒绝）。
            // 行序与 pageMembers 那条 ORDER BY 逐键同口径（②：名单与导出是同一份行序）——
            // ISNULL(latest_join_at) 让空值沉到本群末尾、再 latest_join_at、再 first_seen_at，
            // 最后以 id 定全序：少了那一键，同进群时间、同首次见到时间的两个人在两条路上次序可以不同。
            List<GroupMemberState> rows = new ArrayList<>(stateMapper.selectByGroup(tenantId, platform, accountId, chatKey));
            rows.sort(Comparator
                .comparing(GroupMemberState::getLatestJoinAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(GroupMemberState::getFirstSeenAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(GroupMemberState::getId, Comparator.nullsLast(Comparator.naturalOrder())));
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
