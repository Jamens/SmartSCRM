package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.ChatGroup;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.GroupMemberEvent;
import com.smartscrm.server.entity.GroupMemberState;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.ChatGroupMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.GroupMemberEventMapper;
import com.smartscrm.server.mapper.GroupMemberStateMapper;
import com.smartscrm.server.web.vo.GroupExportRowVO;
import com.smartscrm.server.web.vo.GroupVO;
import com.smartscrm.server.web.vo.MemberPageVO;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * 群成员读侧（{@code 3771927} 那一层）八条校准中的六条：① 搜索走 SearchPattern 转义、② 名单行序 ISNULL 沉底、
 * ③ 新鲜度只读群行上落库的两列、④ 客户反查按账号收窄、⑤ 导出去重早于计数 + 群键形态 + 行序与名单同一份、
 * ⑥ pageGroups 的 sort=stale。全部打在 mock 掉的 mapper 上，形状照 {@link BatchSendServiceTest}。
 *
 * 这一份**只**证明 Java 这边把 ISNULL 放在了裸列前、把转义后的模式交给了 LIKE，不证明真 MySQL 按该序出行——
 * 那是 Task 14 契约腿的活。
 *
 * ③ 分两半，各在一份文件里：读侧（{@code pageMembers} 只读 {@code chat_group} 那两列、翻页不改口）
 * 由本文件的 {@code memberPageReadsThePersistedGateColumnsInsteadOfRecomputingThem} 守；
 * 写侧（放行时 {@code markSnapshotSuccess} 一次写五列、被拦时 {@code markGate} 只写读数，
 * 纯事件批次两种都不写）由 {@link GroupMemberWriteCalibrationTest} 的三条闸测试守——那份从不调
 * {@code pageMembers}，所以读侧这一格只能在这里钉。
 */
class GroupMemberReadCalibrationTest {

    private static final long TENANT = 1L;
    private static final long ACCOUNT = 9L;
    private static final String GROUP = "120363111@g.us";
    private static final String MEMBER = "8613800000000@c.us";

    private final ChatGroupMapper groupMapper = mock(ChatGroupMapper.class);
    private final GroupMemberStateMapper stateMapper = mock(GroupMemberStateMapper.class);
    private final GroupMemberEventMapper eventMapper = mock(GroupMemberEventMapper.class);
    private final ChatMessageMapper messageMapper = mock(ChatMessageMapper.class);
    private final CustomerMapper customerMapper = mock(CustomerMapper.class);
    private final GroupMemberQueryService query = new GroupMemberQueryService(
        groupMapper, stateMapper, eventMapper, messageMapper, customerMapper);

    @BeforeAll
    static void installLambdaColumnCache() {
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(new MybatisConfiguration(), "");
        TableInfoHelper.initTableInfo(assistant, ChatGroup.class);
        TableInfoHelper.initTableInfo(assistant, GroupMemberState.class);
        TableInfoHelper.initTableInfo(assistant, GroupMemberEvent.class);
        TableInfoHelper.initTableInfo(assistant, PlatformAccount.class);
        TableInfoHelper.initTableInfo(assistant, Customer.class);
    }

    /** ① / ②：搜索词交给 SearchPattern，绑定值里必须已经带好反斜杠转义；名单排序必须 ISNULL 打头。 */
    @Test
    void memberSearchUsesEscapedPatternAndNullSinkingOrder() {
        when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(null);
        when(messageMapper.statsBySenders(any(), any(), any())).thenReturn(List.of());
        ArgumentCaptor<QueryWrapper<GroupMemberState>> cap = ArgumentCaptor.forClass(QueryWrapper.class);
        when(stateMapper.selectPage(any(), cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        query.pageMembers(TENANT, ACCOUNT, "whatsapp", GROUP, null, null, "a%b", 1, 50);

        String seg = cap.getValue().getSqlSegment();
        assertTrue(seg.contains("display_name LIKE"), seg);
        assertTrue(cap.getValue().getParamNameValuePairs().containsValue("%a\\%b%"),
            String.valueOf(cap.getValue().getParamNameValuePairs()));
        int first = seg.indexOf("latest_join_at");
        assertTrue(first > 0 && seg.regionMatches(first - 7, "ISNULL(", 0, 7),
            "ORDER BY 里裸列排在 ISNULL 之前，NULL 会占满第一页: " + seg);
        assertTrue(seg.indexOf("latest_join_at", first + 1) > first, "裸列没出现: " + seg);
        for (String col : List.of("tenant_id", "account_id", "platform", "chat_key")) {
            assertTrue(seg.contains(col), "WHERE 段缺列 " + col + ": " + seg);
        }
    }

    /**
     * ① 的坑（技术要点 Step 7 ①）：q 为空与 q 只由通配符组成会在 like==null 上撞车。
     * q=null 必须走全量查询（发 selectPage），写成"like==null 就返回空名单"会让不带 q 的名单永远空。
     */
    @Test
    void nullQueryStillSearchesEverythingAndHitsDb() {
        when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(null);
        when(messageMapper.statsBySenders(any(), any(), any())).thenReturn(List.of());
        when(stateMapper.selectPage(any(), any())).thenAnswer(inv -> inv.getArgument(0));

        query.pageMembers(TENANT, ACCOUNT, "whatsapp", GROUP, null, null, null, 1, 50);

        verify(stateMapper).selectPage(any(), any());
    }

    /** ①：只由通配符组成的词按「不搜」处理，而且**不发查询**——当成"没有过滤条件"就是一次全表扫。 */
    @Test
    void wildcardOnlyQuerySearchesNothingAndDoesNotHitDb() {
        query.pageMembers(TENANT, ACCOUNT, "whatsapp", GROUP, null, null, "%%", 1, 50);
        verify(stateMapper, never()).selectPage(any(), any());
    }

    /**
     * ③ 的读侧哨兵：{@code pageMembers} 的新鲜度必须读群行上落库的那两列，不拿**当前这一页**的在群人数现场算。
     * 群行存的是 {@code last_coverage = 0.9333 / reason = "ok"}，而这一页两个人都不在群——
     * 现场算会给出 {@code 0.0 / "coverage_too_low"}，那是"翻页就变数"的那个缺陷形状（§8 那句
     * "本次未做退群判定"必须只有一个答案）。
     * 把 {@code GroupMemberQueryService.pageMembers} 末尾那三行读数换回「按本页 inGroup 数除分母」，这条就红。
     */
    @Test
    void memberPageReadsThePersistedGateColumnsInsteadOfRecomputingThem() {
        ChatGroup g = new ChatGroup();
        g.setId(3L);
        g.setParticipantCount(10);                    // 现场算的分母：本页 0 人在群 → 0.0
        g.setLastCoverage(0.9333);
        g.setLastReconcileReason("ok");
        when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(g);
        GroupMemberState left = row(21L, "8613800000021@c.us", "丙");
        GroupMemberState alsoLeft = row(22L, "8613800000022@c.us", "丁");
        left.setIsInGroup(0);
        alsoLeft.setIsInGroup(0);
        when(stateMapper.selectPage(any(), any())).thenAnswer(inv -> {
            Page<GroupMemberState> p = inv.getArgument(0);
            p.setRecords(List.of(left, alsoLeft));
            p.setTotal(2);
            return p;
        });
        when(messageMapper.statsBySenders(any(), any(), any())).thenReturn(List.of());

        MemberPageVO page = query.pageMembers(TENANT, ACCOUNT, "whatsapp", GROUP, null, null, null, 1, 50);

        assertEquals(0.9333, page.coverage(), 1e-9, "coverage 不是群行上存着的那个数 ⇒ 读侧还在现场算");
        assertEquals("ok", page.reason(), "reason 不是群行上存着那个结论 ⇒ 读侧还在现场算");
    }

    /** ④：另一个账号下的成员行不能混进这个客户的所在群。 */
    @Test
    void customerGroupsAreScopedToTheAccount() {
        Customer c = new Customer();
        c.setId(1L);
        c.setTenantId(TENANT);
        c.setPhone("8613800000000");
        when(customerMapper.selectById(1L)).thenReturn(c);
        ArgumentCaptor<LambdaQueryWrapper<GroupMemberState>> cap = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        when(stateMapper.selectList(cap.capture())).thenReturn(List.of());

        query.customerGroups(TENANT, ACCOUNT, "whatsapp", 1L);

        // 两路反查（按 customer_id、按 phone）都得发，且都得带上收窄的那几列——
        // 少发一条意味着某一路不再按账号收窄，测试却照样绿，所以先数 wrapper 的条数。
        assertEquals(2, cap.getAllValues().size(),
            () -> "客户反查应该是两路各一次查询，实际抓到 " + cap.getAllValues().size() + " 条");
        LambdaQueryWrapper<GroupMemberState> byCustomer = cap.getAllValues().get(0);
        LambdaQueryWrapper<GroupMemberState> byPhone = cap.getAllValues().get(1);
        for (LambdaQueryWrapper<GroupMemberState> w : cap.getAllValues()) {
            String seg = w.getSqlSegment();
            for (String col : List.of("tenant_id", "account_id", "platform")) {
                assertTrue(seg.contains(col), "收窄缺列 " + col + ": " + seg);
            }
            // 收窄只由「租户 + 账号 + 平台 + 各自的匹配列」四条件构成：冒出第五个条件就不是这一句要说的收窄了。
            assertEquals(4, w.getParamNameValuePairs().size(),
                () -> "条件数多于标题所声称的四个: " + seg + " " + w.getParamNameValuePairs());
            // 断的是**这一账号的值**真的进了条件，不是"存在一个叫 account_id 的条件"。
            assertTrue(w.getParamNameValuePairs().containsValue(ACCOUNT),
                () -> "account_id 的值不是这个账号: " + w.getParamNameValuePairs());
            assertTrue(w.getParamNameValuePairs().containsValue("whatsapp"),
                () -> "platform 的值不是这个平台: " + w.getParamNameValuePairs());
        }
        assertTrue(byCustomer.getSqlSegment().contains("customer_id"), byCustomer.getSqlSegment());
        assertTrue(byCustomer.getParamNameValuePairs().containsValue(1L),
            () -> "按 customer_id 那一路没带上被查的客户: " + byCustomer.getParamNameValuePairs());
        assertTrue(byPhone.getSqlSegment().contains("phone"), byPhone.getSqlSegment());
        assertTrue(byPhone.getParamNameValuePairs().containsValue("8613800000000"),
            () -> "按号码那一路没带上归一后的号码: " + byPhone.getParamNameValuePairs());
    }

    /** ⑤：同一群勾两遍不许出一遍成员，也不许绕过 50 群上限（拦的是工作量）。 */
    @Test
    void exportDeduplicatesKeysBeforeCounting() {
        // 50 个互不相同的键 + 1 个重复 = 51 条入参；去重后正好 50：必须放行（旧实现按 51 条计会被拦）。
        List<String> keys = new ArrayList<>();
        for (int i = 0; i < 50; i++) keys.add("12036311" + i + "@g.us");
        keys.add(keys.get(0));                       // 重复一次 → 去重后正好 50：必须放行
        when(groupMapper.selectByKey(any(), any(), any(), any())).thenReturn(null);
        when(stateMapper.selectByGroup(any(), any(), any(), any())).thenReturn(List.of());
        when(messageMapper.statsBySenders(any(), any(), any())).thenReturn(List.of());

        assertDoesNotThrow(() -> query.exportRows(TENANT, ACCOUNT, "whatsapp", keys));

        // 51 个**互不相同**的键才该被 40016 拦下
        keys.add("120363999@g.us");
        BizException bx = assertThrows(BizException.class,
            () -> query.exportRows(TENANT, ACCOUNT, "whatsapp", keys));
        assertEquals(40016, bx.getCode());           // 不是 40000：界面要能分清"选太多"和"参数不对"
    }

    /** ⑤：非群键（有人拿单聊键来导）不进 IN，剔空了要响。 */
    @Test
    void exportRejectsNonGroupKeys() {
        BizException bx = assertThrows(BizException.class, () -> query.exportRows(
            TENANT, ACCOUNT, "whatsapp", List.of("8613800000000@c.us")));
        assertEquals(40000, bx.getCode());
        verify(stateMapper, never()).selectByGroup(any(), any(), any(), any());
    }

    /** ⑥：sort=stale 那一路未建档（last_snapshot_at IS NULL）排最前；默认那一路仍是新的在前。 */
    @Test
    void staleSortPutsNeverSnapshottedGroupsFirst() {
        ArgumentCaptor<QueryWrapper<ChatGroup>> cap = ArgumentCaptor.forClass(QueryWrapper.class);
        when(groupMapper.selectPage(any(), cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        query.pageGroups(TENANT, ACCOUNT, "whatsapp", 1, 200, "stale");

        String seg = cap.getValue().getSqlSegment();
        int first = seg.indexOf("last_snapshot_at");
        assertTrue(first > 0 && seg.regionMatches(first - 7, "ISNULL(", 0, 7),
            "未建档的群没排在最前: " + seg);
        assertTrue(seg.indexOf("last_snapshot_at", first + 1) > first, "裸列没出现在 ISNULL 之后: " + seg);
        // 换成字符串列名丢了 lambda 的类型安全，列名拼错只能在这里响：WHERE 段的列逐个要是 snake_case。
        for (String col : List.of("tenant_id", "account_id", "platform")) {
            assertTrue(seg.contains(col), "WHERE 段缺列 " + col + ": " + seg);
        }

        query.pageGroups(TENANT, ACCOUNT, "whatsapp", 1, 200, null);
        String defSeg = cap.getAllValues().get(1).getSqlSegment();
        assertFalse(defSeg.contains("ISNULL("), "默认顺序被顺手改成了旧→新");
        int d = defSeg.indexOf("last_snapshot_at");
        assertTrue(d > 0, "默认分支根本没有上次快照时间这一列: " + defSeg);
        // 「新的在前」= 这一列排 DESC；只断"没有 ISNULL"的话，把它改成 orderByAsc 也不会红。
        // 比的是列名之后紧跟的那五个字符，不写整串（MP 小版本会在列名后追加方向词，整串是版本相关字面量）。
        assertTrue(defSeg.regionMatches(d + "last_snapshot_at".length(), " DESC", 0, 5),
            "默认顺序不是新的在前: " + defSeg);
        for (String col : List.of("tenant_id", "account_id", "platform")) {
            assertTrue(defSeg.contains(col), "默认分支的 WHERE 段缺列 " + col + ": " + defSeg);
        }
    }

    /**
     * ③ 落在群行上的两个新键（{@code GroupVO.lastCoverage} / {@code lastReconcileReason}）此前没有任何测试跑到：
     * 两条 pageGroups 的既有测试都在空记录上早返回。这里让两行**非空**的群流过 pageGroups——
     * 一行有读数，一行没做过判定。后者钉的是 ③ 要消掉的那一类缺陷本身：空值必须以 null 出线，
     * 折成 0.0 或 "" 都会让界面分不清「没做过判定」和「判定结论是空」。
     */
    @Test
    void groupListRowCarriesTheTwoGateColumnsAndTheirNulls() {
        ChatGroup judged = group(3L, GROUP, 0.9333, "ok");
        ChatGroup untouched = group(4L, "120363222@g.us", null, null);
        when(groupMapper.selectPage(any(), any())).thenAnswer(inv -> {
            Page<ChatGroup> p = inv.getArgument(0);
            p.setRecords(List.of(judged, untouched));
            p.setTotal(2);
            return p;
        });
        when(stateMapper.aggregateByGroups(any(), any(), any(), any())).thenReturn(List.of());

        PageResult<GroupVO> res = query.pageGroups(TENANT, ACCOUNT, "whatsapp", 1, 200, "stale");

        assertEquals(2, res.records().size(), "非空群行没流到 VO: " + res);
        GroupVO first = res.records().get(0);
        assertEquals(0.9333, first.lastCoverage(), 1e-9, "群列表没把闸读数带出来");
        assertEquals("ok", first.lastReconcileReason());
        GroupVO second = res.records().get(1);
        assertNull(second.lastCoverage(), () -> "没判过定的群给的是 0.0 而不是 null: " + second.lastCoverage());
        assertNull(second.lastReconcileReason(),
            () -> "没判过定的群给的是空串而不是 null: " + second.lastReconcileReason());
    }

    /**
     * ② 的第二半：名单与导出必须是**同一份**行序。DB 那条由 `id` 定全序
     * （`ISNULL(latest_join_at), latest_join_at, first_seen_at, id`），导出那条比较器只到
     * `first_seen_at`——同进群时间、同首次见到时间的两个人，两条路上次序可以不同，
     * 于是「导出的一份」和「界面上翻页看到的」不是同一份人。
     * 这里造两个时间完全相同、只有 id 不同的人，且 mapper 给的顺序与 id 顺序**相反**：
     * 稳定排序在没有决胜键时会原样保留这个反序，所以少了 `id` 这一键就红。
     */
    @Test
    void exportRowOrderTiesOnIdExactlyLikeTheMemberList() {
        when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(null);
        when(stateMapper.selectByGroup(TENANT, "whatsapp", ACCOUNT, GROUP))
            .thenReturn(new ArrayList<>(List.of(row(12L, "8613800000012@c.us", "乙"),
                row(11L, "8613800000011@c.us", "甲"))));
        when(messageMapper.statsBySenders(any(), any(), any())).thenReturn(List.of());

        List<GroupExportRowVO> out = query.exportRows(TENANT, ACCOUNT, "whatsapp", List.of(GROUP));

        assertEquals(2, out.size());
        assertEquals("甲", out.get(0).name(), "id 小的人没排在前面 ⇒ 导出行序与名单不是同一份: " + out);
        assertEquals("乙", out.get(1).name());
        assertEquals(1, out.get(0).seq());   // seq 仍只由入参那一段连续写（R22），跟行序一起钉住
        assertEquals(2, out.get(1).seq());
    }

    // ---------------------------------------------------------------------
    // 夹具
    // ---------------------------------------------------------------------

    /** 一行登记过的群：闸读数由调用方给，null 就是「没做过可判定的快照」。 */
    private static ChatGroup group(long id, String chatKey, Double lastCoverage, String reason) {
        ChatGroup g = new ChatGroup();
        g.setId(id);
        g.setTenantId(TENANT);
        g.setAccountId(ACCOUNT);
        g.setPlatform("whatsapp");
        g.setChatKey(chatKey);
        g.setTitle("群" + id);
        g.setParticipantCount(10);
        g.setSnapshotCount(2);
        g.setLastSnapshotAt(LocalDateTime.of(2026, 10, 1, 8, 0));
        g.setIsFinal(0);
        g.setLastCoverage(lastCoverage);
        g.setLastReconcileReason(reason);
        return g;
    }

    /**
     * 一行成员：两条时间取**固定值**，为的是让 {@code latest_join_at}/{@code first_seen_at}
     * 在两行之间完全相等，只剩 {@code id} 能分开它们；{@code isInGroup} 由调用方按需要改。
     */
    private static GroupMemberState row(long id, String memberKey, String displayName) {
        GroupMemberState s = new GroupMemberState();
        s.setId(id);
        s.setTenantId(TENANT);
        s.setAccountId(ACCOUNT);
        s.setPlatform("whatsapp");
        s.setChatKey(GROUP);
        s.setMemberKey(memberKey);
        s.setDisplayName(displayName);
        s.setRoleType("member");
        s.setIsInGroup(1);
        s.setJoinCount(1);
        s.setLatestJoinAt(LocalDateTime.of(2026, 10, 1, 8, 0));
        s.setFirstSeenAt(LocalDateTime.of(2026, 9, 1, 8, 0));
        s.setSnapshotSeenCount(1);
        return s;
    }
}
