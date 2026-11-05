package com.smartscrm.server.service.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartscrm.server.common.BizException;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * OpenAI 兼容的 chat completion 客户端（{@code POST {baseUrl}/v1/chat/completions}）。
 * 形状照 {@link EmbeddingClient}：端点与模型名都由配置注入、**默认空**，未配置时
 * {@link #available()} 为 false（S5 功能未启用，不静默返回空）；单条失败即抛
 * {@link BizException}(40906)，**不吞异常**——模型调不通必须让人知道，不能伪装成"生成了空内容"。
 *
 * <p>红线：不默认外连任何商业云；不做流式（{@code stream:false}）；响应正文只截取前 200 字记日志，
 * 不回显给前端。
 */
@Component
public class ChatClient {

    private static final Logger log = LoggerFactory.getLogger(ChatClient.class);
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);

    private final HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    /** 空表示未配置。 */
    private final String baseUrl;
    private final String model;
    private final String apiKey;
    private final long timeoutMs;
    private final int maxTokens;
    private final double temperature;

    /** 一条 chat message：role=system/user/assistant，content 为正文。 */
    public record Msg(String role, String content) {}

    /**
     * Spring 构造：配置全走 {@code @Value} 注入，默认空 = 未启用。
     *
     * <p><b>必须显式 {@code @Autowired}</b>：本类另有一个包可见的 7 参构造器供单测直接 new。
     * Spring 在「多构造器且无人标注」时不会去猜带 {@code @Value} 的那个，而是退回**无参构造器**，
     * 结果就是应用启动期 {@code NoSuchMethodException: ChatClient.<init>()}——纯 Mockito 单测
     * 覆盖不到（它们绕开了 Spring），只有真正启动上下文才会暴露。
     */
    @Autowired
    public ChatClient(
            @Value("${scrm.chat.base-url:}") String baseUrl,
            @Value("${scrm.chat.model:}") String model,
            @Value("${scrm.chat.api-key:}") String apiKey,
            @Value("${scrm.chat.timeout-ms:30000}") long timeoutMs,
            @Value("${scrm.chat.max-tokens:512}") int maxTokens,
            @Value("${scrm.chat.temperature:0.3}") double temperature) {
        this(baseUrl, model, apiKey, timeoutMs, maxTokens, temperature,
            HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build());
    }

    /** 包可见全参构造：供单测直接 new，不依赖 Spring；可注入自定义 {@link HttpClient}。 */
    ChatClient(String baseUrl, String model, String apiKey, long timeoutMs, int maxTokens,
               double temperature, HttpClient http) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
        this.model = model == null ? "" : model.trim();
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.timeoutMs = timeoutMs;
        this.maxTokens = maxTokens;
        this.temperature = temperature;
        this.http = http;
    }

    /** baseUrl 与 model 均非空才算启用（S5：不猜默认模型，猜错直接是"模型不存在"的失败）。 */
    public boolean available() {
        return !baseUrl.isBlank() && !model.isBlank();
    }

    /**
     * 一次非流式补全，取 {@code choices[0].message.content}。
     *
     * @throws BizException 未启用 / 序列化 / 端点不可达 / 超时 / 非 2xx / 解析失败，一律 40906
     */
    public String complete(List<Msg> messages) {
        if (!available()) {
            throw new BizException(40906, "chat 端点未配置（scrm.chat.base-url / model），无法生成");
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        List<Map<String, String>> msgList = new ArrayList<>();
        for (Msg m : messages) {
            Map<String, String> item = new LinkedHashMap<>();
            item.put("role", m.role());
            item.put("content", m.content());
            msgList.add(item);
        }
        payload.put("messages", msgList);
        payload.put("temperature", temperature);
        payload.put("max_tokens", maxTokens);
        payload.put("stream", false);

        String body;
        try {
            body = mapper.writeValueAsString(payload);
        } catch (IOException e) {
            throw new BizException(40906, "chat 请求序列化失败: " + e.getMessage());
        }

        URI uri;
        try {
            uri = URI.create(baseUrl.replaceAll("/+$", "") + "/v1/chat/completions");
        } catch (IllegalArgumentException e) {
            throw new BizException(40906, "chat 端点地址非法: " + e.getMessage());
        }
        HttpRequest.Builder rb = HttpRequest.newBuilder()
            .uri(uri)
            .timeout(Duration.ofMillis(Math.max(1, timeoutMs)))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body));
        // 端点未配 api-key 时不发该头（Ollama 本地默认免鉴权）
        if (!apiKey.isBlank()) {
            rb.header("Authorization", "Bearer " + apiKey);
        }

        HttpResponse<String> resp;
        try {
            resp = http.send(rb.build(), HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            // 含 HttpTimeoutException：不可达与超时同一口径
            throw new BizException(40906, "chat 端点不可达或超时: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BizException(40906, "chat 请求被中断");
        }

        if (resp.statusCode() / 100 != 2) {
            log.warn("chat 端点返回 {}: {}", resp.statusCode(), abbreviate(resp.body()));
            throw new BizException(40906, "chat 端点返回异常状态 " + resp.statusCode());
        }
        return parseContent(resp.body());
    }

    private String parseContent(String body) {
        JsonNode choices;
        try {
            choices = mapper.readTree(body).path("choices");
        } catch (IOException e) {
            throw new BizException(40906, "chat 响应解析失败: " + e.getMessage());
        }
        if (!choices.isArray() || choices.isEmpty()) {
            throw new BizException(40906, "chat 响应缺少 choices");
        }
        String content = choices.get(0).path("message").path("content").asText(null);
        if (content == null || content.isBlank()) {
            throw new BizException(40906, "chat 响应缺少 content");
        }
        return content;
    }

    /** 响应正文只截前 200 字记日志，不回显给前端。 */
    private static String abbreviate(String s) {
        if (s == null) {
            return "";
        }
        return s.length() <= 200 ? s : s.substring(0, 200) + "...";
    }
}
