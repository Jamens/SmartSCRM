package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.TranslationService;
import com.smartscrm.server.service.msg.ConversationScopeKey;
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

    /**
     * 三个作用域参数按 spec §3 的形态给：都不带 = 全局；带 `customerId` = 客户档优先；
     * `accountId` + `chatKey` **齐备** = 会话档优先。只带其中一个等于没带（`composeOrNull` 回 null，
     * 不查这一档、也不报错——读取那条链的容错口径见 Task 2 那条 javadoc）。
     */
    @GetMapping("/settings")
    public ApiResponse<TranslationSettingVO> getSettings(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @RequestParam(required = false) Long customerId,
                                                         @RequestParam(required = false) Long accountId,
                                                         @RequestParam(required = false) String chatKey) {
        return ApiResponse.ok(service.getSettings(principal.tenantId(), customerId, accountId, chatKey));
    }

    @PutMapping("/settings")
    public ApiResponse<TranslationSettingVO> updateSettings(@AuthenticationPrincipal AuthPrincipal principal,
                                                            @Valid @RequestBody TranslationSettingInput input) {
        String scope = input.scope() == null || input.scope().isBlank() ? "global" : input.scope();
        return switch (scope) {
            // 全局档无定位参数；库里没有全局行时由 requireSettings 建。
            case "global" -> ApiResponse.ok(service.updateSettings(principal.tenantId(), input));
            // 客户档的键就是客户 id 的十进制形态，数字解析留在这里（P-06：service 只认解好的 id）。
            case "customer" -> ApiResponse.ok(
                service.updateCustomerSettings(principal.tenantId(), customerScopeKey(input), input));
            // 会话档：先就地判形状（`compose` 抛的也是 40000，但这里能给出更好的分派时机），
            // 再显式拒掉"带 scopeKey"的请求——那条键的形态只有 Java 知道，让调用方递一条成形键进来,
            // 等于把"键可以拼"这件事重新开放出去（spec §3.4）。
            case "conversation" -> {
                String reason = ConversationScopeKey.rejectReason(input.accountId(), input.chatKey());
                if (reason != null) {
                    throw new BizException(40000, reason);
                }
                if (input.scopeKey() != null && !input.scopeKey().isBlank()) {
                    throw new BizException(40000, "scope=conversation 用 accountId + chatKey 定位，不接受 scopeKey");
                }
                yield ApiResponse.ok(service.updateConversationSettings(principal.tenantId(), input));
            }
            default -> throw new BizException(40000, "scope 只能是 global / customer / conversation");
        };
    }

    /** 客户档的键：既有语义（数字客户 id 的字符串形态），只是从 `updateScopedSettings` 里搬了出来。 */
    private static Long customerScopeKey(TranslationSettingInput input) {
        if (input.scopeKey() == null || input.scopeKey().isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(input.scopeKey().trim());
        } catch (NumberFormatException e) {
            throw new BizException(40000, "scopeKey 必须是数字客户 id: " + input.scopeKey());
        }
    }

    @DeleteMapping("/settings/customer/{customerId}")
    public ApiResponse<Map<String, Integer>> clearCustomer(@AuthenticationPrincipal AuthPrincipal principal,
                                                           @PathVariable Long customerId) {
        return ApiResponse.ok(Map.of("cleared", service.clearCustomerSettings(principal.tenantId(), customerId)));
    }

    /**
     * 两个参数都 `required = false`：少了哪半件都要回 40000 且文案指名道姓（`rejectReason` 供），
     * 而 Spring 的 `MissingServletRequestParameterException` 到不了那个形状。
     * 删除的幂等由 `{cleared:0|1}` 如实表达，"本来就没有"不报成失败。
     */
    @DeleteMapping("/settings/conversation")
    public ApiResponse<Map<String, Integer>> clearConversation(@AuthenticationPrincipal AuthPrincipal principal,
                                                               @RequestParam(required = false) Long accountId,
                                                               @RequestParam(required = false) String chatKey) {
        return ApiResponse.ok(Map.of("cleared",
            service.clearConversationSettings(principal.tenantId(), accountId, chatKey)));
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
