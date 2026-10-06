package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.BatchSendDetail;
import com.smartscrm.server.entity.BatchSendTask;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.BatchSendDetailMapper;
import com.smartscrm.server.mapper.BatchSendTaskMapper;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.web.dto.BatchReportItemDTO;
import com.smartscrm.server.web.dto.BatchReportsDTO;
import com.smartscrm.server.web.dto.BatchRecipientDTO;
import com.smartscrm.server.web.dto.BatchTaskCreateDTO;
import com.smartscrm.server.web.vo.BatchCreateVO;
import com.smartscrm.server.web.vo.BatchRecallVO;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

/**
 * 后端服务层那四处「只有代码知道」的不变量，全部打在 mock 掉的 mapper 上（不碰库、不碰页面）：
 * <ol>
 *   <li>R4 的两拍有严格先后（{@code reconcile}）——顺序换了就是重复发送事故，而 SQL 里的守卫
 *       「所属任务仍是 running」在真库里只会安静地少结几行，没人报错；</li>
 *   <li>R39：把任务搬进 running 的那一跳要立刻续上心跳，否则引擎一起来做 reconcile 就会把
 *       一个刚点下「开始」的任务判成陈旧；</li>
 *   <li>R37：{@code /reports} 只接受引擎到得了的那五个明细状态，越界的整页拒收；</li>
 *   <li>R40：明细页对外来/不存在的任务 id 说「任务不存在」，不说「这里没有行」；</li>
 *   <li>R35：正文上限量的是渲染后那一串，创建时就得到点名的那一行。</li>
 * </ol>
 * 这一份**不**证明的事：两条 SQL 真能匹配到预期的行数（那是 {@code tmp/p7b-batch-contract.mjs}
 * 的腿，走 :8180 打在真库上）；渲染器本身对不对（{@code BatchRenderTest}）。
 */
class BatchSendServiceTest {

    private static final long TENANT = 1L;
    private static final long TASK = 7L;
    private static final long ACCOUNT = 9L;
    private static final String CHAT = "8613800000000@c.us";

    private final BatchSendTaskMapper taskMapper = mock(BatchSendTaskMapper.class);
    private final BatchSendDetailMapper detailMapper = mock(BatchSendDetailMapper.class);
    private final PlatformAccountMapper accountMapper = mock(PlatformAccountMapper.class);
    private final ChatConversationMapper conversationMapper = mock(ChatConversationMapper.class);
    private final CustomerMapper customerMapper = mock(CustomerMapper.class);
    private final NotificationService notificationService = mock(NotificationService.class);
    private final BatchSendService service = new BatchSendService(
            taskMapper, detailMapper, accountMapper, conversationMapper, customerMapper, notificationService);

    /**
     * MyBatis-Plus 在 {@code in(...)} 与 {@code set(...)} 这两处会当场把 lambda 解析成列名（{@code eq(...)}
     * 是惰性的），而那份列缓存平时由 Spring 启动时的 mapper 扫描装好。这里把这三张表的 TableInfo
     * 手工装一遍，为的是让被测的那几行服务代码能跑到它的判据上——不这么做就只能绕开 wrapper，
     * 而绕开 wrapper 就等于把要证的这条接线没验。
     */
    @BeforeAll
    static void installLambdaColumnCache() {
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(new MybatisConfiguration(), "");
        TableInfoHelper.initTableInfo(assistant, BatchSendTask.class);
        TableInfoHelper.initTableInfo(assistant, BatchSendDetail.class);
        TableInfoHelper.initTableInfo(assistant, PlatformAccount.class);
        TableInfoHelper.initTableInfo(assistant, ChatConversation.class);
    }

    @Test
    void reconcileJudgesUnknownBeforeItPausesTheTask() {
        when(taskMapper.markStaleSendingUnknown(eq(TENANT), any())).thenReturn(2);
        when(taskMapper.pauseStaleTasks(eq(TENANT), any())).thenReturn(1);

        Map<String, Object> r = service.reconcile(TENANT);

        InOrder order = inOrder(taskMapper);
        order.verify(taskMapper).markStaleSendingUnknown(eq(TENANT), any());
        order.verify(taskMapper).pauseStaleTasks(eq(TENANT), any());
        assertEquals(2, r.get("markedUnknown"));
        assertEquals(1, r.get("pausedTasks"));
    }

    /**
     * I-2 第三拍的判别证人：一行孤儿 `recalling` 必须在一次 `reconcile` 之后落回 `recall_failed`
     * 且 `recall_detail` 非空、`markedRecallFailed` 键数到 1——少了那一拍，`applyRecallReport` 只结
     * `recalling` 却没有生产者再报，行永远显示「撤回中」；同时 `markRecalling` 现在认 `recall_failed`
     * 再进（I-6 的回程入口），少了这一拍回程也开不了。
     */
    @Test
    void reconcileSettlesOrphanRecallingRows() {
        when(detailMapper.markOrphanRecallingFailed(eq(TENANT), anyString())).thenReturn(1);

        Map<String, Object> r = service.reconcile(TENANT);

        verify(detailMapper).markOrphanRecallingFailed(eq(TENANT), anyString());
        assertEquals(1, r.get("markedRecallFailed"), "第三拍要数得出几行被结掉");
    }

    /**
     * I-6 的四条判据的判别证人：同一批 success + 有 msgKey 的行，四种 `recall_status` 走两条不同的路——
     * `none` 与 `recall_failed` 进 eligible（撤回是可再试动作，一次超时不能把消息永久钉在客户脸上），
     * `recalled` 与 `recalling` 各点名挡下（终态 / 别人手里）。少了这两条点名，界面上看不到「为什么
     * 这一条没被撤」；而 `recall_failed` 落进 blocked 就是「失败即终态」那条错误裁定。
     */
    @Test
    void recallEligibilitySeparatesRecallableFromTerminalAndInFlight() {
        when(taskMapper.selectOne(any())).thenReturn(realTask());
        when(detailMapper.selectList(any())).thenReturn(List.of(
                recallRow(101L, "none"),
                recallRow(102L, "recall_failed"),
                recallRow(103L, "recalled"),
                recallRow(104L, "recalling")));

        BatchRecallVO vo = service.recall(TENANT, TASK, List.of(101L, 102L, 103L, 104L));

        assertEquals(2, vo.eligible().size(), "none 与 recall_failed 都要落到 eligible");
        assertTrue(vo.eligible().stream().anyMatch(t -> t.detailId() == 101L));
        assertTrue(vo.eligible().stream().anyMatch(t -> t.detailId() == 102L));
        assertEquals(2, vo.rejected().size(), "recalled 与 recalling 各点一条名");
        assertTrue(vo.rejected().stream().anyMatch(b -> b.detailId() == 103L
                && b.reason() != null && b.reason().contains("撤回成功")),
                "recalled 的理由要点名「已撤回」");
        assertTrue(vo.rejected().stream().anyMatch(b -> b.detailId() == 104L
                && b.reason() != null && b.reason().contains("正在撤回中")),
                "recalling 的理由要点名「正在撤」");
    }

    /** markRecalling 现在也认 `recall_failed`（I-6 与 I-2 第三拍同一批改动的一侧），这里判接线。 */
    @Test
    void recallPushesEligibleIntoMarkRecalling() {
        when(taskMapper.selectOne(any())).thenReturn(realTask());
        when(detailMapper.selectList(any())).thenReturn(List.of(recallRow(102L, "recall_failed")));

        service.recall(TENANT, TASK, List.of(102L));

        verify(detailMapper).markRecalling(eq(TENANT), eq(TASK), eq(List.of(102L)));
    }

    @Test
    void movingToRunningStampsTheHeartbeatRightAway() {
        when(taskMapper.selectOne(any())).thenReturn(task("pending"));
        when(taskMapper.moveTo(TENANT, TASK, "pending", "running")).thenReturn(1);

        service.transition(TENANT, TASK, "start");

        verify(taskMapper).heartbeat(TENANT, TASK);
    }

    @Test
    void movingToPausedLeavesTheHeartbeatAlone() {
        when(taskMapper.selectOne(any())).thenReturn(task("running"));
        when(taskMapper.moveTo(TENANT, TASK, "running", "paused")).thenReturn(1);

        service.transition(TENANT, TASK, "pause");

        verify(taskMapper, never()).heartbeat(anyLong(), anyLong());
    }

    @Test
    void reportsRefuseAStatusOutsideTheEngineVocabulary() {
        when(taskMapper.selectOne(any())).thenReturn(task("running"));
        BatchReportsDTO dto = new BatchReportsDTO();
        dto.setItems(List.of(item(42L, "sent")));

        BizException e = assertThrows(BizException.class, () -> service.reports(TENANT, TASK, dto));

        assertEquals(40013, e.getCode());
        assertTrue(e.getMessage().contains("42=sent"), "要点名是哪一行报了哪个值: " + e.getMessage());
        verify(detailMapper, never()).applyReport(anyLong(), anyLong(), anyLong(), anyString(),
                any(), any(), any(), any(), any());
    }

    /** 反向确认闸门不是「全拒」：词表里那五个各自都要能把值送到那一行。 */
    @Test
    void everyReportableStatusReachesTheRow() {
        when(taskMapper.selectOne(any())).thenReturn(task("running"));
        List<BatchReportItemDTO> items = new ArrayList<>();
        long detailId = 100L;
        for (String status : List.of("sending", "success", "failed", "unknown", "skipped")) {
            items.add(item(detailId++, status));
        }
        BatchReportsDTO dto = new BatchReportsDTO();
        dto.setItems(items);

        service.reports(TENANT, TASK, dto);

        verify(detailMapper, times(5)).applyReport(eq(TENANT), eq(TASK), anyLong(), anyString(),
                any(), any(), any(), any(), any());
    }

    /**
     * A10 投递触发点：running→done（open==0）时给租户广播一条系统通知，带 `/broadcast` 跳转。
     * 只在这一趟真把状态搬进终态时发，所以重复轮询 reports 不会重复投递。
     */
    @Test
    void aTaskReachingDonePublishesASystemNotification() {
        when(taskMapper.selectOne(any())).thenReturn(task("running"));
        when(taskMapper.openCount(anyLong(), anyLong())).thenReturn(0);
        List<BatchReportItemDTO> items = new ArrayList<>();
        items.add(item(200L, "success"));
        BatchReportsDTO dto = new BatchReportsDTO();
        dto.setItems(items);

        service.reports(TENANT, TASK, dto);

        verify(taskMapper).moveTo(TENANT, TASK, "running", "done");
        ArgumentCaptor<String> title = ArgumentCaptor.forClass(String.class);
        verify(notificationService).publish(eq(TENANT), eq("system"), title.capture(), any(), eq("/broadcast"), isNull());
        assertTrue(title.getValue().contains("已完成"), "标题要说已完成：" + title.getValue());
    }

    @Test
    void detailPageOfAForeignTaskIsNotFoundNotEmpty() {
        when(taskMapper.selectOne(any())).thenReturn(null);

        BizException e = assertThrows(BizException.class,
                () -> service.pageDetails(TENANT, 9000001L, null, null, 1, 20));

        assertEquals(40404, e.getCode(), "外来任务要说「不存在」，不能回一页空行");
        verify(detailMapper, never()).selectPage(any(), any());
    }

    /**
     * R35 的接线证人：模板只有 {@code {号码}} 三个 token，模板那一遍（{@code BatchRules.violations}）
     * 过得了，渲染后是空串——这一行要是放进库里，引擎跑它时才会变成一条 unknown。
     */
    @Test
    void createIsRefusedWhenTheRenderedBodyBreaksTheCap() {
        when(accountMapper.selectList(any())).thenReturn(List.of(boundAccount()));
        when(conversationMapper.selectList(any())).thenReturn(List.of(customerlessConversation()));

        BizException e = assertThrows(BizException.class,
                () -> service.create(TENANT, createDto("{号码}")));

        assertEquals(40013, e.getCode());
        assertTrue(e.getMessage().contains("seq 1"), "要点名是展开后的第几行: " + e.getMessage());
        verify(taskMapper, never()).insert(any(BatchSendTask.class));
    }

    /** 同一处闸门的反向：正常渲染的任务照常落库，否则上一条测的就是「创建永远失败」。 */
    @Test
    void createStillExpandsWhenTheRenderedBodyIsFine() {
        when(accountMapper.selectList(any())).thenReturn(List.of(boundAccount()));
        when(conversationMapper.selectList(any())).thenReturn(List.of(customerlessConversation()));
        when(taskMapper.insert(any(BatchSendTask.class))).thenAnswer(inv -> {
            inv.getArgument(0, BatchSendTask.class).setId(TASK);
            return 1;
        });
        when(detailMapper.countByTask(TENANT, TASK))
                .thenReturn(List.of(Map.of("sendStatus", "pending", "c", 2L)));

        BatchCreateVO vo = service.create(TENANT, createDto("第一条 {客户名}"));

        assertEquals(2, vo.totalCount());
        verify(detailMapper).insertBatch(anyList());
    }

    private BatchSendTask task(String status) {
        BatchSendTask t = new BatchSendTask();
        t.setId(TASK);
        t.setTenantId(TENANT);
        t.setStatus(status);
        t.setTotalCount(4);
        return t;
    }

    /** 撤回判据的入口要求非演练：`dryRun=true` 时 `BatchStatus.recallBlocker` 会一把挡下全部。 */
    private BatchSendTask realTask() {
        BatchSendTask t = task("running");
        t.setDryRun(false);
        return t;
    }

    /** 一条已发出、可寻址的 success 行；只有 `recallStatus` 在不同用例间翻转，把判据钉死在第四支。 */
    private static BatchSendDetail recallRow(long id, String recallStatus) {
        BatchSendDetail d = new BatchSendDetail();
        d.setId(id);
        d.setTenantId(TENANT);
        d.setTaskId(TASK);
        d.setSeq((int) (id - 100L));
        d.setAccountId(ACCOUNT);
        d.setChatKey(CHAT);
        d.setSendStatus("success");
        d.setMsgKey("true_x@c.us_" + id + "_out");
        d.setRecallStatus(recallStatus);
        return d;
    }

    private static BatchReportItemDTO item(long detailId, String sendStatus) {
        BatchReportItemDTO i = new BatchReportItemDTO();
        i.setDetailId(detailId);
        i.setSendStatus(sendStatus);
        return i;
    }

    private static PlatformAccount boundAccount() {
        PlatformAccount a = new PlatformAccount();
        a.setId(ACCOUNT);
        a.setViewId("view-1");
        return a;
    }

    private static ChatConversation customerlessConversation() {
        ChatConversation c = new ChatConversation();
        c.setAccountId(ACCOUNT);
        c.setChatKey(CHAT);
        c.setTitle("");
        return c;
    }

    private static BatchTaskCreateDTO createDto(String firstContent) {
        BatchRecipientDTO r = new BatchRecipientDTO();
        r.setAccountId(ACCOUNT);
        r.setChatKey(CHAT);
        BatchTaskCreateDTO dto = new BatchTaskCreateDTO();
        dto.setName("服务层单测");
        dto.setPlatform("whatsapp");
        dto.setDryRun(true);
        dto.setAccountIds(List.of(ACCOUNT));
        dto.setConversations(List.of(r));
        dto.setContents(List.of(firstContent, "第二条"));
        dto.setMsgIntervalMin(0);
        dto.setMsgIntervalMax(0);
        dto.setChatIntervalMin(0);
        dto.setChatIntervalMax(0);
        return dto;
    }
}
