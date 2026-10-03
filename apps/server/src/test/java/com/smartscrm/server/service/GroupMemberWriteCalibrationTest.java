package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
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
import com.smartscrm.server.web.dto.GroupMemberBatchDTO;
import java.util.ArrayList;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * 群成员写侧（{@code 3771927} 那一层，此前零 JUnit 覆盖）的八条校准中的三条：③ 闸读数落库、
 * ⑦ 事件投影按 affected rows、⑧ 入参长度闸 + phone 入库归一。全部打在 mock 掉的 mapper 上
 * （不碰库、不碰页面），形状照 {@link BatchSendServiceTest}。
 *
 * 这一份**不**证明的事：那两列真进了 {@code chat_group}（V13 的库形状是 Step 12 探针的活）、
 * markSnapshotSuccess/markGate 的 SQL 在真 MySQL 上匹配到预期行数（Task 14 契约腿的活）。
 */
class GroupMemberWriteCalibrationTest {

    private static final long TENANT = 1L;
    private static final long ACCOUNT = 9L;
    private static final String GROUP = "120363111@g.us";
    private static final String MEMBER = "8613800000000@c.us";

    private final ChatGroupMapper groupMapper = mock(ChatGroupMapper.class);
    private final GroupMemberStateMapper stateMapper = mock(GroupMemberStateMapper.class);
    private final GroupMemberEventMapper eventMapper = mock(GroupMemberEventMapper.class);
    private final PlatformAccountMapper accountMapper = mock(PlatformAccountMapper.class);
    private final CustomerMapper customerMapper = mock(CustomerMapper.class);
    private final GroupMemberService service = new GroupMemberService(
        groupMapper, stateMapper, eventMapper, accountMapper, customerMapper);

    /**
     * MyBatis-Plus 会把 lambda（{@code eq(Customer::getOpenId, ...)}）当场解析成列名，那份缓存平时由
     * Spring 启动时的 mapper 扫描装好。这里手工装一遍，为的是 matchCustomer 那一路能跑到判据上。
     */
    @BeforeAll
    static void installLambdaColumnCache() {
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(new MybatisConfiguration(), "");
        TableInfoHelper.initTableInfo(assistant, ChatGroup.class);
        TableInfoHelper.initTableInfo(assistant, GroupMemberState.class);
        TableInfoHelper.initTableInfo(assistant, GroupMemberEvent.class);
        TableInfoHelper.initTableInfo(assistant, PlatformAccount.class);
        TableInfoHelper.initTableInfo(assistant, Customer.class);
    }

    /** 账号必须解析得动，否则每条测试都先死在 resolveAccount 上。 */
    @BeforeEach
    void accountResolves() {
        PlatformAccount a = new PlatformAccount();
        a.setId(ACCOUNT);
        a.setTenantId(TENANT);
        a.setPlatformType(1);              // WhatsApp：与 ChatKeys.platformOfAccountType 的映射一致
        when(accountMapper.selectById(ACCOUNT)).thenReturn(a);
    }

    /** ③：闸放行 → 五列一起写，读数就是这一跳的 0.4 之上那个值。 */
    @Test
    void allowedSnapshotRecordsDenominatorAndGateReadingTogether() {
        ChatGroup g = new ChatGroup();
        g.setId(3L);
        g.setParticipantCount(10);
        when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(g);
        when(stateMapper.selectByGroup(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(List.of());

        GroupMemberBatchDTO dto = batchWithSnapshot(10);       // 夹具见下
        GroupMemberService.IngestResult r = service.ingest(TENANT, dto);

        assertEquals("ok", r.reason());
        verify(groupMapper).markSnapshotSuccess(eq(3L), eq(10), eq(1.0), eq("ok"), any());
        verify(groupMapper, never()).markGate(anyLong(), any(), any(), any());
    }

    /** ③：闸拦下 → 只写读数那两列。这条是 R20 的守门人：一旦有人把 markGate 换成 markSnapshotSuccess，分母就被 4 人污染。 */
    @Test
    void blockedSnapshotWritesGateReadingOnly() {
        ChatGroup g = new ChatGroup();
        g.setId(3L);
        g.setParticipantCount(10);
        when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(g);
        when(stateMapper.selectByGroup(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(List.of());

        GroupMemberService.IngestResult r = service.ingest(TENANT, batchWithSnapshot(4));

        assertEquals("coverage_too_low", r.reason());
        assertFalse(r.reconciled());
        assertEquals(0.4, r.coverage(), 1e-9);
        verify(groupMapper, never()).markSnapshotSuccess(anyLong(), anyInt(), any(), any(), any());
        verify(groupMapper).markGate(eq(3L), eq(0.4), eq("coverage_too_low"), any());
    }

    /** ③：只报事件、没带快照 → 两种都不写。上一轮的好读数不能被抹成 no_snapshot。 */
    @Test
    void eventOnlyBatchWritesNeitherGatePath() {
        GroupMemberBatchDTO dto = new GroupMemberBatchDTO();
        dto.setAccountId(ACCOUNT);
        dto.setEvents(List.of(event("added", "dedup-1")));
        when(eventMapper.insertIgnore(any())).thenReturn(1);

        GroupMemberService.IngestResult r = service.ingest(TENANT, dto);

        assertEquals("no_snapshot", r.reason());
        assertFalse(r.reconciled());
        verify(groupMapper, never()).markSnapshotSuccess(anyLong(), anyInt(), any(), any(), any());
        verify(groupMapper, never()).markGate(anyLong(), any(), any(), any());
    }

    /** ⑦：批量 IGNORE 里被去重掉的那条不许再投影一次——join_count 双计永远回不去。 */
    @Test
    void onlyActuallyInsertedEventsProject() {
        GroupMemberBatchDTO dto = new GroupMemberBatchDTO();
        dto.setAccountId(ACCOUNT);
        dto.setEvents(List.of(event("added", "d-1"), event("added", "d-2"), event("added", "d-3")));
        when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(null);
        // 第 2 条撞 uk_event：affected rows = 0。旧实现批量插入 + 无条件投影，这里会投三条。
        when(eventMapper.insertIgnore(any())).thenReturn(1, 0, 1);

        GroupMemberService.IngestResult r = service.ingest(TENANT, dto);

        assertEquals(2, r.eventsInserted());
        verify(stateMapper, times(2)).applyJoin(eq(TENANT), eq(ACCOUNT), eq("whatsapp"), eq(GROUP),
            eq(MEMBER), any(), any(), any());
    }

    /** ⑧：超长键整批拒收，且响在投影之前——不许留下"事件没进但状态改了"的半套。 */
    @Test
    void oversizedKeyRejectsWholeBatchBeforeAnyProjection() {
        GroupMemberBatchDTO dto = new GroupMemberBatchDTO();
        dto.setAccountId(ACCOUNT);
        GroupMemberBatchDTO.EventItem e = event("added", "d-1");
        e.setMemberKey("x".repeat(161));
        dto.setEvents(List.of(e));

        BizException bx = assertThrows(BizException.class, () -> service.ingest(TENANT, dto));
        assertEquals(40000, bx.getCode());
        verify(eventMapper, never()).insertIgnore(any());
        verify(stateMapper, never()).applyJoin(anyLong(), anyLong(), anyString(), anyString(), anyString(),
            any(), any(), any());
    }

    /** ⑧ / R38：phone 入库前归一，界面上才只有一个号码形状，且按号码那一路匹配客户真能命中。 */
    @Test
    void snapshotPhoneIsNormalisedOnWrite() {
        ChatGroup g = new ChatGroup();
        g.setId(3L);
        g.setParticipantCount(1);
        when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(g);
        when(stateMapper.selectByGroup(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(List.of());
        ArgumentCaptor<GroupMemberState> cap = ArgumentCaptor.forClass(GroupMemberState.class);

        service.ingest(TENANT, batchWithSnapshot(1, "+86 138-0000-0000"));

        verify(stateMapper).upsertFromSnapshot(cap.capture(), any());
        assertEquals("8613800000000", cap.getValue().getPhone());
    }

    // ---------------------------------------------------------------------
    // 夹具
    // ---------------------------------------------------------------------

    private static GroupMemberBatchDTO.EventItem event(String type, String dedup) {
        GroupMemberBatchDTO.EventItem e = new GroupMemberBatchDTO.EventItem();
        e.setChatKey(GROUP);
        e.setMemberKey(MEMBER);
        e.setEventType(type);
        e.setOccurredAtEpochSec(1_700_000_000L);
        e.setDedupKey(dedup);
        e.setSource("live_event");
        return e;
    }

    private static GroupMemberBatchDTO batchWithSnapshot(int n) {
        return batchWithSnapshot(n, "+8613800000000");
    }

    private static GroupMemberBatchDTO batchWithSnapshot(int n, String phone) {
        List<GroupMemberBatchDTO.ParticipantItem> parts = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            GroupMemberBatchDTO.ParticipantItem p = new GroupMemberBatchDTO.ParticipantItem();
            p.setMemberKey(i == 0 ? MEMBER : "861380000000" + i + "@c.us");
            p.setPhone(phone);
            p.setDisplayName("成员" + i);
            p.setRoleType("member");
            parts.add(p);
        }
        GroupMemberBatchDTO.SnapshotItem snap = new GroupMemberBatchDTO.SnapshotItem();
        snap.setChatKey(GROUP);
        snap.setParticipants(parts);
        GroupMemberBatchDTO dto = new GroupMemberBatchDTO();
        dto.setAccountId(ACCOUNT);
        dto.setSnapshot(snap);
        return dto;
    }
}
