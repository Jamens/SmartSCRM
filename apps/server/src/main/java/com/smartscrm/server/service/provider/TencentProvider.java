package com.smartscrm.server.service.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/**
 * 腾讯云 TMT 文本翻译 TextTranslate (2018-03-21) adapter (channel 7), API 3.0 signing via
 * {@link Tc3Signer}. The documented SourceText cap is 5000 bytes per request, so texts are
 * split line-aware on UTF-8 byte size and chunk translations are joined back with newlines.
 * Host/action/service/body field names are pinned by a live gateway probe (wrong values
 * answer InvalidAction before any auth check; see tmp/p5d-tc3-probe.mjs).
 */
@Component
public class TencentProvider implements TranslationProvider {

    static final int MAX_SOURCE_BYTES = 5000;
    private static final String CONTENT_TYPE = "application/json; charset=utf-8";
    private static final String DEFAULT_HOST = "tmt.tencentcloudapi.com";

    /** Our codes -> tencent codes; only zh-CN differs. All eight are in the official list. */
    private static final Map<String, String> LANGS = Map.of(
        "zh-CN", "zh",
        "en", "en",
        "vi", "vi",
        "id", "id",
        "lo", "lo",
        "hi", "hi",
        "my", "my",
        "ms", "ms");

    private final String url;
    private final String host;
    private final Supplier<Long> epochSeconds;
    private final HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public TencentProvider() {
        this("https://" + DEFAULT_HOST, DEFAULT_HOST, () -> System.currentTimeMillis() / 1000);
    }

    TencentProvider(String url, String host, Supplier<Long> epochSeconds) {
        this.url = url;
        this.host = host;
        this.epochSeconds = epochSeconds;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    }

    @Override
    public String providerId() {
        return "tencent";
    }

    @Override
    public boolean supports(String fromLang, String toLang) {
        // "auto" is tencent's own detect token too — a configured row that spells it out
        // (a customer override saying 'auto') must reach the vendor, not degrade to the
        // simulated engine just because it is not one of our eight codes.
        boolean fromOk = fromLang == null || fromLang.isBlank() || "auto".equals(fromLang)
            || LANGS.containsKey(fromLang);
        return fromOk && LANGS.containsKey(toLang);
    }

    @Override
    public ProviderResult translate(Credentials creds, String text, String fromLang, String toLang) {
        if (creds == null || creds.appId().isBlank() || creds.secret().isBlank()) {
            throw new ProviderException("腾讯 未配置密钥");
        }
        if (!supports(fromLang, toLang)) {
            throw new ProviderException("腾讯 语种不支持: " + fromLang + "->" + toLang);
        }
        String from = (fromLang == null || fromLang.isBlank() || "auto".equals(fromLang))
            ? "auto" : LANGS.get(fromLang);
        String to = LANGS.get(toLang);

        List<String> parts = new ArrayList<>();
        String detectedFrom = (fromLang == null || fromLang.isBlank()) ? "" : fromLang;
        for (String chunk : splitForByteLimit(text)) {
            JsonNode root = request(creds, chunk, from, to);
            if (detectedFrom.isEmpty()) {
                String ours = backKey(root.path("Source").asText(""), "");
                detectedFrom = ours.isEmpty() ? root.path("Source").asText("") : ours;
            }
            JsonNode translation = root.path("Translation");
            if (translation.isArray()) {
                List<String> items = new ArrayList<>();
                for (JsonNode item : translation) {
                    items.add(item.asText());
                }
                parts.add(String.join("\n", items));
            } else {
                parts.add(translation.asText());
            }
        }
        return new ProviderResult(String.join("\n", parts), detectedFrom);
    }

    private JsonNode request(Credentials creds, String sourceText, String from, String to) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("SourceText", sourceText);
        payload.put("Source", from);
        payload.put("Target", to);
        payload.put("ProjectId", 0);
        byte[] body;
        String timestamp;
        String authorization;
        try {
            body = mapper.writeValueAsBytes(payload);
            long ts = epochSeconds.get();
            timestamp = String.valueOf(ts);
            authorization = Tc3Signer.authorization(creds.appId(), creds.secret(), "tmt", host,
                CONTENT_TYPE, body, ts);
        } catch (Exception e) {
            throw new ProviderException("腾讯 签名失败: " + e.getMessage(), e);
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(url + "/"))
            .timeout(Duration.ofSeconds(4))
            .header("Content-Type", CONTENT_TYPE)
            .header("Authorization", authorization)
            .header("X-TC-Action", "TextTranslate")
            .header("X-TC-Version", "2018-03-21")
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

    /** Line-aware split on the UTF-8 byte budget; a too-long single line is cut byte-safely. */
    static List<String> splitForByteLimit(String text) {
        List<String> chunks = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        int curBytes = 0;
        for (String line : text.split("\n", -1)) {
            int lineBytes = utf8Len(line);
            while (lineBytes > MAX_SOURCE_BYTES) {
                if (cur.length() > 0) {
                    chunks.add(cur.toString());
                    cur.setLength(0);
                    curBytes = 0;
                }
                StringBuilder piece = new StringBuilder();
                int pieceBytes = 0;
                for (int i = 0; i < line.length(); ) {
                    int cp = line.codePointAt(i);
                    int cpBytes = utf8Len(new String(Character.toChars(cp)));
                    if (pieceBytes + cpBytes > MAX_SOURCE_BYTES) {
                        break;
                    }
                    piece.appendCodePoint(cp);
                    pieceBytes += cpBytes;
                    i += Character.charCount(cp);
                }
                chunks.add(piece.toString());
                line = line.substring(piece.length());
                lineBytes = utf8Len(line);
            }
            int extra = cur.length() == 0 ? lineBytes : lineBytes + 1;
            if (cur.length() == 0) {
                cur.append(line);
                curBytes = lineBytes;
            } else if (curBytes + extra <= MAX_SOURCE_BYTES) {
                cur.append('\n').append(line);
                curBytes += extra;
            } else {
                chunks.add(cur.toString());
                cur.setLength(0);
                cur.append(line);
                curBytes = lineBytes;
            }
        }
        if (cur.length() > 0) {
            chunks.add(cur.toString());
        }
        return chunks;
    }

    private static int utf8Len(String s) {
        return s.getBytes(StandardCharsets.UTF_8).length;
    }

    private static String backKey(String code, String fallback) {
        for (Map.Entry<String, String> e : LANGS.entrySet()) {
            if (e.getValue().equals(code)) {
                return e.getKey();
            }
        }
        return fallback;
    }
}
