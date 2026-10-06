package com.smartscrm.server.service.media;

import com.smartscrm.server.service.provider.Credentials;
import org.springframework.stereotype.Component;

/**
 * 本地模拟引擎（OCR / ASR 兜底）：离线可跑、零密钥依赖，给出一段示意性的识别文字。
 * 真实厂商引擎不可用或未配置时由 {@code TranslationService} 回退到这里，并标 {@code degraded}。
 */
@Component
public class SimulatedMediaEngine implements MediaEngine {

    @Override
    public String providerId() {
        return "simulated";
    }

    @Override
    public String ocr(Credentials creds, byte[] image, String mime) {
        return "（本地模拟 OCR）示例图片文字：订单号 8821 · 金额 ¥199.00 · 预计 3 日内送达";
    }

    @Override
    public String asr(Credentials creds, byte[] audio, String mime) {
        return "（本地模拟 ASR）示例语音转写：您好，请问我的订单到哪了？";
    }
}
