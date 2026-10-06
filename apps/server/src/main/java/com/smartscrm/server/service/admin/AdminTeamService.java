package com.smartscrm.server.service.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.SysTeam;
import com.smartscrm.server.mapper.AdminTeamMapper;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/** Team administration for the platform console. */
@Service
public class AdminTeamService {

    private final AdminTeamMapper teamMapper;

    public AdminTeamService(AdminTeamMapper teamMapper) {
        this.teamMapper = teamMapper;
    }

    /**
     * @param tenantId nullable; when null the listing spans every tenant's teams
     */
    public PageResult<TeamRow> page(Long tenantId, long page, long pageSize) {
        LambdaQueryWrapper<SysTeam> w = new LambdaQueryWrapper<>();
        if (tenantId != null) {
            w.eq(SysTeam::getTenantId, tenantId);
        }
        w.orderByAsc(SysTeam::getParentId).orderByAsc(SysTeam::getId);

        Page<SysTeam> result = teamMapper.selectPage(new Page<>(page, pageSize), w);
        List<TeamRow> rows = result.getRecords().stream().map(AdminTeamService::toRow).toList();
        return PageResult.of(rows, result.getTotal(), result.getCurrent(), result.getSize());
    }

    public TeamRow create(Integer scope, Long tenantId, String name, Long parentId,
                          Integer type, Integer isPushTicket, String powers) {
        requireName(name);
        if (scope == null || (scope != 1 && scope != 2)) {
            throw new BizException(40001, "scope must be 1 (platform) or 2 (tenant)", HttpStatus.BAD_REQUEST);
        }
        if (scope == 2 && tenantId == null) {
            throw new BizException(40001, "tenantId is required for a tenant-scoped team", HttpStatus.BAD_REQUEST);
        }

        SysTeam t = new SysTeam();
        t.setTenantId(scope == 2 ? tenantId : null);
        t.setName(name.trim());
        t.setParentId(parentId == null ? 0L : parentId);
        t.setScope(scope);
        t.setType(normalizeType(type));
        t.setIsPushTicket(normalizePushTicket(isPushTicket));
        t.setPowers(blankToNull(powers));
        t.setStatus(1);
        teamMapper.insert(t);
        return toRow(t);
    }

    /**
     * Updates the department attributes carried by B22: type / isPushTicket / powers.
     * Every field is required by the contract (the console sends the full set), but each
     * is independently validated so a bad value is rejected rather than persisted.
     */
    public void updateConfig(Long id, Integer type, Integer isPushTicket, String powers) {
        SysTeam t = require(id);
        t.setType(normalizeType(type));
        t.setIsPushTicket(normalizePushTicket(isPushTicket));
        t.setPowers(blankToNull(powers));
        teamMapper.updateById(t);
    }

    private static int normalizeType(Integer type) {
        if (type == null || (type != 1 && type != 2)) {
            throw new BizException(40001, "type must be 1 (NORMAL) or 2 (DC)", HttpStatus.BAD_REQUEST);
        }
        return type;
    }

    private static int normalizePushTicket(Integer isPushTicket) {
        if (isPushTicket == null || (isPushTicket != 0 && isPushTicket != 1)) {
            throw new BizException(40001, "isPushTicket must be 0 or 1", HttpStatus.BAD_REQUEST);
        }
        return isPushTicket;
    }

    private static String blankToNull(String s) {
        return (s == null || s.trim().isEmpty()) ? null : s.trim();
    }

    public void rename(Long id, String name) {
        requireName(name);
        SysTeam t = require(id);
        t.setName(name.trim());
        teamMapper.updateById(t);
    }

    /**
     * Deleting a team that still has members is refused: silently orphaning people
     * would leave them with no team and no way to see it in the UI.
     */
    public void delete(Long id) {
        SysTeam t = require(id);
        long members = teamMapper.countMembers(id);
        if (members > 0) {
            throw new BizException(40005,
                    "team still has " + members + " member(s); reassign them first", HttpStatus.BAD_REQUEST);
        }
        teamMapper.deleteMembersByTeamId(id);
        teamMapper.deleteById(id);
    }

    /** Replaces the team's membership in one shot. */
    public void assignMembers(Long teamId, Set<Long> userIds) {
        SysTeam t = require(teamId);
        Set<Long> ids = userIds == null ? Set.of() : userIds;

        teamMapper.deleteMembersByTeamId(teamId);
        if (ids.isEmpty()) {
            return;
        }
        teamMapper.insertMembers(teamId, ids);
        t.getId();
    }

    public Set<Long> memberIds(Long teamId) {
        return teamMapper.memberIdsByTeamId(teamId);
    }

    private void requireName(String name) {
        if (!StringUtils.hasText(name) || name.trim().length() > 64) {
            throw new BizException(40001, "team name is required and must be under 64 chars", HttpStatus.BAD_REQUEST);
        }
    }

    private SysTeam require(Long id) {
        SysTeam t = teamMapper.selectById(id);
        if (t == null) {
            throw new BizException(40400, "team not found: " + id, HttpStatus.NOT_FOUND);
        }
        return t;
    }

    private static TeamRow toRow(SysTeam t) {
        return new TeamRow(t.getId(), t.getTenantId(), t.getParentId(), t.getName(), t.getScope(),
                t.getType(), t.getIsPushTicket(), t.getPowers(), t.getStatus());
    }

    /** Team as exposed to the admin console. */
    public record TeamRow(Long id, Long tenantId, Long parentId, String name, Integer scope,
                          Integer type, Integer isPushTicket, String powers, Integer status) {}
}
