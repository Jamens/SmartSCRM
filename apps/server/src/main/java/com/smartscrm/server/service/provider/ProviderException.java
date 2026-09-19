package com.smartscrm.server.service.provider;

/** Any failure of an online provider: bad key, network, quota, rejected language pair. */
public class ProviderException extends RuntimeException {

    public ProviderException(String message) {
        super(message);
    }

    public ProviderException(String message, Throwable cause) {
        super(message, cause);
    }
}
