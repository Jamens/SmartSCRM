package com.smartscrm.server.service.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.smartscrm.server.common.BizException;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;

/**
 * ChatClient 契约单测：用 JDK 自带 {@code com.sun.net.httpserver.HttpServer} 起本地 mock，
 * 零外部依赖、端口 0 随机。覆盖启用判定 / 正常解析 / 各类失败 / apiKey 头规则。
 */
class ChatClientTest {

    private HttpServer server;
    private MockHandler handler;

    @BeforeEach
    void startServer() throws IOException {
        handler = new MockHandler();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", handler);
        server.start();
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    private String base() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** 走包可见全参构造，不依赖 Spring；超时用例靠 timeoutMs 精确控制。 */
    private ChatClient client(String baseUrl, String model, String apiKey, long timeoutMs) {
        return new ChatClient(baseUrl, model, apiKey, timeoutMs, 512, 0.3, HttpClient.newHttpClient());
    }

    private static List<ChatClient.Msg> messages() {
        return List.of(new ChatClient.Msg("user", "你好"));
    }

    private static BizException expect40906(Executable e) {
        BizException ex = assertThrows(BizException.class, e);
        assertEquals(40906, ex.getCode(), "所有失败都必须抛 40906，且不吞异常");
        return ex;
    }

    // ① 未配 baseUrl
    @Test
    void available_falseWhenBaseUrlMissing_andCompleteRejected() {
        ChatClient c = client("", "qwen2.5:3b", "", 3000);
        assertFalse(c.available());
        expect40906(() -> c.complete(messages()));
    }

    // ② 配了 baseUrl 但 model 空
    @Test
    void available_falseWhenModelMissing_andCompleteRejected() {
        ChatClient c = client(base(), "", "", 3000);
        assertFalse(c.available());
        expect40906(() -> c.complete(messages()));
    }

    // ③ 正常响应取 choices[0].message.content，且请求是 OpenAI 兼容形状
    @Test
    void complete_readsFirstChoiceContent_andPostsOpenAiShape() {
        handler.body = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"你好，这是回复\"}}]}";
        ChatClient c = client(base(), "qwen2.5:3b", "", 3000);
        assertTrue(c.available());
        assertEquals("你好，这是回复", c.complete(messages()));
        assertEquals("POST", handler.lastMethod);
        assertTrue(handler.lastBody.contains("\"model\":\"qwen2.5:3b\""));
        assertTrue(handler.lastBody.contains("\"messages\""));
        assertTrue(handler.lastBody.contains("\"temperature\""));
        assertTrue(handler.lastBody.contains("\"max_tokens\""));
        assertTrue(handler.lastBody.contains("\"stream\":false"), "不写流式");
        assertEquals("application/json", handler.lastContentType);
    }

    // ④ 401
    @Test
    void complete_401_throws40906() {
        handler.status = 401;
        handler.body = "{\"error\":\"unauthorized\"}";
        expect40906(() -> client(base(), "m", "", 3000).complete(messages()));
    }

    // ⑤ 500
    @Test
    void complete_500_throws40906() {
        handler.status = 500;
        handler.body = "oops";
        expect40906(() -> client(base(), "m", "", 3000).complete(messages()));
    }

    // ⑥ 超时（mock 睡 200ms，client 只给 60ms）
    @Test
    void complete_timeout_throws40906() {
        handler.delayMs = 200;
        expect40906(() -> client(base(), "m", "", 60).complete(messages()));
    }

    // ⑦ 畸形 JSON
    @Test
    void complete_malformedJson_throws40906() {
        handler.body = "not-json{{";
        expect40906(() -> client(base(), "m", "", 3000).complete(messages()));
    }

    // ⑧ 缺 choices
    @Test
    void complete_missingChoices_throws40906() {
        handler.body = "{\"foo\":1}";
        expect40906(() -> client(base(), "m", "", 3000).complete(messages()));
    }

    // ⑨ apiKey 头规则：有则 Bearer，无则不带
    @Test
    void complete_sendsBearerOnlyWhenApiKeyPresent() {
        handler.body = "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}";
        client(base(), "m", "sk-abc", 3000).complete(messages());
        assertEquals("Bearer sk-abc", handler.lastAuthorization);

        handler.lastAuthorization = "sentinel";
        client(base(), "m", "", 3000).complete(messages());
        assertNull(handler.lastAuthorization, "未配 apiKey 时不应发 Authorization 头");
    }

    private static final class MockHandler implements HttpHandler {
        volatile int status = 200;
        volatile String body = "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}";
        volatile long delayMs = 0;
        volatile String lastAuthorization;
        volatile String lastContentType;
        volatile String lastMethod;
        volatile String lastBody;

        @Override
        public void handle(HttpExchange ex) throws IOException {
            lastAuthorization = ex.getRequestHeaders().getFirst("Authorization");
            lastContentType = ex.getRequestHeaders().getFirst("Content-Type");
            lastMethod = ex.getRequestMethod();
            lastBody = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (delayMs > 0) {
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            try {
                ex.getResponseHeaders().add("Content-Type", "application/json");
                ex.sendResponseHeaders(status, out.length);
                ex.getResponseBody().write(out);
            } catch (IOException ignored) {
                // 客户端超时提前断开时写响应会失败，忽略即可，不影响断言
            } finally {
                ex.close();
            }
        }
    }
}
