package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.MessageQueryService;
import com.smartscrm.server.service.MessageService;
import com.smartscrm.server.web.dto.MessageBatchDTO;
import com.smartscrm.server.web.dto.MessageStatusDTO;
import com.smartscrm.server.web.vo.BatchAcceptVO;
import com.smartscrm.server.web.vo.MessagePageVO;
import com.smartscrm.server.web.vo.MessageSearchVO;
import com.smartscrm.server.web.vo.MessageStatsVO;
import com.smartscrm.server.web.vo.UnreadTotalVO;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/messages")
public class MessageController {

    private final MessageService service;
    private final MessageQueryService query;

    public MessageController(MessageService service, MessageQueryService query) {
        this.service = service;
        this.query = query;
    }

    @PostMapping("/batch")
    public ApiResponse<BatchAcceptVO> batch(@AuthenticationPrincipal AuthPrincipal principal,
                                            @Valid @RequestBody MessageBatchDTO dto) {
        return ApiResponse.ok(service.accept(principal.tenantId(), dto));
    }

    @PostMapping("/status")
    public ApiResponse<Map<String, Integer>> status(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @Valid @RequestBody MessageStatusDTO dto) {
        return ApiResponse.ok(Map.of("updated", service.applyStatus(principal.tenantId(), dto)));
    }

    @GetMapping
    public ApiResponse<MessagePageVO> list(@AuthenticationPrincipal AuthPrincipal principal,
                                           @RequestParam Long accountId,
                                           @RequestParam String chatKey,
                                           @RequestParam(required = false) String before,
                                           @RequestParam(required = false) Long around,
                                           @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(query.messages(principal.tenantId(), accountId, chatKey, before, around, size));
    }

    @GetMapping("/search")
    public ApiResponse<MessageSearchVO> search(@AuthenticationPrincipal AuthPrincipal principal,
                                               @RequestParam String q,
                                               @RequestParam(required = false) Long accountId,
                                               @RequestParam(required = false) String platform,
                                               @RequestParam(required = false) String direction,
                                               @RequestParam(required = false) String from,
                                               @RequestParam(required = false) String to,
                                               @RequestParam(required = false) Long customerId,
                                               @RequestParam(required = false) String cursor,
                                               @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(query.search(principal.tenantId(), q, accountId, platform, direction,
            from, to, customerId, cursor, size));
    }

    @GetMapping("/stats")
    public ApiResponse<MessageStatsVO> stats(@AuthenticationPrincipal AuthPrincipal principal,
                                            @RequestParam Long accountId,
                                            @RequestParam(required = false) Integer days) {
        return ApiResponse.ok(query.stats(principal.tenantId(), accountId, days));
    }

    /** 租户级未读汇总：不带 accountId，任务栏角标要的是"这个应用总共有多少没读的"。 */
    @GetMapping("/unread-total")
    public ApiResponse<UnreadTotalVO> unreadTotal(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(query.unreadTotal(principal.tenantId()));
    }
}
