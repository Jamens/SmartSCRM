package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.MaterialGroup;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.MaterialService;
import com.smartscrm.server.web.dto.MaterialGroupRequest;
import com.smartscrm.server.web.dto.MaterialRequest;
import com.smartscrm.server.web.vo.MaterialGroupVO;
import com.smartscrm.server.web.vo.MaterialVO;
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
public class MaterialController {

    private final MaterialService service;

    public MaterialController(MaterialService service) {
        this.service = service;
    }

    @GetMapping("/material-groups")
    public ApiResponse<List<MaterialGroupVO>> listGroups(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.listGroups(principal.tenantId()));
    }

    @PostMapping("/material-groups")
    public ApiResponse<MaterialGroup> createGroup(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @Valid @RequestBody MaterialGroupRequest req) {
        return ApiResponse.ok(service.createGroup(principal.tenantId(), req));
    }

    @PutMapping("/material-groups/{id}")
    public ApiResponse<MaterialGroup> updateGroup(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @PathVariable Long id,
                                                  @Valid @RequestBody MaterialGroupRequest req) {
        return ApiResponse.ok(service.updateGroup(principal.tenantId(), id, req));
    }

    @DeleteMapping("/material-groups/{id}")
    public ApiResponse<Void> deleteGroup(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.deleteGroup(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }

    @GetMapping("/materials")
    public ApiResponse<List<MaterialVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
                                              @RequestParam(required = false) Long groupId,
                                              @RequestParam(required = false) Integer type,
                                              @RequestParam(required = false) String keyword) {
        return ApiResponse.ok(service.list(principal.tenantId(), groupId, type, keyword));
    }

    @PostMapping("/materials")
    public ApiResponse<MaterialVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                          @Valid @RequestBody MaterialRequest req) {
        return ApiResponse.ok(service.create(principal.tenantId(), req));
    }

    @PutMapping("/materials/{id}")
    public ApiResponse<MaterialVO> update(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable Long id,
                                          @Valid @RequestBody MaterialRequest req) {
        return ApiResponse.ok(service.update(principal.tenantId(), id, req));
    }

    @DeleteMapping("/materials/{id}")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
