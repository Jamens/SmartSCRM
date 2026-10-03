package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.SysMenu;
import java.util.Set;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * Permission lookups for the admin console. Platform-side queries deliberately
 * carry no tenant filter; tenant isolation is expressed by role binding instead.
 */
public interface AdminPermissionMapper {

    /**
     * Resolves every menu code granted to a user, active roles only.
     * One join query per request keeps revocation effective immediately rather
     * than waiting for the access token to expire.
     *
     * @param userId app_user id
     * @return granted permission codes, never null
     */
    @Select("""
        SELECT DISTINCT m.code
        FROM sys_user_role ur
        JOIN sys_role r ON r.id = ur.role_id AND r.status = 1
        JOIN sys_role_menu rm ON rm.role_id = r.id
        JOIN sys_menu m ON m.id = rm.menu_id
        WHERE ur.user_id = #{userId}
        """)
    Set<String> selectMenuCodesByUserId(@Param("userId") Long userId);

    /**
     * Menu nodes granted to a user, ordered for sidebar rendering.
     *
     * @param userId app_user id
     * @return granted nodes, never null
     */
    @Select("""
        SELECT m.id, m.parent_id, m.name, m.code, m.type, m.path, m.icon, m.sort
        FROM sys_user_role ur
        JOIN sys_role r ON r.id = ur.role_id AND r.status = 1
        JOIN sys_role_menu rm ON rm.role_id = r.id
        JOIN sys_menu m ON m.id = rm.menu_id
        WHERE ur.user_id = #{userId}
        ORDER BY m.type, m.sort, m.id
        """)
    Set<SysMenu> selectMenusByUserId(@Param("userId") Long userId);
}
