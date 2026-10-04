package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.MessageQueryService;
import com.smartscrm.server.service.TakeoverService;
import com.smartscrm.server.web.dto.ConversationLinkCustomerDTO;
import com.smartscrm.server.web.vo.ConversationPageVO;
import com.smartscrm.server.web.vo.ConversationVO;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/conversations")
public class ConversationController {

    private final MessageQueryService query;
    private final TakeoverService takeover;

    public ConversationController(MessageQueryService query, TakeoverService takeover) {
        this.query = query;
        this.takeover = takeover;
    }

    @GetMapping
    public ApiResponse<ConversationPageVO> list(@AuthenticationPrincipal AuthPrincipal principal,
                                               @RequestParam(required = false) Long accountId,
                                               @RequestParam(required = false) String platform,
                                               @RequestParam(required = false) String q,
                                               @RequestParam(required = false) String cursor,
                                               @RequestParam(required = false) Integer size,
                                               @RequestParam(required = false) String handlingStatus) {
        return ApiResponse.ok(query.conversations(principal.tenantId(), accountId, platform, q, cursor, size,
            handlingStatus));
    }

    /** B28 P1 接管队列：本租户所有等待接管的会话，按等待时长升序。 */
    @GetMapping("/takeover-queue")
    public ApiResponse<List<ConversationVO>> takeoverQueue(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(takeover.queue(principal.tenantId()));
    }

    /** 坐席接管：AI / WAITING_TAKEOVER → HUMAN_ACTIVE（assignee = 当前坐席）。 */
    @PostMapping("/{id}/takeover")
    public ApiResponse<ConversationVO> takeover(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable Long id) {
        return ApiResponse.ok(takeover.takeover(principal.tenantId(), principal.userId(), id));
    }

    /** 恢复 AI：HUMAN_ACTIVE / WAITING_TAKEOVER → AI，交还给 AI 人设引擎。 */
    @PostMapping("/{id}/resume-ai")
    public ApiResponse<ConversationVO> resumeAi(@AuthenticationPrincipal AuthPrincipal principal,
                                                @PathVariable Long id) {
        return ApiResponse.ok(takeover.resumeAi(principal.tenantId(), id));
    }

    /** 转人工：→ WAITING_TAKEOVER。reason 可选，描述触发来源（规则名或坐席手动）。 */
    @PostMapping("/{id}/transfer-human")
    public ApiResponse<ConversationVO> transferHuman(@AuthenticationPrincipal AuthPrincipal principal,
                                                     @PathVariable Long id,
                                                     @RequestParam(required = false) String reason) {
        return ApiResponse.ok(takeover.transferHuman(principal.tenantId(), id, reason));
    }

    /**
     * 清零该会话未读。
     * <p>
     * `cleared` 是**匹配行数**而不是**改变行数**（Connector/J 默认 `useAffectedRows=false`，
     * 命中 WHERE 的行即计数，值没变也算）：对一条本来就未读为 0 的会话再打这里仍回 `{cleared:1}`。
     * 读侧不要拿它当"确实清掉了什么"来分支，要判断状态就重新读列表里的 `unreadCount`。
     */
    @PostMapping("/{id}/read")
    public ApiResponse<Map<String, Integer>> read(@AuthenticationPrincipal AuthPrincipal principal,
                                                 @PathVariable Long id) {
        query.requireOwned(principal.tenantId(), id);
        return ApiResponse.ok(Map.of("cleared", query.markRead(principal.tenantId(), id)));
    }

    /** 运维兜底：会话头是投影，怀疑它错了就按消息重算。UI 不暴露（spec §7）。 */
    @PostMapping("/{id}/replay-head")
    public ApiResponse<ConversationVO> replayHead(@AuthenticationPrincipal AuthPrincipal principal,
                                                 @PathVariable Long id) {
        return ApiResponse.ok(query.replayHead(principal.tenantId(), id));
    }

    /** 建客户与回填历史是两步，不隐式耦合（spec §6）：这里只做"把本会话历史归到某客户"。 */
    @PostMapping("/{id}/link-customer")
    public ApiResponse<Map<String, Object>> linkCustomer(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @PathVariable Long id,
                                                         @Valid @RequestBody ConversationLinkCustomerDTO dto) {
        return ApiResponse.ok(query.linkCustomer(principal.tenantId(), id, dto.customerId()));
    }
}
