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
        // A16 桌面侧授权：注册到 /api/**，但拦截器内部只在「/api/admin/** 或 handler 带
        // @PreAuthorize」时才查库——其余业务端点只做一次廉价注解检查就返回，零查库、零行为变更。
        registry.addInterceptor(new AdminPermissionInterceptor(permissionMapper))
                .addPathPatterns("/api/**");
    }
}
