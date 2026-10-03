package com.smartscrm.server.web.admin;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.service.admin.AdminTeamService;
import com.smartscrm.server.service.admin.AdminTeamService.TeamRow;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Team administration and membership assignment. */
@RestController
@RequestMapping("/api/admin/teams")
public class AdminTeamController {

    private final AdminTeamService teamService;

    public AdminTeamController(AdminTeamService teamService) {
        this.teamService = teamService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('team:list')")
    public ApiResponse<PageResult<TeamRow>> page(
        @RequestParam(required = false) Long tenantId,
        @RequestParam(defaultValue = "1") long page,
        @RequestParam(defaultValue = "20") long pageSize
    ) {
        return ApiResponse.ok(teamService.page(tenantId, page, pageSize));
    }

    @GetMapping("/{id}/members")
    @PreAuthorize("hasAuthority('team:view')")
    public ApiResponse<Set<Long>> members(@PathVariable Long id) {
        return ApiResponse.ok(teamService.memberIds(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('team:create')")
    public ApiResponse<TeamRow> create(@Valid @RequestBody TeamRequest req) {
        return ApiResponse.ok(teamService.create(req.scope(), req.tenantId(), req.name(), req.parentId()));
    }

    @PutMapping("/{id}/name")
    @PreAuthorize("hasAuthority('team:update')")
    public ApiResponse<Void> rename(@PathVariable Long id, @RequestParam @NotBlank String name) {
        teamService.rename(id, name);
        return ApiResponse.ok(null);
    }

    @PutMapping("/{id}/members")
    @PreAuthorize("hasAuthority('user:assignTeam')")
    public ApiResponse<Void> assignMembers(@PathVariable Long id, @RequestBody MemberRequest req) {
        teamService.assignMembers(id, req == null || req.userIds() == null ? Set.of() : req.userIds());
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('team:delete')")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        teamService.delete(id);
        return ApiResponse.ok(null);
    }

    /** Create payload for a team. */
    public record TeamRequest(
        @NotNull Integer scope,
        Long tenantId,
        @NotBlank String name,
        Long parentId
    ) {}

    /** Membership assignment payload. */
    public record MemberRequest(Set<Long> userIds) {}
}
