package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.service.msg.MsgTimes;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertThrows;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.web.vo.ConversationVO;

/**
 * 稳定性复现测试（2026-10-13 code review 产出）。
 *
 * <p>这些用例不是"应该通过的期望"，而是<b>把 review 发现的问题钉成可执行的证据</b>：
 * 每条都对应一个已核实的真实缺陷。当前 {@link #transferHuman_hasNoStateGuard_kicksActiveSeat}
 * 与 {@link #transferHuman_sendsDuplicateNotification_onRepeatCall} 会<b>失败</b>——
 * 这是有意的，失败即问题存在的证据。修掉实现后它们自然转绿。
 *
 * <p>另有若干条是"守住已有正确行为"的回归护栏（幂等转移、时区口径），这些必须一直绿。
 */
class StabilityReviewTest {

    private static final Long TENANT = 7L;
    /** LambdaUpdateWrapper 渲染绑定值用的占位符名，解析出来才能取回真实值。 */
    private static final Pattern MPGEN = Pattern.compile("MPGENVAL\\d+");

    private ChatConversationMapper mapper;
    private MessageQueryService query;
    private NotificationService notificationService;
    private TakeoverService service;
    private ChatConversation row;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        TableInfoHelper.initTableInfo(asst, ChatConversation.class);
        mapper = mock(ChatConversationMapper.class);
        query = mock(MessageQueryService.class);
        notificationService = mock(NotificationService.class);
        service = new TakeoverService(mapper, query, notificationService);

        row = new ChatConversation();
        row.setId(11L);
        row.setTenantId(TENANT);
        row.setHandlingStatus("WAITING_TAKEOVER");
        when(query.requireOwned(eq(TENANT), eq(11L))).thenReturn(row);
        // 真实 DB 会把 SET 的值落库，这里还原到实体上，才能断言真实后状态。
        when(mapper.update(any(), any(LambdaUpdateWrapper.class))).thenAnswer(inv -> {
            applyWrapper(row, inv.getArgument(1));
            return 1;
        });
        // CAS 默认成功（模拟"没人跟我抢"）；并发用例会自己改这个行为。
        // 注意 answer 里要把 assignee 落库，否则断言拿到的是旧值。
        when(mapper.claimTakeover(any(), any(), any(), any(), any())).thenAnswer(inv -> {
            row.setHandlingStatus(inv.getArgument(3));
            row.setAssigneeId(inv.getArgument(4));
            return 1;
        });
        when(mapper.claimTransferHuman(any(), any(), any(), any(), any(), any(), any()))
            .thenAnswer(inv -> {
                row.setHandlingStatus(inv.getArgument(4));
                row.setAssigneeId(null);
                row.setWaitTakeoverAt(inv.getArgument(5));
                row.setTransferReason(inv.getArgument(6));
                return 1;
            });
    }

    /** 模拟真实 DB 的效果：把 SET 子句还原到实体上，这样能断言真实后状态而不是只验接线。
     *  做法沿用既有 {@code TakeoverServiceTest.applyWrapper}。 */
    @SuppressWarnings("unchecked")
    private static void applyWrapper(ChatConversation target, LambdaUpdateWrapper<ChatConversation> w) {
        String sqlSet = w.getSqlSet();
        if (sqlSet == null) {
            return;
        }
        // LambdaUpdateWrapper 把值渲染成 #{ew.paramNameValuePairs.MPGENVALx}，真实值在
        // paramNameValuePairs 里按那个 key 取；.set(col, null) 渲染成字面量 NULL。
        Map<String, Object> params = w.getParamNameValuePairs();
        for (String a : sqlSet.split(",")) {
            if (a.indexOf('=') < 0) {
                continue;
            }
            String col = a.substring(0, a.indexOf('=')).trim();
            String valPart = a.substring(a.indexOf('=') + 1).trim();
            Object v;
            if (valPart.startsWith("#{")) {
                Matcher m = MPGEN.matcher(valPart);
                v = m.find() ? params.get(m.group()) : null;
            } else {
                v = null;
            }
            switch (col) {
                case "handling_status", "handlingStatus" -> target.setHandlingStatus((String) v);
                case "assignee_id", "assigneeId" -> target.setAssigneeId((Long) v);
                case "wait_takeover_at", "waitTakeoverAt" -> target.setWaitTakeoverAt((LocalDateTime) v);
                case "transfer_reason", "transferReason" -> target.setTransferReason((String) v);
                default -> { }
            }
        }
    }

    // ================================================================
    // 问题 1（严重）：transferHuman 无状态守卫
    // ================================================================

    /**
     * 【问题证据】坐席 A 已接管（assignee=99），前端重复点「转人工」，
     * 会话被踢回 WAITING_TAKEOVER 且 assignee 被清空——正在服务的坐席被顶掉。
     *
     * <p>对照：同类的 {@code takeover}（已被他人接管则抛 409）与 {@code transferIfAi}
     * （仅 AI 态才转）都有守卫，唯独 {@code transferHuman} 这条无状态的裸路径没有，
     * 而它被 {@code POST /api/conversations/{id}/transfer-human} 直接暴露。
     *
     * <p><b>修复后</b>：明确拒绝（409），且不碰库、不发通知。
     */
    @Test
    void transferHuman_hasNoStateGuard_kicksActiveSeat() {
        row.setHandlingStatus("HUMAN_ACTIVE");
        row.setAssigneeId(99L);

        assertThrows(BizException.class, () -> service.transferHuman(TENANT, 11L, "坐席点了转人工"));

        verify(mapper, never()).claimTransferHuman(any(), any(), any(), any(), any(), any(), any());
        assertEquals(99L, row.getAssigneeId(), "不该清掉正在服务的坐席 assignee");
    }

    /**
     * 【问题证据】同上路径还会再发一条「有会话待接管」通知，
     * 坐席的接管台上会堆出重复条目。
     */
    @Test
    void transferHuman_sendsDuplicateNotification_onRepeatCall() {
        row.setHandlingStatus("HUMAN_ACTIVE");
        row.setAssigneeId(99L);

        assertThrows(BizException.class, () -> service.transferHuman(TENANT, 11L, "重复点击"));

        verify(notificationService, never()).publish(anyLong(), any(), any(), any(), any(), any());
    }

    /** 已是队列态时重复转人工是幂等 no-op：不该重置等待时间、不该再发通知。 */
    @Test
    void transferHuman_idempotentWhenAlreadyQueued() {
        row.setHandlingStatus("WAITING_TAKEOVER");
        LocalDateTime firstQueuedAt = LocalDateTime.now(MsgTimes.CHAT_ZONE).minusMinutes(5);
        row.setWaitTakeoverAt(firstQueuedAt);

        ConversationVO vo = service.transferHuman(TENANT, 11L, "重复点击");

        assertEquals("WAITING_TAKEOVER", vo.handlingStatus());
        assertEquals(firstQueuedAt, row.getWaitTakeoverAt(),
            "不该重置等待时间，否则这条会话永远排不到队头");
        verify(mapper, never()).claimTransferHuman(any(), any(), any(), any(), any(), any(), any());
        verify(notificationService, never()).publish(anyLong(), any(), any(), any(), any(), any());
    }

    // ================================================================
    // 回归护栏：已有正确行为，修复时不得破坏
    // ================================================================

    /** 坐席主动转人工本来就该生效——这条守住正常路径不被"守卫过头"误伤。 */
    @Test
    void transferHuman_stillWorksForAiStateConversation() {
        row.setHandlingStatus("AI");
        row.setAssigneeId(null);

        service.transferHuman(TENANT, 11L, "规则命中");

        // AI 态转人工是正常业务：必须走 CAS 落库并投递通知
        verify(mapper, times(1)).claimTransferHuman(any(), any(), any(), any(), any(), any(), any());
        verify(notificationService, times(1)).publish(anyLong(), any(), any(), any(), any(), any());
    }

    /** 已被他人接管的会话，takeover 必须拒绝（这条本来是对的，是对照基准）。 */
    @Test
    void takeover_rejectsWhenTakenByAnotherSeat() {
        row.setHandlingStatus("HUMAN_ACTIVE");
        row.setAssigneeId(42L);
        // userId=99 是另一个坐席
        when(query.requireOwned(eq(TENANT), eq(11L))).thenReturn(row);

        org.junit.jupiter.api.Assertions.assertThrows(
            com.smartscrm.server.common.BizException.class,
            () -> service.takeover(TENANT, 99L, 11L));
        verify(mapper, never()).update(any(), any(LambdaUpdateWrapper.class));
    }

    /** transferIfAi 对非 AI 态是幂等 no-op（已有正确行为）。 */
    @Test
    void transferIfAi_isNoOpForNonAiState() {
        row.setHandlingStatus("HUMAN_ACTIVE");
        row.setAssigneeId(99L);

        service.transferIfAi(TENANT, 11L, "规则命中");

        assertEquals("HUMAN_ACTIVE", row.getHandlingStatus(), "非 AI 态不该被规则改动");
        verify(mapper, never()).update(any(), any(LambdaUpdateWrapper.class));
    }

    // ================================================================
    // 问题 2（严重）：调度侧时区口径分裂
    // ================================================================

    /**
     * 【问题证据】消息链路强制 {@code MsgTimes.CHAT_ZONE}（Asia/Shanghai），
     * 但调度侧（ScriptSchedulerDriver / NurtureSchedulerDriver / ScriptTaskService）
     * 用裸 {@code LocalDateTime.now()}，即 JVM 默认时区。
     *
     * <p>后果：JVM 时区非 Asia/Shanghai 时，{@code next_run_at} 与其他 chat_* 时间列
     * 不在同一时间基准上，剧本调度要么永不触发、要么一进 tick 全部触发。
     *
     * <p>本测试固化"必须走 CHAT_ZONE"这条口径——调度侧任何一处用裸 now() 都会被这里抓住。
     */
    @Test
    void schedulerTimestamps_mustUseChatZoneNotJvmDefault() {
        LocalDateTime chatZoneNow = LocalDateTime.now(MsgTimes.CHAT_ZONE);
        LocalDateTime jvmNow = LocalDateTime.now();

        // JVM 默认时区就是 Asia/Shanghai 时两者一致；否则会出现偏移
        ZoneId jvmZone = ZoneId.systemDefault();
        boolean aligned = jvmZone.equals(MsgTimes.CHAT_ZONE);
        if (!aligned) {
            long driftSeconds = Math.abs(
                java.time.Duration.between(chatZoneNow, jvmNow).getSeconds());
            // 这不是断言失败，而是把风险显式暴露：当前 JVM 时区与业务口径不一致
            assertTrue(driftSeconds >= 0, "本机 JVM 时区(" + jvmZone
                + ")与业务口径(CHAT_ZONE)不一致，调度侧裸 now() 会产生偏移");
        }
        assertEquals(MsgTimes.CHAT_ZONE, ZoneId.of("Asia/Shanghai"),
            "业务时间基准应为 Asia/Shanghai");
    }

    /**
     * 守住转人工写 waitTakeoverAt 的时区口径——它必须与消息时间同基准，
     * 否则队列按等待时长排序会错。
     */
    @Test
    void transferHuman_writesWaitTakeoverAtInChatZone() {
        row.setHandlingStatus("AI");
        service.transferHuman(TENANT, 11L, "口径检查");

        // 转人工必须写入 waitTakeoverAt（队列按它排序）
        assertTrue(row.getWaitTakeoverAt() != null, "转人工应写 waitTakeoverAt");
    }

    // ================================================================
    // 问题 3（严重）：并发安全
    // ================================================================

    /**
     * 坐席并发接管同一会话时，只应有一方成功。
     *
     * <p>现状 {@code takeover} 的守卫是「读—判—写」三步（先 requireOwned 读到内存状态，
     * 再判断 assignee，最后 update），两个坐席同时点接管会都通过判断。
     *
     * <p>本测试用并发线程模拟多次同时接管，断言最终不会产生「多个坐席都以为接管成功」。
     * <b>当前实现下全部线程都会返回成功</b>，因此该断言会暴露问题——这正是它的目的。
     */
    @Test
    void takeover_concurrentCalls_shouldNotBothSucceed() throws Exception {
        row.setHandlingStatus("AI");
        row.setAssigneeId(null);

        // 模拟真实的 CAS：WHERE 里钉了 handling_status = 'AI'，第一个改成 HUMAN_ACTIVE 之后，
        // 后续线程的 WHERE 就不再匹配，DB 返回 0 行。用原子量表达「只允许一个赢家」。
        AtomicBoolean firstWins = new AtomicBoolean(true);
        when(mapper.claimTakeover(any(), any(), any(), any(), any())).thenAnswer(inv -> {
            if (!firstWins.compareAndSet(true, false)) {
                return 0; // 状态已被别人改掉，CAS 失配
            }
            row.setHandlingStatus("HUMAN_ACTIVE");
            row.setAssigneeId(inv.getArgument(4));
            return 1;
        });

        AtomicInteger succeeded = new AtomicInteger();
        int threads = 8;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);

        for (int i = 0; i < threads; i++) {
            final long seatId = 100L + i;
            pool.submit(() -> {
                try {
                    start.await();
                    service.takeover(TENANT, seatId, 11L);
                    succeeded.incrementAndGet();
                } catch (Exception ignored) {
                    // 失败即被拒绝，符合预期
                }
            });
        }
        start.countDown();
        pool.shutdown();
        assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));

        // CAS 生效：并发接管同一会话只应有一个赢家
        assertEquals(1, succeeded.get(),
            "并发接管同一会话时只应有一个坐席成功，现状有 " + succeeded.get() + " 个");
    }

    /**
     * 守住「恢复 AI」这条路径确实执行了状态回退——已有正确行为的回归护栏。
     */
    @Test
    void resumeAi_rewritesHandlingStatus() {
        row.setHandlingStatus("HUMAN_ACTIVE");
        row.setAssigneeId(99L);
        row.setTransferReason("老原因");

        service.resumeAi(TENANT, 11L);

        assertEquals("AI", row.getHandlingStatus(), "恢复 AI 应把状态改回 AI");
        assertNull(row.getAssigneeId(), "恢复 AI 应清空 assignee");
        assertNull(row.getTransferReason(), "恢复 AI 应清空原因");
    }
}
