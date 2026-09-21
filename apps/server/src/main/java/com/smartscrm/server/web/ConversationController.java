package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.MessageQueryService;
import com.smartscrm.server.web.dto.ConversationLinkCustomerDTO;
import com.smartscrm.server.web.vo.ConversationPageVO;
import com.smartscrm.server.web.vo.ConversationVO;
import jakarta.validation.Valid;
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

    public ConversationController(MessageQueryService query) {
        this.query = query;
    }

    @GetMapping
    public ApiResponse<ConversationPageVO> list(@AuthenticationPrincipal AuthPrincipal principal,
                                               @RequestParam(required = false) Long accountId,
                                               @RequestParam(required = false) String platform,
                                               @RequestParam(required = false) String q,
                                               @RequestParam(required = false) String cursor,
                                               @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(query.conversations(principal.tenantId(), accountId, platform, q, cursor, size));
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
