package com.smartscrm.server.web.vo;

/**
 * Result of {@code POST /api/materials/media}: the URL to store on the material, plus metadata
 * the caller echoes into the material row so the file is self-describing.
 */
public record MaterialMediaVO(String url, String mimeType, long sizeBytes) {
}
