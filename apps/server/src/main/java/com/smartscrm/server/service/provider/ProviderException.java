package com.smartscrm.server.service.provider;

/**
 * Any failure of an online provider: bad key, network, quota, rejected language pair.
 *
 * {@code retryable} answers one question only, and it answers it for the page: <b>会不会多点一次就
 * 好起来</b>。两个配置性死路由抛出点自己标 {@code false}（未配置密钥、语种不在这条线路的表上）；
 * 厂商侧的错误码一律留成 {@code true} —— 那张码表（限流 / 并发 / 配额 / 鉴权）不在这里维护，
 * 而误判成死路的代价是把一次真能救回来的重译入口关掉。
 */
public class ProviderException extends RuntimeException {

    private final boolean retryable;

    public ProviderException(String message) {
        this(message, true);
    }

    public ProviderException(String message, boolean retryable) {
        super(message);
        this.retryable = retryable;
    }

    public ProviderException(String message, Throwable cause) {
        this(message, cause, true);
    }

    public ProviderException(String message, Throwable cause, boolean retryable) {
        super(message, cause);
        this.retryable = retryable;
    }

    public boolean retryable() {
        return retryable;
    }
}
