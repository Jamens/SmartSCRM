package com.smartscrm.server.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResponse<Void>> handleBiz(BizException e) {
        return ResponseEntity.status(e.getStatus()).body(ApiResponse.error(e.getCode(), e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(f -> f.getField() + " " + f.getDefaultMessage())
            .orElse("invalid request");
        return ResponseEntity.badRequest().body(ApiResponse.error(40000, msg));
    }

    /**
     * 必填查询参数没带：这是调用方的请求形状错了，给 400 并点出缺的是哪一个。
     * 没有这一支时它会被下面的 catch-all 折成 500，手搓 URL 少带 {@code accountId}
     * 那种情况就看不出是自己少带了参数（spec §7 / Task 8b ④：缺参正是要它响，但得响在 400）。
     */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiResponse<Void>> handleMissingParam(MissingServletRequestParameterException e) {
        return ResponseEntity.badRequest()
            .body(ApiResponse.error(40000, e.getParameterName() + " is required"));
    }

    /**
     * 权限不足：{@code @PreAuthorize} 判定不通过时 Spring 抛 AccessDeniedException。
     * 不加这一支它会落到下面的 catch-all 变成 500，前端就分不清"没权限"和"服务端炸了"，
     * 而且真正的 500 会被这类正常拒绝淹没。权限拒绝必须响 403（spec §3.2）。
     */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> handleAccessDenied(AccessDeniedException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.error(40300, "forbidden"));
    }

    /**
     * 请求方法不对（例如用 GET 打只支持 POST 的端点）：这是调用方用错了，给 405。
     * 落到 catch-all 会变成 500，把"用错方法"和"服务端炸了"混为一谈。
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethodNotSupported(HttpRequestMethodNotSupportedException e) {
        String method = e.getMethod() == null ? "" : e.getMethod() + " ";
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(ApiResponse.error(40500, method + "not supported here"));
    }

    /**
     * 兜底 500：<b>不回吐 {@code e.getMessage()}</b>。
     *
     * <p>未捕获异常的 message 常含底层细节——MyBatis 的 SQL 片段与表名列名、JDBC URL、
     * 唯一约束名，{@code DataIntegrityViolationException} 还会带上出错的列值。这些交给客户端
     * 等于把库结构和数据形状写进了响应体，攻破一次错误信息就能反推 schema。
     *
     * <p>细节只进服务端日志（带堆栈，运维能查），客户端只拿到一句固定文案 + 错误码。
     * 需要给用户看的可读原因，走 {@link BizException} 显式抛出，那是有意设计的通道。
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleOther(Exception e) {
        log.error("未捕获异常 {}#{}: {}", e.getClass().getName(),
            e.getClass().getSimpleName(), e.getMessage(), e);
        return ResponseEntity.internalServerError().body(ApiResponse.error(50000, "internal error"));
    }
}
