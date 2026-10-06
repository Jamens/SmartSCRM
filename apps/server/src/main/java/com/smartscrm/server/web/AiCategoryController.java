package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AiCategoryService;
import com.smartscrm.server.web.vo.AiCategoryVO;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** B28 AI 分类（租户取自 JWT）。A16：读=knowledge:read / 写=knowledge:write。 */
@RestController
@RequestMapping("/api/ai-categories")
public class AiCategoryController {

    private final AiCategoryService service;

    public AiCategoryController(AiCategoryService service) {
        this.service = service;
    }

    public record CategoryRequest(@NotBlank String name, Integer sort) {}

    @GetMapping
    @PreAuthorize("hasAuthority('knowledge:read')")
    public ApiResponse<List<AiCategoryVO>> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.list(principal.tenantId()).stream().map(AiCategoryVO::of).toList());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<AiCategoryVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                            @RequestBody CategoryRequest req) {
        return ApiResponse.ok(AiCategoryVO.of(service.create(principal.tenantId(), req.name(), req.sort())));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<AiCategoryVO> update(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id,
                                            @RequestBody CategoryRequest req) {
        return ApiResponse.ok(AiCategoryVO.of(service.update(principal.tenantId(), id, req.name(), req.sort())));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
