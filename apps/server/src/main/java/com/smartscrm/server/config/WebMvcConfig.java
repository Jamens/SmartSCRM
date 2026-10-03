package com.smartscrm.server.config;

import com.smartscrm.server.mapper.AdminPermissionMapper;
import com.smartscrm.server.security.AdminPermissionInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Registers the admin permission interceptor. */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final AdminPermissionMapper permissionMapper;

    public WebMvcConfig(AdminPermissionMapper permissionMapper) {
        this.permissionMapper = permissionMapper;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new AdminPermissionInterceptor(permissionMapper))
                .addPathPatterns("/api/admin/**");
    }
}
