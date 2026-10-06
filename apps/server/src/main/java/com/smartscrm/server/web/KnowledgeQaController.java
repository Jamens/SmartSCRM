package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.KnowledgeQaService;
import com.smartscrm.server.web.vo.KnowledgeQaVO;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** B28 知识库 QA（租户取自 JWT）。A16：读=knowledge:read / 写=knowledge:write。 */
@RestController
@RequestMapping("/api/knowledge-qa")
public class KnowledgeQaController {

    private final KnowledgeQaService service;

    public KnowledgeQaController(KnowledgeQaService service) {
        this.service = service;
    }

    public record QaRequest(@NotBlank String question, @NotBlank String answer,
                            Long roleId, Long categoryId, Integer status) {}

    @GetMapping
    @PreAuthorize("hasAuthority('knowledge:read')")
    public ApiResponse<List<KnowledgeQaVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
                                                 @RequestParam(required = false) Long roleId,
                                                 @RequestParam(required = false) Long categoryId,
                                                 @RequestParam(required = false) Integer status) {
        return ApiResponse.ok(service.list(principal.tenantId(), roleId, categoryId, status)
            .stream().map(KnowledgeQaVO::of).toList());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<KnowledgeQaVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                             @RequestBody QaRequest req) {
        return ApiResponse.ok(KnowledgeQaVO.of(service.create(principal.tenantId(), req.roleId(),
            req.categoryId(), req.question(), req.answer(), req.status())));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<KnowledgeQaVO> update(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id,
                                             @RequestBody QaRequest req) {
        return ApiResponse.ok(KnowledgeQaVO.of(service.update(principal.tenantId(), id, req.roleId(),
            req.categoryId(), req.question(), req.answer(), req.status())));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
