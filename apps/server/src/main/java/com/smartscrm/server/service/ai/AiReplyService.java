package com.smartscrm.server.service.ai;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.entity.AiPersona;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.mapper.AiPersonaMapper;
import com.smartscrm.server.mapper.ChatConversationMapper;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * B28 第四段——AI 自动应答（生成建议，不直接发送）。
 *
 * <p>补上状态机里一直缺的那条边：入站消息进来时，如果会话还挂在 AI 态，就用
 * {@link KnowledgeSearchService} 检索知识库，命中够高就把答案作为**建议**写到会话头上，
 * 供坐席在接管台确认。`TakeoverService` 里那个 {@code ai_persona_id} forward hook
 * 至今仍未被消费——这里走的不是人设引擎，是知识库检索，两者别混。
 *
 * <p>三条硬约束：
 * <ol>
 *   <li><b>只产出建议，绝不自己发出去</b>：后端没有出站发送通道（发送在 Electron 客户端侧），
 *       物理上发不出去；即便将来有了，也必须走坐席确认。这条对应项目「不往真人会话发」的红线。
 *   <li><b>不抢坐席</b>：只有 AI 态的会话才产出建议。已被坐席接管（HUMAN_ACTIVE）或
 *       已在队列（WAITING_TAKEOVER）的会话一律跳过——一条新入站消息不该覆盖坐席正在服务的会话。
 *   <li><b>不拖累主流程</b>：检索未启用、无命中、端点异常统统静默跳过，绝不让 AI 这条
 *       旁路把消息入库带崩。这是旁路该有的样子。
 * </ol>
 */
@Service
public class AiReplyService {

    private static final Logger log = LoggerFactory.getLogger(AiReplyService.class);
    private static final String AI = "AI";

    /**
     * 出建议的置信度门限。默认定得偏高：错答案比没答案伤害大得多，
     * 宁可漏出建议让人自己搜，也不要给坐席一个看着像样但不对的答案。
     */
    private static final float SUGGESTION_THRESHOLD = 0.6f;
    private static final int SUGGESTION_TOP_K = 1;

    private final ChatConversationMapper conversationMapper;
    private final AiPersonaMapper personaMapper;
    private final KnowledgeSearchService searchService;

    public AiReplyService(ChatConversationMapper conversationMapper, AiPersonaMapper personaMapper,
                          KnowledgeSearchService searchService) {
        this.conversationMapper = conversationMapper;
        this.personaMapper = personaMapper;
        this.searchService = searchService;
    }

    /**
     * 尝试为会话产出 AI 建议。
     *
     * @return 是否产出了建议（未产出时调用方无需任何处理）
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean suggestIfAi(Long tenantId, Long conversationId, String inboundBody) {
        // 旁路：任何异常都不该把「消息入库」这个正事带崩
        try {
            return doSuggest(tenantId, conversationId, inboundBody);
        } catch (RuntimeException e) {
            log.warn("AI 建议生成失败（已跳过）conversationId={}", conversationId, e);
            return false;
        }
    }

    private boolean doSuggest(Long tenantId, Long conversationId, String inboundBody) {
        if (inboundBody == null || inboundBody.isBlank()) {
            return false;
        }
        // 检索未启用时不产出，但也不报错——这是配置问题，不是本次消息的问题
        if (!searchService.available()) {
            return false;
        }
        ChatConversation conv = conversationMapper.selectOne(new LambdaQueryWrapper<ChatConversation>()
            .eq(ChatConversation::getId, conversationId)
            .eq(ChatConversation::getTenantId, tenantId)
            .last("LIMIT 1"));
        if (conv == null) {
            return false;
        }
        // 只在 AI 态产出：不抢坐席，也不动已在队列的会话
        if (!AI.equals(conv.getHandlingStatus())) {
            return false;
        }

        List<KnowledgeSearchService.Hit> hits = searchService.search(
            tenantId, inboundBody, SUGGESTION_TOP_K, SUGGESTION_THRESHOLD,
            conv.getAiPersonaId() == null ? null : roleIdOfPersona(tenantId, conv.getAiPersonaId()),
            null);
        if (hits.isEmpty()) {
            return false;
        }
        KnowledgeSearchService.Hit best = hits.get(0);
        conversationMapper.update(null, new LambdaUpdateWrapper<ChatConversation>()
            .eq(ChatConversation::getId, conversationId)
            .eq(ChatConversation::getTenantId, tenantId)
            // 状态可能在这期间被坐席接管了，update 里再钉一次 AI 态，避免覆盖坐席
            .eq(ChatConversation::getHandlingStatus, AI)
            .set(ChatConversation::getAiSuggestion, best.qa().getAnswer())
            .set(ChatConversation::getAiSuggestionScore, best.score())
            .set(ChatConversation::getAiSuggestionQaId, best.qa().getId()));
        log.info("AI 建议已生成 conversationId={} score={} qaId={}",
            conversationId, best.score(), best.qa().getId());
        return true;
    }

    /**
     * 会话绑定的人设 → 该人设所属角色 id，用于把检索收窄到对应角色的知识。
     * 查不到人设/角色时返回 null（=不按角色过滤，走全租户通用知识）。
     */
    private Long roleIdOfPersona(Long tenantId, Long personaId) {
        AiPersona persona = personaMapper.selectById(personaId);
        if (persona == null || !tenantId.equals(persona.getTenantId())) {
            return null;
        }
        return persona.getRoleId();
    }

    /** 坐席确认或否决后清掉建议，避免陈旧建议一直挂在接管台上。 */
    @Transactional
    public void clearSuggestion(Long tenantId, Long conversationId) {
        conversationMapper.update(null, new LambdaUpdateWrapper<ChatConversation>()
            .eq(ChatConversation::getId, conversationId)
            .eq(ChatConversation::getTenantId, tenantId)
            .set(ChatConversation::getAiSuggestion, (String) null)
            .set(ChatConversation::getAiSuggestionScore, (Float) null)
            .set(ChatConversation::getAiSuggestionQaId, (Long) null));
    }
}
