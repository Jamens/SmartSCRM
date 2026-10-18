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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * B28 知识库检索的 embedding 客户端，走**本地/自托管**的 OpenAI 兼容端（Ollama、LocalAI 等）。
 *
 * <p>红线口径与 B27 protocol 一致：端点与模型名都由配置注入，**默认空**，不默认外连任何
 * 商业云。未配置 {@code scrm.embedding.base-url} 时 {@link #enabled()} 为 false，检索层
 * 据此走降级路径并给出明确提示，而不是静默返回空结果让人误以为"库里没匹配"。
 *
 * <p>单条失败即抛 {@link BizException}，不吞异常——检索召回不了必须让人知道，
 * 静默降级成"查不到"是这个功能最容易踩的坑。
 */
@Component
public class EmbeddingClient {

    private static final Logger log = LoggerFactory.getLogger(EmbeddingClient.class);
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    /** 空表示未配置，检索层走降级。 */
    private final String baseUrl;
    private final String model;
    private final String apiKey;

    public EmbeddingClient(
            @Value("${scrm.embedding.base-url:}") String baseUrl,
            @Value("${scrm.embedding.model:nomic-embed-text}") String model,
            @Value("${scrm.embedding.api-key:}") String apiKey) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
        this.model = model == null || model.isBlank() ? "nomic-embed-text" : model.trim();
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.http = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
    }

    /** 是否具备向量化能力。未配置端点时为 false。 */
    public boolean enabled() {
        return !baseUrl.isBlank();
    }

    public String model() {
        return model;
    }

    /**
     * 单条文本向量化。
     *
     * @return float 向量；空输入返回空列表（调用方需自行处理空文案）
     * @throws BizException 端点不可达或返回异常时抛出，不静默吞掉
     */
    public List<Float> embed(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        if (!enabled()) {
            throw new BizException(40905, "embedding 端点未配置，无法向量化");
        }
        List<List<Float>> batch = embedBatch(List.of(text));
        return batch.isEmpty() ? List.of() : batch.get(0);
    }

    /**
     * 批量向量化，用于建库时一次性预热。
     *
     * @return 与入参同序的向量列表；入参为空返回空列表
     * @throws BizException 端点不可达或响应缺条目时抛出
     */
    public List<List<Float>> embedBatch(List<String> texts) {
        if (texts == null || texts.isEmpty()) {
            return List.of();
        }
        if (!enabled()) {
            throw new BizException(40905, "embedding 端点未配置，无法向量化");
        }
        // 端点未配 api-key 时不发该头（Ollama 本地默认免鉴权）
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        if (!apiKey.isBlank()) {
            headers.put("Authorization", "Bearer " + apiKey);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("input", texts);
        String body;
        try {
            body = mapper.writeValueAsString(payload);
        } catch (IOException e) {
            throw new BizException(50001, "embedding 请求序列化失败: " + e.getMessage());
        }

        HttpRequest.Builder rb = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl.replaceAll("/+$", "") + "/v1/embeddings"))
                .timeout(REQUEST_TIMEOUT)
                .POST(HttpRequest.BodyPublishers.ofString(body));
        headers.forEach(rb::header);

        HttpResponse<String> resp;
        try {
            resp = http.send(rb.build(), HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new BizException(40905, "embedding 端点不可达: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BizException(40905, "embedding 请求被中断");
        }

        if (resp.statusCode() / 100 != 2) {
            log.warn("embedding 端点返回 {}: {}", resp.statusCode(), abbreviate(resp.body()));
            throw new BizException(40905, "embedding 端点返回异常状态 " + resp.statusCode());
        }
        return parseEmbeddings(resp.body(), texts.size());
    }

    /** 解析 OpenAI 兼容响应，取 {@code data[i].embedding}。按 {@code index} 排序还原入参顺序。 */
    private List<List<Float>> parseEmbeddings(String body, int expected) {
        JsonNode data;
        try {
            data = mapper.readTree(body).path("data");
        } catch (IOException e) {
            throw new BizException(40905, "embedding 响应解析失败: " + e.getMessage());
        }
        if (!data.isArray() || data.isEmpty()) {
            throw new BizException(40905, "embedding 响应缺少 data 数组");
        }
        // 按 index 归位，避免服务端乱序返回导致向量与文案错配
        List<JsonNode> ordered = new ArrayList<>(data.size());
        for (int i = 0; i < data.size(); i++) {
            ordered.add(null);
        }
        for (JsonNode item : data) {
            int idx = item.path("index").asInt(-1);
            if (idx >= 0 && idx < ordered.size()) {
                ordered.set(idx, item);
            }
        }
        List<List<Float>> out = new ArrayList<>(ordered.size());
        for (JsonNode item : ordered) {
            if (item == null) {
                throw new BizException(40905, "embedding 响应条目缺失");
            }
            JsonNode vec = item.path("embedding");
            if (!vec.isArray() || vec.isEmpty()) {
                throw new BizException(40905, "embedding 响应缺少向量内容");
            }
            List<Float> f = new ArrayList<>(vec.size());
            for (JsonNode n : vec) {
                f.add((float) n.asDouble());
            }
            out.add(f);
        }
        if (out.size() != expected) {
            throw new BizException(40905,
                "embedding 响应条目数不符：期望 " + expected + " 实得 " + out.size());
        }
        return out;
    }

    private static String abbreviate(String s) {
        if (s == null) {
            return "";
        }
        return s.length() <= 200 ? s : s.substring(0, 200) + "...";
    }
}
