package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.SysRole;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** Role and role-to-menu administration for the platform console. */
public interface AdminRoleMapper extends BaseMapper<SysRole> {

    /**
     * Uniqueness is scoped, so a platform role and a tenant role may share a code.
     */
    @Select("SELECT COUNT(*) FROM sys_role WHERE scope = #{scope} AND code = #{code}")
    long existsByScopeAndCode(@Param("scope") Integer scope, @Param("code") String code);

    /**
     * Counts how many of the given codes actually exist, so a grant request can be
     * rejected wholesale when it names an unknown permission.
     */
    @Select({
        "<script>",
        "SELECT COUNT(*) FROM sys_menu WHERE code IN",
        "<foreach collection='codes' item='c' open='(' separator=',' close=')'>#{c}</foreach>",
        "</script>"
    })
    long countMenusByCodes(@Param("codes") Collection<String> codes);

    @Select({
        "<script>",
        "SELECT id FROM sys_menu WHERE code IN",
        "<foreach collection='codes' item='c' open='(' separator=',' close=')'>#{c}</foreach>",
        "</script>"
    })
    List<Long> menuIdsByCodes(@Param("codes") Collection<String> codes);

    @Select("SELECT menu_id FROM sys_role_menu WHERE role_id = #{roleId}")
    Set<Long> menuIdsByRoleId(@Param("roleId") Long roleId);

    @Delete("DELETE FROM sys_role_menu WHERE role_id = #{roleId}")
    void deleteMenusByRoleId(@Param("roleId") Long roleId);

    /**
     * Batch insert of grants. The foreach is wrapped so an empty list produces no
     * statement at all, letting "revoke everything" stay a single delete.
     */
    @Insert({
        "<script>",
        "INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES",
        "<foreach collection='menuIds' item='m' separator=','>(#{roleId}, #{m})</foreach>",
        "</script>"
    })
    void insertMenus(@Param("roleId") Long roleId, @Param("menuIds") Collection<Long> menuIds);
}
