package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.QuickReplyGroup;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.QuickReplyService;
import com.smartscrm.server.web.dto.QuickReplyGroupRequest;
import com.smartscrm.server.web.dto.QuickReplyRequest;
import com.smartscrm.server.web.vo.QuickReplyGroupVO;
import com.smartscrm.server.web.vo.QuickReplyVO;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class QuickReplyController {

    private final QuickReplyService service;

    public QuickReplyController(QuickReplyService service) {
        this.service = service;
    }

    @GetMapping("/quick-reply-groups")
    public ApiResponse<List<QuickReplyGroupVO>> listGroups(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.listGroups(principal.tenantId()));
    }

    @PostMapping("/quick-reply-groups")
    public ApiResponse<QuickReplyGroup> createGroup(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @Valid @RequestBody QuickReplyGroupRequest req) {
        return ApiResponse.ok(service.createGroup(principal.tenantId(), req));
    }

    @PutMapping("/quick-reply-groups/{id}")
    public ApiResponse<QuickReplyGroup> updateGroup(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable Long id,
                                                    @Valid @RequestBody QuickReplyGroupRequest req) {
        return ApiResponse.ok(service.updateGroup(principal.tenantId(), id, req));
    }

    @DeleteMapping("/quick-reply-groups/{id}")
    public ApiResponse<Void> deleteGroup(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.deleteGroup(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }

    @GetMapping("/quick-replies")
    public ApiResponse<List<QuickReplyVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
                                                @RequestParam(required = false) Long groupId,
                                                @RequestParam(required = false) String keyword) {
        return ApiResponse.ok(service.list(principal.tenantId(), groupId, keyword));
    }

    @GetMapping("/quick-replies/{id}")
    public ApiResponse<QuickReplyVO> detail(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        return ApiResponse.ok(service.detail(principal.tenantId(), id));
    }

    @PostMapping("/quick-replies")
    public ApiResponse<QuickReplyVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                            @Valid @RequestBody QuickReplyRequest req) {
        return ApiResponse.ok(service.create(principal.tenantId(), req));
    }

    @PutMapping("/quick-replies/{id}")
    public ApiResponse<QuickReplyVO> update(@AuthenticationPrincipal AuthPrincipal principal,
                                            @PathVariable Long id,
                                            @Valid @RequestBody QuickReplyRequest req) {
        return ApiResponse.ok(service.update(principal.tenantId(), id, req));
    }

    @DeleteMapping("/quick-replies/{id}")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }

    @PostMapping("/quick-replies/{id}/use")
    public ApiResponse<QuickReplyVO> recordUse(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable Long id) {
        return ApiResponse.ok(service.recordUse(principal.tenantId(), id));
    }
}
