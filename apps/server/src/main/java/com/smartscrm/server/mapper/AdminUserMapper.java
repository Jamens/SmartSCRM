package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.AppUser;
import java.util.Collection;
import java.util.Set;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** Sub-account administration for the platform console. */
public interface AdminUserMapper extends BaseMapper<AppUser> {

    @Select("SELECT role_id FROM sys_user_role WHERE user_id = #{userId}")
    Set<Long> roleIdsByUserId(@Param("userId") Long userId);

    @Delete("DELETE FROM sys_user_role WHERE user_id = #{userId}")
    void deleteRolesByUserId(@Param("userId") Long userId);

    @Insert({
        "<script>",
        "INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES",
        "<foreach collection='roleIds' item='r' separator=','>(#{userId}, #{r})</foreach>",
        "</script>"
    })
    void insertRoles(@Param("userId") Long userId, @Param("roleIds") Collection<Long> roleIds);
}
