package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
import com.smartscrm.server.common.BizException;
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
import java.util.ArrayList;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * 群成员读侧（{@code 3771927} 那一层）八条校准中的五条：① 搜索走 SearchPattern 转义、② 名单行序 ISNULL 沉底、
 * ④ 客户反查按账号收窄、⑤ 导出去重早于计数 + 群键形态、⑥ pageGroups 的 sort=stale。全部打在 mock 掉的 mapper 上，
 * 形状照 {@link BatchSendServiceTest}。
 *
 * 这一份**只**证明 Java 这边把 ISNULL 放在了裸列前、把转义后的模式交给了 LIKE，不证明真 MySQL 按该序出行——
 * 那是 Task 14 契约腿的活。③ 的另一半（pageMembers 只读闸落库的两列）在 {@link GroupMemberWriteCalibrationTest}。
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

        for (LambdaQueryWrapper<GroupMemberState> w : cap.getAllValues()) {
            assertTrue(w.getSqlSegment().contains("account_id"), w.getSqlSegment());
            assertTrue(w.getSqlSegment().contains("platform"), w.getSqlSegment());
        }
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

        query.pageGroups(TENANT, ACCOUNT, "whatsapp", 1, 200, null);
        assertFalse(cap.getAllValues().get(1).getSqlSegment().contains("ISNULL("), "默认顺序被顺手改成了旧→新");
    }
}
