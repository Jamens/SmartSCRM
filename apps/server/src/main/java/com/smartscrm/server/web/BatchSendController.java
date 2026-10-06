package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.BatchSendService;
import com.smartscrm.server.web.dto.BatchPreviewDTO;
import com.smartscrm.server.web.dto.BatchRecallReportsDTO;
import com.smartscrm.server.web.dto.BatchRecallRequestDTO;
import com.smartscrm.server.web.dto.BatchReportsDTO;
import com.smartscrm.server.web.dto.BatchRetryDTO;
import com.smartscrm.server.web.dto.BatchTaskCreateDTO;
import com.smartscrm.server.web.vo.BatchCreateVO;
import com.smartscrm.server.web.vo.BatchDetailVO;
import com.smartscrm.server.web.vo.BatchPreviewVO;
import com.smartscrm.server.web.vo.BatchRecallVO;
import com.smartscrm.server.web.vo.BatchReportsResultVO;
import com.smartscrm.server.web.vo.BatchTaskVO;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
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
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<BatchCreateVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                             @Valid @RequestBody BatchTaskCreateDTO dto) {
        return ApiResponse.ok(service.create(principal.tenantId(), dto));
    }

    @GetMapping("/tasks")
    @PreAuthorize("hasAuthority('broadcast:read')")
    public ApiResponse<PageResult<BatchTaskVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(service.pageTasks(principal.tenantId(), status, page, size));
    }

    @GetMapping("/tasks/{id}")
    @PreAuthorize("hasAuthority('broadcast:read')")
    public ApiResponse<BatchTaskVO> one(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable long id) {
        return ApiResponse.ok(service.task(principal.tenantId(), id));
    }

    @GetMapping("/tasks/{id}/details")
    @PreAuthorize("hasAuthority('broadcast:read')")
    public ApiResponse<PageResult<BatchDetailVO>> details(@AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable long id,
            @RequestParam(required = false) String sendStatus,
            @RequestParam(required = false) String recallStatus,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ApiResponse.ok(service.pageDetails(principal.tenantId(), id, sendStatus, recallStatus, page, size));
    }

    @PostMapping("/preview")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<BatchPreviewVO> preview(@AuthenticationPrincipal AuthPrincipal principal,
                                               @Valid @RequestBody BatchPreviewDTO dto) {
        return ApiResponse.ok(service.preview(dto));
    }

    @PostMapping("/tasks/{id}/start")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<BatchReportsResultVO> start(@AuthenticationPrincipal AuthPrincipal principal,
                                                   @PathVariable long id) {
        return ApiResponse.ok(service.transition(principal.tenantId(), id, "start"));
    }

    @PostMapping("/tasks/{id}/pause")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<BatchReportsResultVO> pause(@AuthenticationPrincipal AuthPrincipal principal,
                                                   @PathVariable long id) {
        return ApiResponse.ok(service.transition(principal.tenantId(), id, "pause"));
    }

    @PostMapping("/tasks/{id}/resume")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<BatchReportsResultVO> resume(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable long id) {
        return ApiResponse.ok(service.transition(principal.tenantId(), id, "resume"));
    }

    @PostMapping("/tasks/{id}/cancel")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<BatchReportsResultVO> cancel(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable long id) {
        return ApiResponse.ok(service.transition(principal.tenantId(), id, "cancel"));
    }

    /** 只回"有没有跳上"，不回新时刻：引擎自己知道墙上时间，心跳的权威读数在 GET /tasks/{id}。 */
    @PostMapping("/tasks/{id}/heartbeat")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<Map<String, Object>> heartbeat(@AuthenticationPrincipal AuthPrincipal principal,
                                                      @PathVariable long id) {
        return ApiResponse.ok(Map.of("updated", service.heartbeat(principal.tenantId(), id)));
    }

    @PostMapping("/tasks/{id}/reports")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<BatchReportsResultVO> reports(@AuthenticationPrincipal AuthPrincipal principal,
                                                     @PathVariable long id,
                                                     @Valid @RequestBody BatchReportsDTO dto) {
        return ApiResponse.ok(service.reports(principal.tenantId(), id, dto));
    }

    /**
     * 一条端点两种粒度（R11）：不带 body（或 detailIds 为空）＝整批复位＝spec §5 的 retry-failed 原语义；
     * 带 detailIds＝只复位勾选的那几条＝spec §7 的单条重发。
     */
    @PostMapping("/tasks/{id}/retry-failed")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<Map<String, Object>> retryFailed(@AuthenticationPrincipal AuthPrincipal principal,
                                                        @PathVariable long id,
                                                        @RequestBody(required = false) BatchRetryDTO dto) {
        return ApiResponse.ok(service.retryFailed(principal.tenantId(), id,
                dto == null ? null : dto.getDetailIds()));
    }

    @PostMapping("/tasks/{id}/recall")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<BatchRecallVO> recall(@AuthenticationPrincipal AuthPrincipal principal,
                                             @PathVariable long id,
                                             @Valid @RequestBody BatchRecallRequestDTO dto) {
        return ApiResponse.ok(service.recall(principal.tenantId(), id, dto.getDetailIds()));
    }

    @PostMapping("/tasks/{id}/recall-reports")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<Map<String, Object>> recallReports(@AuthenticationPrincipal AuthPrincipal principal,
                                                          @PathVariable long id,
                                                          @Valid @RequestBody BatchRecallReportsDTO dto) {
        return ApiResponse.ok(Map.of("settled", service.recallReports(principal.tenantId(), id, dto)));
    }

    /** 启动时一次，什么都不传；租户从 token 来，所以驱动换号就能验到隔离。 */
    @PostMapping("/reconcile")
    @PreAuthorize("hasAuthority('broadcast:write')")
    public ApiResponse<Map<String, Object>> reconcile(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.reconcile(principal.tenantId()));
    }
}
