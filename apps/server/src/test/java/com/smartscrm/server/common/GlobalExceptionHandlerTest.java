package com.smartscrm.server.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.ExceptionHandlerMethodResolver;

/**
 * 必填查询参数缺失的形状（spec §7 的 {@code GET /customer/{id}/groups}：Task 8b ④ 把 {@code accountId}
 * 设成必填，缺参正是要它响）。
 *
 * 这一支此前不存在：Spring 抛的 {@link MissingServletRequestParameterException} 掉进
 * {@code GlobalExceptionHandler} 的 catch-all（{@code Exception.class}），手搓 URL 少带一个参数会得到 500——
 * 调用方看不出是自己少带了参数，而 Task 14 的 HTTP 契约腿断的是 400。catch-all 本身一字未动。
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    /**
     * 断的是「Spring 会选哪个方法」，不是「我手动调了哪个方法」：
     * {@link ExceptionHandlerMethodResolver} 就是 MVC 解析 {@code @ExceptionHandler} 的那个组件，
     * 少了新的那一条分支，它会解析回 catch-all 的 {@code handleOther}（500 那一路），这条就红。
     */
    @Test
    void missingRequiredQueryParamResolvesToItsOwnBranchNotTheCatchAll() {
        ExceptionHandlerMethodResolver resolver =
            new ExceptionHandlerMethodResolver(GlobalExceptionHandler.class);
        Method m = resolver.resolveMethod(
            new MissingServletRequestParameterException("accountId", "Long"));

        assertNotNull(m, "缺参异常没有任何 @ExceptionHandler 认领");
        assertEquals("handleMissingParam", m.getName(),
            () -> "缺参被折进了 catch-all，那是 500: " + m);
    }

    /** 400 + 40000 + 点出缺的是哪一个参数；错误信封不带 {@code data}。 */
    @Test
    void missingRequiredQueryParamIs400NamingTheField() {
        ResponseEntity<ApiResponse<Void>> resp = handler.handleMissingParam(
            new MissingServletRequestParameterException("accountId", "Long"));

        assertEquals(HttpStatus.BAD_REQUEST, resp.getStatusCode());
        ApiResponse<Void> body = resp.getBody();
        assertNotNull(body);
        assertEquals(40000, body.code());
        assertEquals("accountId is required", body.message());
        assertNull(body.data());
    }
}
