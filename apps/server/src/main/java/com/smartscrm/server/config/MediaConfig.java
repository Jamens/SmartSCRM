package com.smartscrm.server.config;

import com.smartscrm.server.service.MediaStorageService;
import jakarta.servlet.MultipartConfigElement;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the material media store and the multipart upload ceiling.
 *
 * <p>The upload size limit is set here via {@link MultipartConfigElement} rather than in
 * application.yml: the YAML holds JWT secrets and other confidential values and must not be edited.
 * Servlet multipart limits can only be raised in code (the DispatcherServlet reads them from the
 * servlet registration), so this is the single sanctioned place — a {@code MultipartConfigElement}
 * bean with the same name overrides Spring Boot's auto-configured one.
 */
@Configuration
public class MediaConfig {

    private static final long MAX_FILE_BYTES = 16L * 1024 * 1024; // 16MB single file
    private static final long MAX_REQUEST_BYTES = 32L * 1024 * 1024; // 32MB whole request

    @Bean
    public MultipartConfigElement multipartConfigElement() {
        // location=null → container temp dir; threshold=0 → stream straight to disk.
        return new MultipartConfigElement(null, MAX_FILE_BYTES, MAX_REQUEST_BYTES, 0);
    }

    @Bean
    public MediaStorageService mediaStorageService(
        @Value("${scrm.upload.dir:}") String uploadDir) {
        String dir = (uploadDir == null || uploadDir.isBlank())
            ? Paths.get(System.getProperty("user.home"), ".smartscrm", "uploads").toString()
            : uploadDir;
        return new MediaStorageService(Paths.get(dir));
    }
}
