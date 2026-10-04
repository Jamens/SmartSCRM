package com.smartscrm.server.web.admin;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.entity.SysMenu;
import com.smartscrm.server.mapper.AdminPermissionMapper;
import com.smartscrm.server.security.AuthPrincipal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Minimal admin endpoint used to prove the permission pipeline works end to end.
 * Returns only the menu nodes the caller's active roles grant.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminMenuController {

    private final AdminPermissionMapper permissionMapper;

    public AdminMenuController(AdminPermissionMapper permissionMapper) {
        this.permissionMapper = permissionMapper;
    }

    /**
     * Sidebar tree for the current user. Guarded by the same code the frontend route
     * guard uses, so hiding a menu and rejecting the call cannot drift apart.
     */
    @GetMapping("/menus")
    @PreAuthorize("hasAuthority('access')")
    public ApiResponse<List<MenuNode>> menus(@AuthenticationPrincipal AuthPrincipal principal) {
        if (principal == null) {
            return ApiResponse.ok(List.of());
        }
        Set<SysMenu> granted = permissionMapper.selectMenusByUserId(principal.userId());
        return ApiResponse.ok(build(granted));
    }

    /**
     * Permission codes carried by the current request, after the interceptor has
     * enriched the principal. Useful to confirm revocation takes effect at once.
     */
    @GetMapping("/my-codes")
    @PreAuthorize("hasAuthority('access')")
    public ApiResponse<Set<String>> myCodes(@AuthenticationPrincipal AuthPrincipal principal) {
        if (principal == null) {
            return ApiResponse.ok(Set.of());
        }
        return ApiResponse.ok(principal.menuCodes());
    }

    /**
     * Full catalogue of every menu node (directories, menus and hidden button
     * nodes), unfiltered by the caller's own grants. Intended for the role-grant
     * editor so an admin can assign any node to any role. Contrast with
     * {@link #menus} which returns only the caller's own navigation tree.
     */
    @GetMapping("/menus/all")
    @PreAuthorize("hasAuthority('role:update')")
    public ApiResponse<List<MenuNode>> allMenus() {
        return ApiResponse.ok(build(new LinkedHashSet<>(permissionMapper.selectAllMenus())));
    }

    private List<MenuNode> build(Set<SysMenu> granted) {
        Map<Long, MenuNode> byId = new LinkedHashMap<>();
        List<MenuNode> roots = new ArrayList<>();
        for (SysMenu m : granted) {
            byId.put(m.getId(), new MenuNode(m.getId(), m.getName(), m.getCode(), m.getType(), m.getPath(), m.getIcon(), m.getSort()));
        }
        for (SysMenu m : granted) {
            MenuNode node = byId.get(m.getId());
            if (node == null) continue;
            MenuNode parent = m.getParentId() == null || m.getParentId() == 0 ? null : byId.get(m.getParentId());
            if (parent == null) roots.add(node);
            else parent.children.add(node);
        }
        return roots;
    }

    /** Sidebar node with nested children. */
    public static class MenuNode {
        public Long id;
        public String name;
        public String code;
        public Integer type;
        public String path;
        public String icon;
        public Integer sort;
        public List<MenuNode> children = new ArrayList<>();

        MenuNode(Long id, String name, String code, Integer type, String path, String icon, Integer sort) {
            this.id = id;
            this.name = name;
            this.code = code;
            this.type = type;
            this.path = path;
            this.icon = icon;
            this.sort = sort;
        }
    }
}
