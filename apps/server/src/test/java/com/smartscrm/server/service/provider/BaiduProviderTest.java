package com.smartscrm.server.service.provider;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Contracts pinned here come from the 通用翻译API doc:
 * GET {base}/api/trans/vip/translate with q/from/to/appid/salt/sign,
 * sign = MD5(appid + q + salt + secret) lower-case hex, q <= 5000 chars per request.
 * The expected sign below was computed with `md5sum` in a shell, not with this codebase.
 */
class BaiduProviderTest {

    private static final String EXPECTED_SIGN = "edb7a7082d9b316f7e718e582cb257c0";
    private static final Credentials CREDS = new Credentials("2020202001", "test_secret", null);

    private HttpServer server;
    private final List<Map<String, String>> receivedQueries = new ArrayList<>();
    private final List<String> responses = new ArrayList<>();
    private String baseUrl;

    @BeforeEach
    void startServer() throws Exception {
        receivedQueries.clear();
        responses.clear();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            Map<String, String> params = parseQuery(exchange.getRequestURI().getRawQuery());
            receivedQueries.add(params);
            String body = responses.isEmpty() ? okBody("Hello world") : responses.remove(0);
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private BaiduProvider provider() {
        return new BaiduProvider(baseUrl, () -> "12345");
    }

    // ---------- tests ----------

    @Test
    void signsRequestWithTheDocumentedMd5Composition() {
        ProviderResult r = provider().translate(CREDS, "你好 world", "zh-CN", "en");

        Map<String, String> q = receivedQueries.get(0);
        assertEquals("edb7a7082d9b316f7e718e582cb257c0", q.get("sign"));
        assertEquals("你好 world", q.get("q"));
        assertEquals("zh", q.get("from"));
        assertEquals("en", q.get("to"));
        assertEquals("2020202001", q.get("appid"));
        assertEquals("12345", q.get("salt"));
        assertEquals("Hello world", r.translation());
        // detectedFrom speaks our code space (zh-CN), not baidu's (zh).
        assertEquals("zh-CN", r.detectedFrom());
    }

    @Test
    void sendsAutoWhenFromLangIsBlank() {
        provider().translate(CREDS, "abc", "", "zh-CN");
        assertEquals("auto", receivedQueries.get(0).get("from"));
    }

    @Test
    void rejectsUnmappedLanguagesWithoutTouchingTheNetwork() {
        assertFalse(provider().supports("sw", "en"));
        ProviderException e = assertThrows(ProviderException.class,
            () -> provider().translate(CREDS, "habari", "sw", "en"));
        assertTrue(e.getMessage().contains("sw"));
        assertEquals(0, receivedQueries.size());
    }

    @Test
    void splitsLongTextIntoChunksOfAtMost5000CharsAndJoinsResults() {
        // 2000 lines of "aaaa" -> 9999 chars: first request carries 1000 lines (4999 chars).
        String text = String.join("\n", java.util.Collections.nCopies(2000, "aaaa"));
        BaiduProvider p = provider();
        responses.add(okBodyJoinedFirstChunk(text));
        responses.add(okBody("second"));

        ProviderResult r = p.translate(CREDS, text, "zh-CN", "en");

        assertEquals(2, receivedQueries.size());
        String first = receivedQueries.get(0).get("q");
        assertTrue(first.length() <= 5000, "chunk 1 length " + first.length());
        assertEquals(first + "\n" + receivedQueries.get(1).get("q"), text);
        assertTrue(r.translation().startsWith("«" + first + "»\nsecond"));
    }

    @Test
    void hardCutsASingleLineLongerThanTheLimit() {
        String text = "x".repeat(7000);
        responses.add(okBody("a"));
        responses.add(okBody("b"));

        provider().translate(CREDS, text, "zh-CN", "en");

        assertEquals(2, receivedQueries.size());
        assertEquals(5000, receivedQueries.get(0).get("q").length());
        assertEquals(2000, receivedQueries.get(1).get("q").length());
    }

    @Test
    void surfacesProviderErrorCodeAsProviderException() {
        responses.add("{\"error_code\":\"54001\",\"error_msg\":\"invalid sign\"}");
        ProviderException e = assertThrows(ProviderException.class,
            () -> provider().translate(CREDS, "你好", "zh-CN", "en"));
        assertTrue(e.getMessage().contains("54001"), e.getMessage());
    }

    @Test
    void wrapsTransportFailures() throws Exception {
        server.stop(0);
        ProviderException e = assertThrows(ProviderException.class,
            () -> provider().translate(CREDS, "你好", "zh-CN", "en"));
        assertTrue(e.getMessage().contains("百度"));
    }

    // ---------- helpers ----------

    private static String okBody(String dst) {
        return "{\"from\":\"zh\",\"to\":\"en\",\"trans_result\":[{\"src\":\"x\",\"dst\":\"" + dst + "\"}]}";
    }

    private static String okBodyJoinedFirstChunk(String fullText) {
        String first = fullText.substring(0, 4999);
        String escaped = first.replace("\n", "\\n");
        return "{\"from\":\"zh\",\"to\":\"en\",\"trans_result\":[{\"src\":\"x\",\"dst\":\"«" + escaped + "»\"}]}";
    }

    private static Map<String, String> parseQuery(String raw) {
        Map<String, String> map = new HashMap<>();
        if (raw == null) {
            return map;
        }
        for (String pair : raw.split("&")) {
            int i = pair.indexOf('=');
            map.put(URLDecoder.decode(pair.substring(0, i), StandardCharsets.UTF_8),
                URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8));
        }
        return map;
    }
}
