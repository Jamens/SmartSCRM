package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.MessageService;
import com.smartscrm.server.web.dto.MessageBatchDTO;
import com.smartscrm.server.web.dto.MessageStatusDTO;
import com.smartscrm.server.web.vo.BatchAcceptVO;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/messages")
public class MessageController {

    private final MessageService service;

    public MessageController(MessageService service) {
        this.service = service;
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
}
