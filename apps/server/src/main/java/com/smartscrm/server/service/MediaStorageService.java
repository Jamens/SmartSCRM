package com.smartscrm.server.service;

import com.smartscrm.server.common.BizException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Local disk store for uploaded material media.
 *
 * <p>Why local files instead of inlining as data URIs: B17 inlined small images to dodge a
 * storage backend, but that caps materials at ~400KB and images only. Real media (video, audio,
 * documents) must live as files. They are served from {@code /api/materials/media/{name}}, which
 * is {@code permitAll} in SecurityConfig — a browser renders an {@code <img>} / {@code <video>}
 * without sending the Bearer token, so the endpoint cannot require auth. Access control is
 * "un-guessable name" (UUID), which is the pragmatic trade-off for an internal self-hosted tool.
 *
 * <p>Pure and Spring-free so it is unit-testable against a temp dir; it is wired as a bean in
 * MediaConfig.
 */
public class MediaStorageService {

    /** Public URL prefix; also the marker that a material.url points at our own store. */
    public static final String MEDIA_URL_PREFIX = "/api/materials/media/";

    private static final long MAX_BYTES = 16L * 1024 * 1024; // 16MB single file

    /**
     * Accept only what clients can present and we can serve back. Anything outside the list is
     * refused at upload time rather than stored and later refused at serve time.
     */
    private static final List<String> ALLOWED_MIME = List.of(
        "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/svg+xml",
        "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
        "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/aac",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/zip", "text/plain", "text/csv");

    private static final Map<String, String> MIME_TO_EXT = Map.ofEntries(
        Map.entry("image/jpeg", ".jpg"),
        Map.entry("image/png", ".png"),
        Map.entry("image/gif", ".gif"),
        Map.entry("image/webp", ".webp"),
        Map.entry("image/bmp", ".bmp"),
        Map.entry("image/svg+xml", ".svg"),
        Map.entry("video/mp4", ".mp4"),
        Map.entry("video/webm", ".webm"),
        Map.entry("video/quicktime", ".mov"),
        Map.entry("video/x-matroska", ".mkv"),
        Map.entry("audio/mpeg", ".mp3"),
        Map.entry("audio/mp3", ".mp3"),
        Map.entry("audio/wav", ".wav"),
        Map.entry("audio/x-wav", ".wav"),
        Map.entry("audio/ogg", ".ogg"),
        Map.entry("audio/mp4", ".m4a"),
        Map.entry("audio/aac", ".aac"),
        Map.entry("application/pdf", ".pdf"),
        Map.entry("application/zip", ".zip"),
        Map.entry("text/plain", ".txt"),
        Map.entry("text/csv", ".csv"),
        Map.entry("application/msword", ".doc"),
        Map.entry("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
        Map.entry("application/vnd.ms-excel", ".xls"),
        Map.entry("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
        Map.entry("application/vnd.ms-powerpoint", ".ppt"),
        Map.entry("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"));

    private final Path baseDir;

    public MediaStorageService(Path baseDir) {
        this.baseDir = baseDir;
    }

    /**
     * Persists the stream and returns the stored file name (NOT the full URL).
     *
     * @throws BizException 40000 on unsupported type, empty content, or oversize
     */
    public String store(InputStream in, String originalName, String mimeType) throws IOException {
        if (mimeType == null || !ALLOWED_MIME.contains(mimeType.toLowerCase(Locale.ROOT))) {
            throw new BizException(40000, "不支持的文件类型: " + mimeType);
        }
        // Read fully so the size limit is enforced here, not only by the servlet container.
        byte[] bytes = in.readAllBytes();
        if (bytes.length == 0) {
            throw new BizException(40000, "文件内容为空");
        }
        if (bytes.length > MAX_BYTES) {
            throw new BizException(40000, "文件超过 16MB 上限");
        }
        String storedName = UUID() + safeSuffix(originalName, mimeType);
        Path target = baseDir.resolve(storedName);
        Files.createDirectories(baseDir);
        Files.write(target, bytes);
        return storedName;
    }

    /** Path of the stored file, or null if the name is absent / unsafe / missing. */
    public Path serve(String storedName) {
        Path p = resolveSafe(storedName);
        if (p == null || !Files.isRegularFile(p)) {
            return null;
        }
        return p;
    }

    /** Content type to send back for a stored file; falls back on the extension. */
    public String mimeOf(Path p) {
        String name = p.getFileName().toString().toLowerCase(Locale.ROOT);
        int dot = name.lastIndexOf('.');
        if (dot >= 0) {
            String ext = name.substring(dot);
            for (Map.Entry<String, String> e : MIME_TO_EXT.entrySet()) {
                if (e.getValue().equals(ext)) {
                    return e.getKey();
                }
            }
        }
        return "application/octet-stream";
    }

    /** Deletes the stored file; safe to call for unknown/absent names. Returns true if removed. */
    public boolean delete(String storedName) {
        Path p = resolveSafe(storedName);
        if (p == null) {
            return false;
        }
        try {
            return Files.deleteIfExists(p);
        } catch (IOException e) {
            return false;
        }
    }

    /** If the url points at our store, delete the backing file and return true; else no-op. */
    public boolean deleteIfMedia(String url) {
        if (!isMediaUrl(url)) {
            return false;
        }
        return delete(url.substring(MEDIA_URL_PREFIX.length()));
    }

    public boolean isMediaUrl(String url) {
        return url != null && url.startsWith(MEDIA_URL_PREFIX);
    }

    /** Rejects path traversal and anything that escapes baseDir. */
    private Path resolveSafe(String storedName) {
        if (storedName == null || storedName.isBlank()) {
            return null;
        }
        if (storedName.contains("/") || storedName.contains("\\") || storedName.contains("..")) {
            return null;
        }
        Path base = baseDir.toAbsolutePath().normalize();
        Path resolved = base.resolve(storedName).normalize();
        if (!resolved.startsWith(base)) {
            return null;
        }
        return resolved;
    }

    private static String safeSuffix(String originalName, String mimeType) {
        String ext = "";
        if (originalName != null && originalName.contains(".")) {
            String s = originalName.substring(originalName.lastIndexOf('.')).toLowerCase(Locale.ROOT);
            // Only safe, short, lowercase alphanumeric extensions pass through.
            if (s.matches("\\.[a-z0-9]{1,8}")) {
                ext = s;
            }
        }
        if (ext.isBlank()) {
            ext = MIME_TO_EXT.getOrDefault(mimeType.toLowerCase(Locale.ROOT), "");
        }
        return ext;
    }

    private static String UUID() {
        return java.util.UUID.randomUUID().toString().replace("-", "");
    }
}
