package com.smartscrm.server.common;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

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

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleOther(Exception e) {
        return ResponseEntity.internalServerError().body(ApiResponse.error(50000, "internal error: " + e.getMessage()));
    }
}
