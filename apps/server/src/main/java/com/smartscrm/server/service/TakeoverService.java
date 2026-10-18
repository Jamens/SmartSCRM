package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.web.vo.ConversationVO;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B28 P1 — conversation handling state machine + takeover queue.
 *
 * <p>One conversation is exactly one of: {@code AI} (default, the future AI persona engine
 * handles it), {@code WAITING_TAKEOVER} (sits in the queue), {@code HUMAN_ACTIVE} (a seat
 * has taken it over). {@code ai_persona_id} is a forward hook persisted but not consulted
 * by any logic yet — the AI persona engine is a deferred B28 sub-feature.
 *
 * <p>All transitions go through {@link MessageQueryService#requireOwned} so a caller can only
 * move conversations that belong to their tenant.
 */
@Service
public class TakeoverService {

    private static final String AI = "AI";
    private static final String WAITING_TAKEOVER = "WAITING_TAKEOVER";
    private static final String HUMAN_ACTIVE = "HUMAN_ACTIVE";

    private final ChatConversationMapper conversationMapper;
    private final MessageQueryService query;
    private final NotificationService notificationService;
    private static final Logger log = LoggerFactory.getLogger(TakeoverService.class);

    public TakeoverService(ChatConversationMapper conversationMapper, MessageQueryService query,
                           NotificationService notificationService) {
        this.conversationMapper = conversationMapper;
        this.query = query;
        this.notificationService = notificationService;
    }

    /**
     * 坐席接管：AI / WAITING_TAKEOVER → HUMAN_ACTIVE，assignee 记为当前坐席（app_user.id）。
     * 已被别人接管的会话不允许二次抢：先入为主的坐席继续持有，避免两个坐席同时回复。
     *
     * <p><b>并发口径</b>：状态判定下沉到 SQL 的 WHERE（{@code claimTakeover} 是 CAS），
     * 不靠「读—判—写」。两个坐席同时点接管时，只有一个能把 {@code handling_status}
     * 从原值改成 HUMAN_ACTIVE，另一个拿到 0 行并收到 409——若用先读后写，
     * 两边都会读到「还没人接管」而双双通过，坐席互相顶掉。
     */
    @Transactional
    public ConversationVO takeover(Long tenantId, Long userId, Long conversationId) {
        ChatConversation head = query.requireOwned(tenantId, conversationId);
        // 快速失败：已是 HUMAN_ACTIVE 且持有者不是自己，直接点名是谁占着
        if (HUMAN_ACTIVE.equals(head.getHandlingStatus())
                && head.getAssigneeId() != null && !head.getAssigneeId().equals(userId)) {
            throw new BizException(40900, "该会话已被其他坐席接管");
        }
        // 已由自己接管：幂等 no-op，不必再动库
        if (HUMAN_ACTIVE.equals(head.getHandlingStatus())
                && userId.equals(head.getAssigneeId())) {
            return ConversationVO.of(head);
        }
        // CAS：把前置状态钉进 WHERE，抢不到就是被别人先搬走了
        if (conversationMapper.claimTakeover(tenantId, conversationId,
                head.getHandlingStatus(), HUMAN_ACTIVE, userId) == 0) {
            throw new BizException(40900, "该会话刚被其他坐席接管，请刷新后重试");
        }
        return ConversationVO.of(query.requireOwned(tenantId, conversationId));
    }

    /**
     * 规则引擎触发点（B28 P2）：仅当会话当前处于 AI 态才把它推入接管队列。
     * 已被坐席接管（HUMAN_ACTIVE）或已在队列（WAITING_TAKEOVER）的会话不被规则覆盖，
     * 避免一条新入站消息把正在服务的坐席"抢走"。已是队列态时此方法是幂等的 no-op。
     */
    @Transactional
    public ConversationVO transferIfAi(Long tenantId, Long conversationId, String reason) {
        ChatConversation head = query.requireOwned(tenantId, conversationId);
        if (!AI.equals(head.getHandlingStatus())) {
            return ConversationVO.of(head);
        }
        return transferHuman(tenantId, conversationId, reason);
    }

    /**
     * 恢复 AI：HUMAN_ACTIVE / WAITING_TAKEOVER → AI，清空 assignee 与原因。
     * 该会话重新交还给（未来的）AI 人设引擎处理。
     */
    @Transactional
    public ConversationVO resumeAi(Long tenantId, Long conversationId) {
        query.requireOwned(tenantId, conversationId);
        conversationMapper.update(null, new LambdaUpdateWrapper<ChatConversation>()
            .eq(ChatConversation::getId, conversationId)
            .eq(ChatConversation::getTenantId, tenantId)
            .set(ChatConversation::getHandlingStatus, AI)
            .set(ChatConversation::getAssigneeId, (Long) null)
            .set(ChatConversation::getWaitTakeoverAt, (LocalDateTime) null)
            .set(ChatConversation::getTransferReason, (String) null));
        return ConversationVO.of(query.requireOwned(tenantId, conversationId));
    }

    /**
     * 转人工：→ WAITING_TAKEOVER，进入接管队列。坐席手动转或规则引擎触发都走这里，
     * reason 描述触发来源（如命中的规则名）。
     *
     * <p><b>状态守卫 + CAS</b>：已被坐席接管（HUMAN_ACTIVE）的会话不再接受转人工。
     * 少了这道守卫，前端重复点一次「转人工」就会把坐席 A 正在服务的会话踢回队列、
     * 清空他的 {@code assigneeId}，还多发一条待接管通知——库态与前端就此打架。
     * 这与 {@link #takeover}（已被他人接管则拒绝）、{@link #transferIfAi}（仅 AI 态才转）
     * 是同一条纪律：状态流转必须先确认前置状态，不能无条件覆盖。
     *
     * <p>判定同样下沉到 SQL（{@code claimTransferHuman} 的 WHERE 只允许 AI / 队列两种前置），
     * 免得「读到的状态」与「更新的状态」之间被别人插一脚。
     *
     * <p>已是队列态（WAITING_TAKEOVER）时是幂等 no-op，直接回读当前状态，不重复通知。
     */
    @Transactional
    public ConversationVO transferHuman(Long tenantId, Long conversationId, String reason) {
        ChatConversation head = query.requireOwned(tenantId, conversationId);
        if (HUMAN_ACTIVE.equals(head.getHandlingStatus())) {
            throw new BizException(40900, "该会话已被坐席接管，无需转人工");
        }
        if (WAITING_TAKEOVER.equals(head.getHandlingStatus())) {
            // 已在队列里：幂等返回，不再重置等待时间、不重复投递通知
            return ConversationVO.of(head);
        }
        if (conversationMapper.claimTransferHuman(tenantId, conversationId, AI, WAITING_TAKEOVER,
                WAITING_TAKEOVER,
                LocalDateTime.now(MsgTimes.CHAT_ZONE).truncatedTo(ChronoUnit.MILLIS),
                reason == null ? null : reason) == 0) {
            // 前置状态在这中间被别人改掉了（多半是坐席刚接管）——不覆盖，交回 409
            throw new BizException(40900, "该会话状态已变更，请刷新后重试");
        }
        publishQueued(tenantId, conversationId, reason);
        return ConversationVO.of(query.requireOwned(tenantId, conversationId));
    }

    /**
     * A10 投递触发点：会话进入接管队列时给租户发一条系统通知（坐席该知道队列里多了一条）。
     * 这里是队列收口（规则引擎与坐席手动转都走 {@link #transferHuman}），是唯一该发的地方。
     * 投递是旁路：失败只记 warn，不把「转人工」这个正事带崩。
     */
    private void publishQueued(Long tenantId, Long conversationId, String reason) {
        try {
            String content = reason == null || reason.isBlank() ? "会话已转入接管队列" : ("转入原因：" + reason);
            notificationService.publish(tenantId, "system", "有会话待接管", content, "/messages", null);
        } catch (RuntimeException e) {
            log.warn("转人工通知投递失败 conversationId={}", conversationId, e);
        }
    }

    /** 接管队列：本租户所有 WAITING_TAKEOVER 会话，按等待时长升序（最久的排最前）。 */
    public List<ConversationVO> queue(Long tenantId) {
        List<ChatConversation> rows = conversationMapper.selectList(new LambdaQueryWrapper<ChatConversation>()
            .eq(ChatConversation::getTenantId, tenantId)
            .eq(ChatConversation::getHandlingStatus, WAITING_TAKEOVER)
            .orderByAsc(ChatConversation::getWaitTakeoverAt));
        return rows.stream().map(ConversationVO::of).toList();
    }
}
