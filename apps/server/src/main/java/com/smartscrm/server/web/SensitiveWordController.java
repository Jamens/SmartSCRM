package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.SensitiveWordService;
import com.smartscrm.server.web.dto.SensitiveWordCheckRequest;
import com.smartscrm.server.web.dto.SensitiveWordCreateRequest;
import com.smartscrm.server.web.dto.SensitiveWordToggleRequest;
import com.smartscrm.server.web.vo.SensitiveWordVO;
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

/**
 * A8 敏感词风控（租户本地库）。租户取自 JWT。命中检测 {@code POST /check} 是给发送/入站
 * 链预留的判定入口——具体动作（提示/拦截）由调用方决定。
 */
@RestController
@RequestMapping("/api/sensitive-words")
public class SensitiveWordController {

    private final SensitiveWordService service;

    public SensitiveWordController(SensitiveWordService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<SensitiveWordVO>> list(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.list(principal.tenantId()).stream().map(SensitiveWordVO::of).toList());
    }

    @PostMapping
    public ApiResponse<SensitiveWordVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                               @Valid @RequestBody SensitiveWordCreateRequest req) {
        return ApiResponse.ok(SensitiveWordVO.of(
            service.create(principal.tenantId(), req.word(), req.category())));
    }

    @PutMapping("/{id}")
    public ApiResponse<Void> setEnabled(@AuthenticationPrincipal AuthPrincipal principal,
                                        @PathVariable Long id,
                                        @RequestBody SensitiveWordToggleRequest req) {
        service.setEnabled(principal.tenantId(), id, Boolean.TRUE.equals(req.enabled()));
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }

    /** 命中检测：返回命中的敏感词列表，空列表 = 未命中。 */
    @PostMapping("/check")
    public ApiResponse<List<String>> check(@AuthenticationPrincipal AuthPrincipal principal,
                                           @RequestBody SensitiveWordCheckRequest req) {
        return ApiResponse.ok(service.match(principal.tenantId(), req.text()));
    }
}
