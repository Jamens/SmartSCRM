package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.MessageQueryService;
import com.smartscrm.server.web.vo.ConversationPageVO;
import com.smartscrm.server.web.vo.ConversationVO;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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
}
