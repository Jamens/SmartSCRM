package com.smartscrm.server.service.provider;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class TencentProviderTest {

    private static final Credentials CREDS = new Credentials("AKIDtestid", "test_secret_key", null);
    /** Fixed signing inputs for the Authorization vector below. */
    private static final long TS = 1757400000L;

    private HttpServer server;
    private final List<String> bodies = new ArrayList<>();
    private final List<String> auths = new ArrayList<>();
    private final List<String> actions = new ArrayList<>();
    private final List<String> versions = new ArrayList<>();
    private final List<String> regions = new ArrayList<>();
    private final List<String> responses = new ArrayList<>();
    private String baseUrl;
    private String host;

    @BeforeEach
    void startServer() throws Exception {
        bodies.clear();
        auths.clear();
        actions.clear();
        versions.clear();
        regions.clear();
        responses.clear();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            bodies.add(new String(readAll(exchange.getRequestBody()), StandardCharsets.UTF_8));
            auths.add(String.valueOf(exchange.getRequestHeaders().getFirst("Authorization")));
            actions.add(String.valueOf(exchange.getRequestHeaders().getFirst("X-TC-Action")));
            versions.add(String.valueOf(exchange.getRequestHeaders().getFirst("X-TC-Version")));
            regions.add(String.valueOf(exchange.getRequestHeaders().getFirst("X-TC-Region")));
            String body = responses.isEmpty() ? ok("Hello") : responses.remove(0);
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        host = "127.0.0.1:" + server.getAddress().getPort();
        baseUrl = "http://" + host;
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private TencentProvider provider() {
        return new TencentProvider(baseUrl, host, () -> TS);
    }

    private static String ok(String translation) {
        return "{\"Response\":{\"Source\":\"zh\",\"Target\":\"en\",\"Translation\":\"" + translation
            + "\",\"RequestId\":\"r-1\"}}";
    }

    // ---------- signer ----------

    @Test
    void primitivesMatchPublishedTestVectors() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            Tc3Signer.sha256Hex("abc".getBytes(StandardCharsets.UTF_8)));
        assertEquals("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
            java.util.HexFormat.of().formatHex(Tc3Signer.hmac256("Jefe".getBytes(StandardCharsets.UTF_8),
                "what do ya want for nothing?")));
    }

    /**
     * Full Authorization against a vector computed with Node's crypto (independent of this
     * codebase) from: ts=1757400000, secret AKIDtestid/test_secret_key, service tmt,
     * host tmt.tencentcloudapi.com, body {"SourceText":"你好","Source":"zh","Target":"en",
     * "ProjectId":0}.
     */
    @Test
    void authorizationMatchesExternalVector() {
        byte[] payload = "{\"SourceText\":\"你好\",\"Source\":\"zh\",\"Target\":\"en\",\"ProjectId\":0}"
            .getBytes(StandardCharsets.UTF_8);
        String auth = Tc3Signer.authorization("AKIDtestid", "test_secret_key", "tmt",
            "tmt.tencentcloudapi.com", "application/json; charset=utf-8", payload, TS);
        assertEquals("TC3-HMAC-SHA256 Credential=AKIDtestid/2025-09-09/tmt/tc3_request, "
            + "SignedHeaders=content-type;host, "
            + "Signature=253d3f1db5b35bf8d1a80cc6ede7452cc7fff9f432d297de537219ec4262f22e", auth);
    }

    // ---------- provider over HTTP ----------

    @Test
    void postsSignedTextTranslateRequest() {
        ProviderResult r = provider().translate(CREDS, "你好", "zh-CN", "en");

        assertEquals("TextTranslate", actions.get(0));
        assertEquals("2018-03-21", versions.get(0));
        assertEquals("ap-shanghai", regions.get(0));
        assertTrue(auths.get(0).startsWith("TC3-HMAC-SHA256 Credential=AKIDtestid/"), auths.get(0));
        assertTrue(auths.get(0).contains("Signature="));
        assertEquals("{\"SourceText\":\"你好\",\"Source\":\"zh\",\"Target\":\"en\",\"ProjectId\":0}",
            bodies.get(0));
        assertEquals("Hello", r.translation());
        assertEquals("zh-CN", r.detectedFrom());
    }

    @Test
    void blankFromSendsAuto() {
        provider().translate(CREDS, "abc", "", "zh-CN");
        assertTrue(bodies.get(0).contains("\"Source\":\"auto\""), bodies.get(0));
    }

    @Test
    void rejectsUnmappedLanguagesWithoutTouchingTheNetwork() {
        assertFalse(provider().supports("sw", "en"));
        ProviderException e = assertThrows(ProviderException.class,
            () -> provider().translate(CREDS, "habari", "sw", "en"));
        assertTrue(e.getMessage().contains("sw"));
        assertEquals(0, bodies.size());
    }

    @Test
    void splitsOnThe5000ByteBudgetAndJoinsChunkTranslations() throws Exception {
        String text = String.join("\n", java.util.Collections.nCopies(2000, "aaaa")); // 9999 bytes
        responses.add(ok("T1"));
        responses.add(ok("T2"));

        ProviderResult r = provider().translate(CREDS, text, "zh-CN", "en");

        assertEquals(2, bodies.size());
        for (String b : bodies) {
            // The 5000-byte budget covers SourceText itself; the JSON envelope around it
            // is larger because Jackson escapes every newline into two bytes.
            String sourceText = new com.fasterxml.jackson.databind.ObjectMapper()
                .readTree(b).path("SourceText").asText();
            assertTrue(sourceText.getBytes(StandardCharsets.UTF_8).length <= 5000, "chunk too big");
            // Line-aware: every line of a chunk is a whole "aaaa" line, never a cut fragment.
            assertTrue(sourceText.lines().allMatch(l -> l.equals("aaaa")), "split mid-line");
        }
        assertEquals(text, String.join("\n", bodies.stream()
            .map(b -> {
                try {
                    return new com.fasterxml.jackson.databind.ObjectMapper()
                        .readTree(b).path("SourceText").asText();
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            }).toList()), "chunks must reconstruct the text");
        assertEquals("T1\nT2", r.translation());
    }

    @Test
    void surfacesTencentErrorAsProviderException() {
        responses.add("{\"Response\":{\"Error\":{\"Code\":\"AuthFailure.SecretIdNotFound\","
            + "\"Message\":\"密钥不存在\"},\"RequestId\":\"r-2\"}}");
        ProviderException e = assertThrows(ProviderException.class,
            () -> provider().translate(CREDS, "你好", "zh-CN", "en"));
        assertTrue(e.getMessage().contains("AuthFailure.SecretIdNotFound"), e.getMessage());
        assertTrue(e.getMessage().contains("腾讯"), e.getMessage());
    }

    @Test
    void wrapsTransportFailures() {
        server.stop(0);
        ProviderException e = assertThrows(ProviderException.class,
            () -> provider().translate(CREDS, "你好", "zh-CN", "en"));
        assertTrue(e.getMessage().contains("腾讯"));
    }

    private static byte[] readAll(java.io.InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        in.transferTo(out);
        return out.toByteArray();
    }
}
