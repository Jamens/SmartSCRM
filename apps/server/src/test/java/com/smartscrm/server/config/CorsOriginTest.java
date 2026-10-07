package com.smartscrm.server.config;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

/**
 * CORS 允许源判定。不启 Spring 上下文、不碰数据库，跑的是<b>真实的</b> {@code CorsFilter}
 * 与 {@code SecurityConfig} 里那份真实配置（配置抽成静态方法正是为此，测试不抄副本）。
 *
 * <p><b>为什么没有「file:// 页面」这条用例？</b>原先有一条断言「{@code Origin: null} 应被放行」，
 * 是按错误假设写的，已删。2026-10-07 实测（Electron 39.8.10，A/B 对照，结论见 README §7 第 6 条）：
 * {@code file://} 页面发出的跨源请求<b>根本不带 Origin 头，也不发预检</b>——服务器侧看到的是
 * {@code Sec-Fetch-Site: cross-site} 但 {@code Origin} 缺失，于是 {@code DefaultCorsProcessor}
 * 因 {@code requestOrigin == null} 直接跳过 CORS。同一探针在 {@code http://} 页面上则会发预检、
 * 并因缺 ACAO 被浏览器拦下，证明探针本身有效。所以打包态不受 CORS 约束，
 * <b>不需要</b>为它在允许源里配任何东西。
 */
class CorsOriginTest {

    /** 跑一次真实预检，返回 Access-Control-Allow-Origin 头；null 表示被拒。 */
    private static String preflightAllowOrigin(String origin) {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", SecurityConfig.corsConfiguration());
        CorsFilter filter = new CorsFilter(source);

        MockHttpServletRequest req = new MockHttpServletRequest("OPTIONS", "/api/tenant/info");
        req.addHeader("Origin", origin);
        req.addHeader("Access-Control-Request-Method", "GET");
        req.addHeader("Access-Control-Request-Headers", "authorization,content-type");
        MockHttpServletResponse res = new MockHttpServletResponse();

        try {
            filter.doFilter(req, res, new MockFilterChain());
        } catch (Exception e) {
            throw new IllegalStateException("预检执行异常: " + e, e);
        }
        return res.getHeader("Access-Control-Allow-Origin");
    }

    @Test
    void devServerOriginIsAllowed() {
        assertNotNull(preflightAllowOrigin("http://localhost:5173"),
                "开发态 vite dev server 必须放行，否则 electron-vite dev 下所有请求都会被浏览器拦下");
        assertNotNull(preflightAllowOrigin("http://127.0.0.1:5173"),
                "127.0.0.1 回环源同样必须放行");
    }

    @Test
    void externalOriginIsRejected() {
        assertNull(preflightAllowOrigin("https://evil.example.com"),
                "外部站点必须被拒——这是 CORS 存在的意义，不能为了别的目的把它一起放开");
        // 不透明源走正常拒绝路径。实测打包态根本不会发这个头（见类注释），此处只保证
        // 「万一有客户端发了 Origin: null」时不会误放行。
        assertNull(preflightAllowOrigin("null"), "Origin 为字面量 null 时不得放行");
    }
}