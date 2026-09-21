package com.smartscrm.server.service.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/**
 * 百度翻译开放平台 通用翻译API adapter (channel 5).
 * GET {base}/api/trans/vip/translate, sign = MD5(appid + q + salt + secret),
 * q limited to 5000 chars per request, so longer texts are line-split into chunks
 * and the results are joined back with newlines.
 */
@Component
public class BaiduProvider implements TranslationProvider {

    static final int MAX_Q_CHARS = 5000;
    private static final String DEFAULT_BASE_URL = "https://fanyi-api.baidu.com";

    /** Our engine codes -> baidu codes. zh/en/vie are documented; the rest are ISO guesses
     *  kept on purpose: a wrong code fails with an explicit baidu error and degrades,
     *  it never silently returns bad text. Correct against the developer console table at
     *  key-联调 time. */
    private static final Map<String, String> LANGS = Map.of(
        "zh-CN", "zh",
        "en", "en",
        "vi", "vie",
        "id", "id",
        "lo", "lo",
        "hi", "hi",
        "my", "my",
        "ms", "ms");

    private final String baseUrl;
    private final Supplier<String> saltSupplier;
    private final HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public BaiduProvider() {
        this(DEFAULT_BASE_URL, BaiduProvider::randomSalt);
    }

    BaiduProvider(String baseUrl, Supplier<String> saltSupplier) {
        this.baseUrl = baseUrl;
        this.saltSupplier = saltSupplier;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    }

    @Override
    public String providerId() {
        return "baidu";
    }

    @Override
    public boolean supports(String fromLang, String toLang) {
        // "auto" is baidu's own detect token — the case where the configured row spells
        // it out (customer override from P6 says 'auto') is equivalent to the blank case.
        boolean fromOk = fromLang == null || fromLang.isBlank() || "auto".equals(fromLang)
            || LANGS.containsKey(fromLang);
        return fromOk && LANGS.containsKey(toLang);
    }

    @Override
    public ProviderResult translate(Credentials creds, String text, String fromLang, String toLang) {
        if (creds == null || creds.appId().isBlank() || creds.secret().isBlank()) {
            throw new ProviderException("百度 未配置密钥");
        }
        if (!supports(fromLang, toLang)) {
            throw new ProviderException("百度 语种不支持: " + fromLang + "->" + toLang);
        }
        String to = LANGS.get(toLang);
        String from = (fromLang == null || fromLang.isBlank() || "auto".equals(fromLang))
            ? "auto" : LANGS.get(fromLang);

        List<String> parts = new ArrayList<>();
        String detectedFrom = (fromLang == null || fromLang.isBlank()) ? "" : fromLang;
        for (String chunk : splitForLimit(text)) {
            JsonNode root = request(creds, chunk, from, to);
            if (detectedFrom.isEmpty()) {
                String ours = backKey(root.path("from").asText(""), "");
                detectedFrom = ours.isEmpty() ? root.path("from").asText("") : ours;
            }
            StringBuilder sb = new StringBuilder();
            for (JsonNode item : root.path("trans_result")) {
                if (sb.length() > 0) {
                    sb.append('\n');
                }
                sb.append(item.path("dst").asText());
            }
            parts.add(sb.toString());
        }
        return new ProviderResult(String.join("\n", parts), detectedFrom);
    }

    private JsonNode request(Credentials creds, String q, String from, String to) {
        String salt = saltSupplier.get();
        String sign = md5Hex(creds.appId() + q + salt + creds.secret());
        URI uri = URI.create(baseUrl + "/api/trans/vip/translate?"
            + "q=" + enc(q) + "&from=" + from + "&to=" + to
            + "&appid=" + enc(creds.appId()) + "&salt=" + enc(salt) + "&sign=" + sign);
        HttpRequest req = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(4)).GET().build();
        try {
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                throw new ProviderException("百度 HTTP " + res.statusCode());
            }
            JsonNode root = mapper.readTree(res.body());
            if (root.has("error_code")) {
                throw new ProviderException("百度 " + root.get("error_code").asText()
                    + " " + root.path("error_msg").asText(""));
            }
            return root;
        } catch (ProviderException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ProviderException("百度 请求被中断", e);
        } catch (Exception e) {
            throw new ProviderException("百度 接口不可用: " + e.getMessage(), e);
        }
    }

    /** Line-aware split so a newline in the source survives as a newline in the result. */
    static List<String> splitForLimit(String text) {
        List<String> chunks = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (String line : text.split("\n", -1)) {
            while (line.length() > MAX_Q_CHARS) {
                if (cur.length() > 0) {
                    chunks.add(cur.toString());
                    cur.setLength(0);
                }
                chunks.add(line.substring(0, MAX_Q_CHARS));
                line = line.substring(MAX_Q_CHARS);
            }
            if (cur.length() == 0) {
                cur.append(line);
            } else if (cur.length() + 1 + line.length() <= MAX_Q_CHARS) {
                cur.append('\n').append(line);
            } else {
                chunks.add(cur.toString());
                cur.setLength(0);
                cur.append(line);
            }
        }
        if (cur.length() > 0) {
            chunks.add(cur.toString());
        }
        return chunks;
    }

    private static String backKey(String code, String fallback) {
        for (Map.Entry<String, String> e : LANGS.entrySet()) {
            if (e.getValue().equals(code)) {
                return e.getKey();
            }
        }
        return fallback;
    }

    private static String randomSalt() {
        return String.valueOf(ThreadLocalRandom.current().nextLong(1_000_000_000L, 9_999_999_999L));
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String md5Hex(String input) {
        try {
            byte[] digest = MessageDigest.getInstance("MD5").digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new ProviderException("MD5 不可用", e);
        }
    }
}
