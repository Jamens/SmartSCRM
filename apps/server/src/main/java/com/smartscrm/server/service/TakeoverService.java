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

    public TakeoverService(ChatConversationMapper conversationMapper, MessageQueryService query) {
        this.conversationMapper = conversationMapper;
        this.query = query;
    }

    /**
     * 坐席接管：AI / WAITING_TAKEOVER → HUMAN_ACTIVE，assignee 记为当前坐席（app_user.id）。
     * 已被别人接管的会话不允许二次抢：先入为主的坐席继续持有，避免两个坐席同时回复。
     */
    @Transactional
    public ConversationVO takeover(Long tenantId, Long userId, Long conversationId) {
        ChatConversation head = query.requireOwned(tenantId, conversationId);
        if (HUMAN_ACTIVE.equals(head.getHandlingStatus())
                && head.getAssigneeId() != null && !head.getAssigneeId().equals(userId)) {
            throw new BizException(40900, "该会话已被其他坐席接管");
        }
        conversationMapper.update(null, new LambdaUpdateWrapper<ChatConversation>()
            .eq(ChatConversation::getId, conversationId)
            .eq(ChatConversation::getTenantId, tenantId)
            .set(ChatConversation::getHandlingStatus, HUMAN_ACTIVE)
            .set(ChatConversation::getAssigneeId, userId)
            .set(ChatConversation::getWaitTakeoverAt, (LocalDateTime) null)
            .set(ChatConversation::getTransferReason, (String) null));
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
     */
    @Transactional
    public ConversationVO transferHuman(Long tenantId, Long conversationId, String reason) {
        query.requireOwned(tenantId, conversationId);
        conversationMapper.update(null, new LambdaUpdateWrapper<ChatConversation>()
            .eq(ChatConversation::getId, conversationId)
            .eq(ChatConversation::getTenantId, tenantId)
            .set(ChatConversation::getHandlingStatus, WAITING_TAKEOVER)
            .set(ChatConversation::getAssigneeId, (Long) null)
            .set(ChatConversation::getWaitTakeoverAt,
                LocalDateTime.now(MsgTimes.CHAT_ZONE).truncatedTo(ChronoUnit.MILLIS))
            .set(ChatConversation::getTransferReason, reason == null ? null : reason));
        return ConversationVO.of(query.requireOwned(tenantId, conversationId));
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
