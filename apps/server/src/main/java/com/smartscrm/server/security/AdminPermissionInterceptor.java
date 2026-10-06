package com.smartscrm.server.security;

import com.smartscrm.server.mapper.AdminPermissionMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 每请求解析一次权限并挂到 principal 上（撤权即时生效）。
 *
 * <p>权限在库里、不在 JWT：access token 有效期一周，塞进 token 会让被撤销的角色最长延迟七天
 * 才生效；每请求读一次意味着撤销在下一次调用就生效。
 *
 * <p><b>何时付出这次查库</b>：{@code /api/admin/**} 下所有端点，外加**任何带
 * {@code @PreAuthorize} 的 handler 方法**（含桌面业务端点——A16 桌面侧授权判定就靠这条）。
 * 其余路径只做一次廉价的注解反射检查就返回，不查库、不改行为，租户业务流量零成本。
 *
 * <p><b>为什么拦在 preHandle 却能喂到 {@code @PreAuthorize}</b>：{@code @EnableMethodSecurity}
 * 默认是 proxy/AOP 模式，求值发生在**控制器方法被调用时**，而 {@code HandlerInterceptor}
 * 的 preHandle 早于方法调用——所以这里 publish 的 authority，同请求的
 * {@code @PreAuthorize("hasAuthority('...')")} 看得到（已用真接口验证：管理端点 200）。
 * 若是 filter 期求值（另一种模式）就看不到，那时机制要另搭。
 */
public class AdminPermissionInterceptor implements HandlerInterceptor {

    static final String ADMIN_PREFIX = "/api/admin/";

    private final AdminPermissionMapper permissionMapper;

    public AdminPermissionInterceptor(AdminPermissionMapper permissionMapper) {
        this.permissionMapper = permissionMapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!isAdminPath(request) && !hasAuthzAnnotation(handler)) {
            return true;
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof AuthPrincipal principal)) {
            return true;
        }

        Set<String> codes = permissionMapper.selectMenuCodesByUserId(principal.userId());
        Set<String> granted = codes == null ? Collections.emptySet() : codes;
        AuthPrincipal enriched = new AuthPrincipal(
                principal.userId(),
                principal.tenantId(),
                principal.inviteCode(),
                principal.role(),
                principal.platformScope(),
                granted);

        // @PreAuthorize("hasAuthority('...')") 读的是 authority 集合、不是 principal，
        // 所以解析出的菜单码必须一并 publish 成 authority，否则 principal 填了码、判定却全拒。
        Set<GrantedAuthority> authorities = new HashSet<>();
        for (String code : granted) {
            authorities.add(new SimpleGrantedAuthority(code));
        }
        authorities.addAll(auth.getAuthorities());

        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(enriched, auth.getCredentials(), authorities));
        return true;
    }

    private boolean isAdminPath(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return uri != null && uri.startsWith(ADMIN_PREFIX);
    }

    /**
     * handler 方法（或其 bean 类型）上是否带 {@code @PreAuthorize}。带了就说明这个端点要走
     * 权限码判定，那才值得为它查一次库；没带就跳过。
     */
    private boolean hasAuthzAnnotation(Object handler) {
        if (!(handler instanceof HandlerMethod hm)) {
            return false;
        }
        return hm.getMethodAnnotation(PreAuthorize.class) != null
            || hm.getBeanType().isAnnotationPresent(PreAuthorize.class);
    }
}
