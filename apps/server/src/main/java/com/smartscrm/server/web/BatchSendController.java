package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.BatchSendService;
import com.smartscrm.server.web.dto.BatchPreviewDTO;
import com.smartscrm.server.web.dto.BatchTaskCreateDTO;
import com.smartscrm.server.web.vo.BatchCreateVO;
import com.smartscrm.server.web.vo.BatchDetailVO;
import com.smartscrm.server.web.vo.BatchPreviewVO;
import com.smartscrm.server.web.vo.BatchTaskVO;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/batch-send")
public class BatchSendController {

    private final BatchSendService service;

    public BatchSendController(BatchSendService service) {
        this.service = service;
    }

    @PostMapping("/tasks")
    public ApiResponse<BatchCreateVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                             @Valid @RequestBody BatchTaskCreateDTO dto) {
        return ApiResponse.ok(service.create(principal.tenantId(), dto));
    }

    @GetMapping("/tasks")
    public ApiResponse<PageResult<BatchTaskVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(service.pageTasks(principal.tenantId(), status, page, size));
    }

    @GetMapping("/tasks/{id}")
    public ApiResponse<BatchTaskVO> one(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable long id) {
        return ApiResponse.ok(service.task(principal.tenantId(), id));
    }

    @GetMapping("/tasks/{id}/details")
    public ApiResponse<PageResult<BatchDetailVO>> details(@AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable long id,
            @RequestParam(required = false) String sendStatus,
            @RequestParam(required = false) String recallStatus,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ApiResponse.ok(service.pageDetails(principal.tenantId(), id, sendStatus, recallStatus, page, size));
    }

    @PostMapping("/preview")
    public ApiResponse<BatchPreviewVO> preview(@AuthenticationPrincipal AuthPrincipal principal,
                                               @Valid @RequestBody BatchPreviewDTO dto) {
        return ApiResponse.ok(service.preview(dto));
    }
}
