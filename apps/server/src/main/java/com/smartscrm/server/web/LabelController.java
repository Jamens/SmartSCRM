package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.LabelGroup;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.LabelService;
import com.smartscrm.server.web.dto.LabelGroupRequest;
import com.smartscrm.server.web.dto.LabelRequest;
import com.smartscrm.server.web.vo.LabelGroupVO;
import com.smartscrm.server.web.vo.LabelVO;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class LabelController {

    private final LabelService service;

    public LabelController(LabelService service) {
        this.service = service;
    }

    @GetMapping("/label-groups")
    public ApiResponse<List<LabelGroupVO>> tree(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.tree(principal.tenantId()));
    }

    @PostMapping("/label-groups")
    public ApiResponse<LabelGroup> createGroup(@AuthenticationPrincipal AuthPrincipal principal,
                                               @Valid @RequestBody LabelGroupRequest req) {
        return ApiResponse.ok(service.createGroup(principal.tenantId(), req));
    }

    @PutMapping("/label-groups/{id}")
    public ApiResponse<LabelGroup> updateGroup(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable Long id,
                                               @Valid @RequestBody LabelGroupRequest req) {
        return ApiResponse.ok(service.updateGroup(principal.tenantId(), id, req));
    }

    @DeleteMapping("/label-groups/{id}")
    public ApiResponse<Void> deleteGroup(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.deleteGroup(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }

    @PostMapping("/label-groups/{groupId}/labels")
    public ApiResponse<LabelVO> createLabel(@AuthenticationPrincipal AuthPrincipal principal,
                                            @PathVariable Long groupId,
                                            @Valid @RequestBody LabelRequest req) {
        return ApiResponse.ok(service.createLabel(principal.tenantId(), groupId, req));
    }

    @PutMapping("/labels/{id}")
    public ApiResponse<LabelVO> updateLabel(@AuthenticationPrincipal AuthPrincipal principal,
                                            @PathVariable Long id,
                                            @Valid @RequestBody LabelRequest req) {
        return ApiResponse.ok(service.updateLabel(principal.tenantId(), id, req));
    }

    @DeleteMapping("/labels/{id}")
    public ApiResponse<Void> deleteLabel(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.deleteLabel(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
