package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.SysTeam;
import java.util.Collection;
import java.util.Set;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** Team administration for the platform console. */
public interface AdminTeamMapper extends BaseMapper<SysTeam> {

    @Select("SELECT COUNT(*) FROM sys_user_team WHERE team_id = #{teamId}")
    long countMembers(@Param("teamId") Long teamId);

    @Select("SELECT user_id FROM sys_user_team WHERE team_id = #{teamId}")
    Set<Long> memberIdsByTeamId(@Param("teamId") Long teamId);

    @Delete("DELETE FROM sys_user_team WHERE team_id = #{teamId}")
    void deleteMembersByTeamId(@Param("teamId") Long teamId);

    @Insert({
        "<script>",
        "INSERT IGNORE INTO sys_user_team (user_id, team_id) VALUES",
        "<foreach collection='userIds' item='u' separator=','>(#{u}, #{teamId})</foreach>",
        "</script>"
    })
    void insertMembers(@Param("teamId") Long teamId, @Param("userIds") Collection<Long> userIds);
}
