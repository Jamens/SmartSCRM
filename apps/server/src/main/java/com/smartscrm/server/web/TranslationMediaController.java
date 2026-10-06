package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.TranslationService;
import com.smartscrm.server.web.dto.ImageTranslateDTO;
import com.smartscrm.server.web.dto.VoiceTranslateDTO;
import com.smartscrm.server.web.vo.MediaTranslateVO;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/translation")
public class TranslationMediaController {

    private final TranslationService service;

    public TranslationMediaController(TranslationService service) {
        this.service = service;
    }

    /** 图片翻译：OCR 抽取文字 → 按当前语向翻译。厂商 OCR 不可用时回退本地模拟并标 degraded。 */
    @PostMapping("/image")
    @PreAuthorize("hasAuthority('translation:write')")
    public ApiResponse<MediaTranslateVO> translateImage(@AuthenticationPrincipal AuthPrincipal principal,
                                                       @Valid @RequestBody ImageTranslateDTO dto) {
        return ApiResponse.ok(service.translateImage(principal.tenantId(), dto));
    }

    /** 语音翻译：ASR 转写文字 → 按当前语向翻译。厂商 ASR 不可用时回退本地模拟并标 degraded。 */
    @PostMapping("/voice")
    @PreAuthorize("hasAuthority('translation:write')")
    public ApiResponse<MediaTranslateVO> translateVoice(@AuthenticationPrincipal AuthPrincipal principal,
                                                       @Valid @RequestBody VoiceTranslateDTO dto) {
        return ApiResponse.ok(service.translateVoice(principal.tenantId(), dto));
    }
}
