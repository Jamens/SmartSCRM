package com.smartscrm.server.common;

import org.springframework.http.HttpStatus;

public class BizException extends RuntimeException {

    private final int code;
    private final HttpStatus status;

    public BizException(int code, String message) {
        this(code, message, HttpStatus.BAD_REQUEST);
    }

    public BizException(int code, String message, HttpStatus status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public int getCode() {
        return code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public static BizException unauthorized(String message) {
        return new BizException(40100, message, HttpStatus.UNAUTHORIZED);
    }
}
