package com.smartscrm.server.service.media;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.smartscrm.server.service.provider.Credentials;
import com.smartscrm.server.service.provider.ProviderException;
import com.smartscrm.server.service.provider.Tc3Signer;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import org.springframework.stereotype.Component;

/**
 * 腾讯云媒体理解适配器：OCR 走 GeneralBasicOCR (2018-11-19)，ASR 走 SentenceRecognition
 * (2019-06-14)，均用 {@link Tc3Signer} 做 API 3.0 签名。密钥复用 {@code translation_credential}
 * 中 provider=tencent 的那一行（secretId/secretKey + region），与文本翻译同一套凭据。
 * <p>
 * 仅在 {@code TranslationService} 判定该租户已配置腾讯密钥时才被选用；任何失败都抛
 * {@link ProviderException}，让调用方回退到 {@link SimulatedMediaEngine}。本类只负责"真实请求 +
 * 解析"，回退与降级标记不在这一层。
 */
@Component
public class TencentMediaEngine implements MediaEngine {

    private static final String CONTENT_TYPE = "application/json; charset=utf-8";
    private static final String OCR_URL = "https://ocr.tencentcloudapi.com/";
    private static final String OCR_HOST = "ocr.tencentcloudapi.com";
    private static final String ASR_URL = "https://asr.tencentcloudapi.com/";
    private static final String ASR_HOST = "asr.tencentcloudapi.com";

    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    @Override
    public String providerId() {
        return "tencent";
    }

    @Override
    public String ocr(Credentials creds, byte[] image, String mime) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("ImageBase64", Base64.getEncoder().encodeToString(image));
        JsonNode root = request(creds, OCR_URL, OCR_HOST, "ocr", "GeneralBasicOCR", "2018-11-19", payload);
        StringBuilder sb = new StringBuilder();
        JsonNode detections = root.path("TextDetections");
        if (detections.isArray()) {
            for (JsonNode d : detections) {
                String text = d.path("DetectedText").asText("");
                if (!text.isEmpty()) {
                    if (sb.length() > 0) {
                        sb.append('\n');
                    }
                    sb.append(text);
                }
            }
        }
        if (sb.length() == 0) {
            throw new ProviderException("腾讯 OCR 未返回文字", true);
        }
        return sb.toString();
    }

    @Override
    public String asr(Credentials creds, byte[] audio, String mime) {
        String format = voiceFormatOf(mime);
        ObjectNode payload = mapper.createObjectNode();
        payload.put("ProjectId", 0);
        payload.put("SubServiceType", 2);
        payload.put("EngSerViceType", "16k_zh");
        payload.put("SourceType", 1);
        payload.put("VoiceFormat", format);
        payload.put("VoiceBase64", Base64.getEncoder().encodeToString(audio));
        payload.put("UsrAudioKey", "smartscrm-" + System.nanoTime());
        JsonNode root = request(creds, ASR_URL, ASR_HOST, "asr", "SentenceRecognition", "2019-06-14", payload);
        String result = root.path("Result").asText("");
        if (result.isEmpty()) {
            throw new ProviderException("腾讯 ASR 未返回文字", true);
        }
        return result;
    }

    private static String voiceFormatOf(String mime) {
        if (mime == null) {
            return "wav";
        }
        return switch (mime.toLowerCase()) {
            case "audio/wav", "audio/x-wav", "audio/wave" -> "wav";
            case "audio/mp3", "audio/mpeg" -> "mp3";
            case "audio/aac" -> "aac";
            case "audio/flac" -> "flac";
            case "audio/m4a", "audio/mp4" -> "m4a";
            case "audio/speex" -> "speex";
            case "audio/pcm", "audio/l16" -> "pcm";
            case "audio/amr" -> "amr";
            default -> "wav";
        };
    }

    private JsonNode request(Credentials creds, String url, String host, String service, String action,
                             String version, ObjectNode payload) {
        if (creds == null || creds.appId().isBlank() || creds.secret().isBlank()) {
            throw new ProviderException("腾讯 未配置密钥", false);
        }
        byte[] body;
        String timestamp;
        String authorization;
        try {
            body = mapper.writeValueAsBytes(payload);
            long ts = System.currentTimeMillis() / 1000;
            timestamp = String.valueOf(ts);
            authorization = Tc3Signer.authorization(creds.appId(), creds.secret(), service, host,
                CONTENT_TYPE, body, ts);
        } catch (Exception e) {
            throw new ProviderException("腾讯 签名失败: " + e.getMessage(), e);
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(8))
            .header("Content-Type", CONTENT_TYPE)
            .header("Authorization", authorization)
            .header("X-TC-Action", action)
            .header("X-TC-Version", version)
            .header("X-TC-Timestamp", timestamp)
            .header("X-TC-Region", (creds.region() == null || creds.region().isBlank())
                ? "ap-shanghai" : creds.region())
            .POST(HttpRequest.BodyPublishers.ofByteArray(body))
            .build();
        try {
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                throw new ProviderException("腾讯 HTTP " + res.statusCode());
            }
            JsonNode root = mapper.readTree(res.body()).path("Response");
            JsonNode error = root.path("Error");
            if (!error.isMissingNode() && error.has("Code")) {
                throw new ProviderException("腾讯 " + error.path("Code").asText()
                    + " " + error.path("Message").asText(""));
            }
            return root;
        } catch (ProviderException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ProviderException("腾讯 请求被中断", e);
        } catch (Exception e) {
            throw new ProviderException("腾讯 接口不可用: " + e.getMessage(), e);
        }
    }
}
