package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AiPersonaService;
import com.smartscrm.server.web.vo.AiPersonaVO;
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

/** B28 AI 人设（租户取自 JWT）。A16：读=knowledge:read / 写=knowledge:write。 */
@RestController
@RequestMapping("/api/ai-personas")
public class AiPersonaController {

    private final AiPersonaService service;

    public AiPersonaController(AiPersonaService service) {
        this.service = service;
    }

    public record PersonaRequest(@NotBlank String name, Long roleId, String tone, String prompt,
                                 String template, Integer enabled) {}
    /** 助手草稿（未落库）：人工确认后再 POST /ai-personas。 */
    public record DraftVO(String template, String name, String tone, String prompt) {}

    @GetMapping
    @PreAuthorize("hasAuthority('knowledge:read')")
    public ApiResponse<List<AiPersonaVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
                                               @RequestParam(required = false) Long roleId) {
        return ApiResponse.ok(service.list(principal.tenantId(), roleId).stream().map(AiPersonaVO::of).toList());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<AiPersonaVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                           @RequestBody PersonaRequest req) {
        return ApiResponse.ok(AiPersonaVO.of(service.create(principal.tenantId(), req.roleId(), req.name(),
            req.tone(), req.prompt(), req.template(), req.enabled())));
    }

    /** 人设助手：按语气标签套模板产**草稿**（不落库、不调外部模型）。 */
    @PostMapping("/generate")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<DraftVO> generate(@RequestParam(required = false) String tone) {
        var d = service.generateDraft(tone);
        return ApiResponse.ok(new DraftVO(d.template(), d.name(), d.tone(), d.prompt()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<AiPersonaVO> update(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id,
                                           @RequestBody PersonaRequest req) {
        return ApiResponse.ok(AiPersonaVO.of(service.update(principal.tenantId(), id, req.roleId(), req.name(),
            req.tone(), req.prompt(), req.template(), req.enabled())));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
