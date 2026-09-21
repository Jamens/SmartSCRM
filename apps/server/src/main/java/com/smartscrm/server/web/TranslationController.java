package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.TranslationService;
import com.smartscrm.server.web.dto.CredentialTestDTO;
import com.smartscrm.server.web.dto.TranslateDTO;
import com.smartscrm.server.web.dto.TranslationCredentialInput;
import com.smartscrm.server.web.dto.TranslationSettingInput;
import com.smartscrm.server.web.vo.CredentialTestVO;
import com.smartscrm.server.web.vo.ServerDelayVO;
import com.smartscrm.server.web.vo.TranslateVO;
import com.smartscrm.server.web.vo.TranslationCacheStatsVO;
import com.smartscrm.server.web.vo.TranslationCredentialVO;
import com.smartscrm.server.web.vo.TranslationNodeVO;
import com.smartscrm.server.web.vo.TranslationSettingVO;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
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
@RequestMapping("/api/translation")
public class TranslationController {

    private final TranslationService service;

    public TranslationController(TranslationService service) {
        this.service = service;
    }

    @GetMapping("/settings")
    public ApiResponse<TranslationSettingVO> getSettings(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @RequestParam(required = false) Long customerId) {
        return ApiResponse.ok(service.getSettings(principal.tenantId(), customerId));
    }

    @PutMapping("/settings")
    public ApiResponse<TranslationSettingVO> updateSettings(@AuthenticationPrincipal AuthPrincipal principal,
                                                            @Valid @RequestBody TranslationSettingInput input) {
        String scope = input.scope() == null || input.scope().isBlank() ? "global" : input.scope();
        Long scopeKey = null;
        if (input.scopeKey() != null && !input.scopeKey().isBlank()) {
            try {
                scopeKey = Long.valueOf(input.scopeKey().trim());
            } catch (NumberFormatException e) {
                throw new BizException(40000, "scopeKey 必须是数字客户 id: " + input.scopeKey());
            }
        }
        return ApiResponse.ok(service.updateScopedSettings(principal.tenantId(), scope, scopeKey, input));
    }

    @DeleteMapping("/settings/customer/{customerId}")
    public ApiResponse<Map<String, Integer>> clearCustomer(@AuthenticationPrincipal AuthPrincipal principal,
                                                           @PathVariable Long customerId) {
        return ApiResponse.ok(Map.of("cleared", service.clearCustomerSettings(principal.tenantId(), customerId)));
    }

    @GetMapping("/nodes")
    public ApiResponse<List<TranslationNodeVO>> nodes() {
        return ApiResponse.ok(service.nodes());
    }

    @GetMapping("/nodes/delays")
    public ApiResponse<List<ServerDelayVO>> delays() {
        return ApiResponse.ok(service.delays());
    }

    @PostMapping("/translate")
    public ApiResponse<TranslateVO> translate(@AuthenticationPrincipal AuthPrincipal principal,
                                              @Valid @RequestBody TranslateDTO dto) {
        return ApiResponse.ok(service.translate(principal.tenantId(), dto));
    }

    @GetMapping("/cache/stats")
    public ApiResponse<TranslationCacheStatsVO> cacheStats(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.cacheStats(principal.tenantId()));
    }

    @GetMapping("/credentials")
    public ApiResponse<List<TranslationCredentialVO>> credentials(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.credentials(principal.tenantId()));
    }

    @PutMapping("/credentials")
    public ApiResponse<TranslationCredentialVO> putCredential(@AuthenticationPrincipal AuthPrincipal principal,
                                                              @Valid @RequestBody TranslationCredentialInput input) {
        return ApiResponse.ok(service.putCredential(principal.tenantId(), input));
    }

    @PostMapping("/credentials/test")
    public ApiResponse<CredentialTestVO> testCredential(@AuthenticationPrincipal AuthPrincipal principal,
                                                        @Valid @RequestBody CredentialTestDTO dto) {
        return ApiResponse.ok(service.testCredential(principal.tenantId(), dto));
    }
}
