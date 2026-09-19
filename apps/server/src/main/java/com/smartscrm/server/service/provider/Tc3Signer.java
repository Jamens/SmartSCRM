package com.smartscrm.server.service.provider;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;

/**
 * TC3-HMAC-SHA256 (API 3.0) request signing, transcribed from the official
 * tencentcloud-sdk-java AbstractClient/Sign implementation: POST JSON to "/" with
 * signed headers "content-type;host" and the date/service/tc3_request key chain.
 */
final class Tc3Signer {

    static final String ALGORITHM = "TC3-HMAC-SHA256";

    private Tc3Signer() {
    }

    static String sha256Hex(byte[] b) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));
        } catch (Exception e) {
            throw new ProviderException("SHA-256 不可用", e);
        }
    }

    static byte[] hmac256(byte[] key, String msg) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, mac.getAlgorithm()));
            return mac.doFinal(msg.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new ProviderException("HmacSHA256 不可用", e);
        }
    }

    static String utcDate(long epochSeconds) {
        return Instant.ofEpochSecond(epochSeconds).atZone(ZoneOffset.UTC).toLocalDate().toString();
    }

    /** The complete Authorization header value for a POST JSON request against "/". */
    static String authorization(String secretId, String secretKey, String service, String host,
                                String contentType, byte[] payload, long epochSeconds) {
        String timestamp = String.valueOf(epochSeconds);
        String date = utcDate(epochSeconds);
        String canonicalHeaders = "content-type:" + contentType + "\n" + "host:" + host + "\n";
        String signedHeaders = "content-type;host";
        String canonicalRequest = "POST" + "\n" + "/" + "\n" + "" + "\n"
            + canonicalHeaders + "\n" + signedHeaders + "\n" + sha256Hex(payload);
        String credentialScope = date + "/" + service + "/tc3_request";
        String stringToSign = ALGORITHM + "\n" + timestamp + "\n" + credentialScope + "\n"
            + sha256Hex(canonicalRequest.getBytes(StandardCharsets.UTF_8));
        byte[] signingKey = hmac256(hmac256(hmac256(("TC3" + secretKey).getBytes(StandardCharsets.UTF_8), date),
            service), "tc3_request");
        String signature = HexFormat.of().withLowerCase().formatHex(hmac256(signingKey, stringToSign));
        return ALGORITHM + " " + "Credential=" + secretId + "/" + credentialScope + ", "
            + "SignedHeaders=" + signedHeaders + ", " + "Signature=" + signature;
    }
}
