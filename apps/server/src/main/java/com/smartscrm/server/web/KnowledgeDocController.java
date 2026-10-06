package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.KnowledgeDocService;
import com.smartscrm.server.web.vo.KnowledgeChunkVO;
import com.smartscrm.server.web.vo.KnowledgeDocVO;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * B28 知识库文档（租户取自 JWT）。A16：读=knowledge:read / 写=knowledge:write。
 * 上传正文即同步切成片；分片只作预览素材，**派生 QA 不在此自动落库**（spec §8）。
 */
@RestController
@RequestMapping("/api/knowledge-docs")
public class KnowledgeDocController {

    private final KnowledgeDocService service;

    public KnowledgeDocController(KnowledgeDocService service) {
        this.service = service;
    }

    public record DocRequest(@NotBlank String name, String sourceType, String content) {}

    @GetMapping
    @PreAuthorize("hasAuthority('knowledge:read')")
    public ApiResponse<List<KnowledgeDocVO>> list(@AuthenticationPrincipal AuthPrincipal principal) {
        Long t = principal.tenantId();
        return ApiResponse.ok(service.list(t).stream()
            .map(d -> KnowledgeDocVO.of(d, service.listChunks(t, d.getId()).size())).toList());
    }

    @GetMapping("/{id}/chunks")
    @PreAuthorize("hasAuthority('knowledge:read')")
    public ApiResponse<List<KnowledgeChunkVO>> chunks(@AuthenticationPrincipal AuthPrincipal principal,
                                                     @PathVariable Long id) {
        return ApiResponse.ok(service.listChunks(principal.tenantId(), id)
            .stream().map(KnowledgeChunkVO::of).toList());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<KnowledgeDocVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                              @RequestBody DocRequest req) {
        Long t = principal.tenantId();
        var d = service.create(t, req.name(), req.sourceType(), req.content());
        return ApiResponse.ok(KnowledgeDocVO.of(d, service.listChunks(t, d.getId()).size()));
    }

    @PostMapping("/{id}/parse")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<KnowledgeDocVO> parse(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        Long t = principal.tenantId();
        var d = service.parse(t, id);
        return ApiResponse.ok(KnowledgeDocVO.of(d, service.listChunks(t, d.getId()).size()));
    }

    @PostMapping("/{id}/disable")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<KnowledgeDocVO> disable(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        Long t = principal.tenantId();
        return ApiResponse.ok(KnowledgeDocVO.of(service.disable(t, id), service.listChunks(t, id).size()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }
}
