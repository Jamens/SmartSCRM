package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.smartscrm.server.common.BizException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Pure unit test: no Spring context, a temp dir stands in for the upload root. */
class MediaStorageServiceTest {

    @TempDir
    Path baseDir;
    private MediaStorageService service;

    @BeforeEach
    void setUp() {
        service = new MediaStorageService(baseDir);
    }

    @Test
    void store_writesFileAndReturnsStoredName() throws IOException {
        String name = service.store(new ByteArrayInputStream("hello".getBytes()), "pic.png", "image/png");
        assertTrue(name.endsWith(".png"), "后缀应来自原文件名: " + name);
        Path p = baseDir.resolve(name);
        assertTrue(Files.isRegularFile(p));
        assertEquals("hello", Files.readString(p));
    }

    @Test
    void store_usesFallbackExtensionWhenOriginalHasNone() throws IOException {
        String name = service.store(new ByteArrayInputStream("payload".getBytes()), null, "image/jpeg");
        assertTrue(name.endsWith(".jpg"), "无原扩展名时按 MIME 兜底: " + name);
    }

    @Test
    void store_rejectsUnsupportedMime() {
        BizException ex = assertThrows(BizException.class,
            () -> service.store(new ByteArrayInputStream("x".getBytes()), "a.exe", "application/x-msdownload"));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void store_rejectsEmptyContent() {
        BizException ex = assertThrows(BizException.class,
            () -> service.store(new ByteArrayInputStream(new byte[0]), "a.png", "image/png"));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void store_rejectsOversize() {
        byte[] big = new byte[(int) (16L * 1024 * 1024 + 1)];
        BizException ex = assertThrows(BizException.class,
            () -> service.store(new ByteArrayInputStream(big), "a.png", "image/png"));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void serve_returnsNullForUnknownName() {
        assertNull(service.serve("nope.jpg"));
    }

    @Test
    void delete_removesExistingFile() throws IOException {
        String name = service.store(new ByteArrayInputStream("data".getBytes()), "f.pdf", "application/pdf");
        assertTrue(service.delete(name));
        assertFalse(Files.exists(baseDir.resolve(name)));
        assertNull(service.serve(name));
    }

    @Test
    void delete_safeForAbsentName() {
        assertFalse(service.delete("ghost.png"));
    }

    @Test
    void serve_rejectsTraversal() {
        assertNull(service.serve("../escape.png"));
        assertNull(service.serve("a/../b.png"));
    }

    @Test
    void isMediaUrl_and_deleteIfMedia_onlyActOnOwnUrls() {
        assertFalse(service.isMediaUrl("https://x/y.png"));
        assertFalse(service.deleteIfMedia("https://x/y.png"));
        assertTrue(service.isMediaUrl("/api/materials/media/abc.png"));
    }

    @Test
    void mimeOf_mapsByExtension() {
        assertEquals("image/png", service.mimeOf(baseDir.resolve("x.png")));
        assertEquals("video/mp4", service.mimeOf(baseDir.resolve("x.mp4")));
        assertEquals("application/octet-stream", service.mimeOf(baseDir.resolve("x.unknownext")));
    }

    @Test
    void constantPrefix_isWhereMediaIsServed() {
        assertEquals("/api/materials/media/", MediaStorageService.MEDIA_URL_PREFIX);
        assertNotNull(MediaStorageService.MEDIA_URL_PREFIX);
    }
}
