package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.KnowledgeQaService;
import com.smartscrm.server.service.ai.KnowledgeSearchService;
import com.smartscrm.server.web.vo.KnowledgeQaVO;
import com.smartscrm.server.web.vo.KnowledgeSearchHitVO;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
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
    private final KnowledgeSearchService searchService;

    public KnowledgeQaController(KnowledgeQaService service, KnowledgeSearchService searchService) {
        this.service = service;
        this.searchService = searchService;
    }

    public record QaRequest(@NotBlank String question, @NotBlank String answer,
                            Long roleId, Long categoryId, Integer status) {}
    /** 人工确认后的派生 QA：锚回分片，source 固定 derived。 */
    public record DerivedQaRequest(@NotBlank String question, @NotBlank String answer,
                                   Long roleId, Long categoryId) {}

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

    /** 人工确认派生候选 → 落库（source=derived，锚回分片）。预览在前端做，这里只落确认结果。 */
    @PostMapping("/derived")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<KnowledgeQaVO> createDerived(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @RequestParam Long chunkId,
                                                    @RequestBody DerivedQaRequest req) {
        return ApiResponse.ok(KnowledgeQaVO.of(service.createDerived(principal.tenantId(), chunkId,
            req.roleId(), req.categoryId(), req.question(), req.answer())));
    }

    // ---- 向量检索（read 权限，与列出同码）----

    /** 检索可用性与当前模型，供前端决定要不要显示检索入口。 */
    public record SearchCapabilityVO(Boolean available, String model) {}

    /**
     * 知识库向量检索。需先调用 {@code /search-index} 建过索引，否则返回空列表
     * （空列表代表"没召回到"，与"端点未配置"是两回事——后者会直接抛 40905）。
     */
    @GetMapping("/search")
    @PreAuthorize("hasAuthority('knowledge:read')")
    public ApiResponse<List<KnowledgeSearchHitVO>> search(@AuthenticationPrincipal AuthPrincipal principal,
                                                          @RequestParam String q,
                                                          @RequestParam(required = false) Integer topK,
                                                          @RequestParam(required = false) Float threshold,
                                                          @RequestParam(required = false) Long roleId,
                                                          @RequestParam(required = false) Long categoryId) {
        return ApiResponse.ok(searchService.search(principal.tenantId(), q, topK, threshold, roleId, categoryId)
            .stream().map(KnowledgeSearchHitVO::of).toList());
    }

    /** 检索是否可用（embedding 端点是否配置）。 */
    @GetMapping("/search/capability")
    @PreAuthorize("hasAuthority('knowledge:read')")
    public ApiResponse<SearchCapabilityVO> searchCapability() {
        return ApiResponse.ok(new SearchCapabilityVO(searchService.available(), searchService.model()));
    }

    /**
     * 构建/刷新本租户的检索索引：把启用中的 QA 重新向量化。
     * 内容与模型都没变的会自动跳过，可安全重复调用。
     */
    @PostMapping("/search-index")
    @PreAuthorize("hasAuthority('knowledge:write')")
    public ApiResponse<Map<String, Object>> buildIndex(@AuthenticationPrincipal AuthPrincipal principal) {
        int n = searchService.buildIndex(principal.tenantId());
        return ApiResponse.ok(Map.of("indexed", n, "model", searchService.model()));
    }
}