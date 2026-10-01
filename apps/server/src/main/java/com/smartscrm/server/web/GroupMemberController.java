package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.GroupMemberQueryService;
import com.smartscrm.server.service.GroupMemberService;
import com.smartscrm.server.web.dto.GroupMemberBatchDTO;
import com.smartscrm.server.web.vo.GroupEventVO;
import com.smartscrm.server.web.vo.GroupExportRowVO;
import com.smartscrm.server.web.vo.GroupMemberVO;
import com.smartscrm.server.web.vo.GroupVO;
import jakarta.validation.Valid;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 群成员的读写入口（spec §7）。租户一律从 token 取，账号归属由服务层校验。 */
@RestController
@RequestMapping("/api/group-members")
public class GroupMemberController {

    private final GroupMemberService service;
    private final GroupMemberQueryService query;

    public GroupMemberController(GroupMemberService service, GroupMemberQueryService query) {
        this.service = service;
        this.query = query;
    }

    /**
     * 采集入库（主进程专用）。响应带 {@code reconciled / coverage / reason}，
     * 界面按它们决定要不要提示"本次未做退群判定"（spec §8）。
     */
    @PostMapping("/batch")
    public ApiResponse<GroupMemberService.IngestResult> batch(@AuthenticationPrincipal AuthPrincipal principal,
                                                              @Valid @RequestBody GroupMemberBatchDTO dto) {
        return ApiResponse.ok(service.ingest(principal.tenantId(), dto));
    }

    @GetMapping("/groups")
    public ApiResponse<PageResult<GroupVO>> groups(@AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam Long accountId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        var acc = service.resolveAccount(principal.tenantId(), accountId);
        return ApiResponse.ok(query.pageGroups(principal.tenantId(), acc.accountId(), acc.platform(), page, size));
    }

    @GetMapping("/group/members")
    public ApiResponse<Map<String, Object>> members(@AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam Long accountId,
            @RequestParam String chatKey,
            @RequestParam(required = false) Boolean isInGroup,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int size) {
        var acc = service.resolveAccount(principal.tenantId(), accountId);
        GroupMemberQueryService.MemberPage mp = query.pageMembers(principal.tenantId(), acc.accountId(),
            acc.platform(), chatKey, isInGroup, role, q, page, size);
        // 名单与快照新鲜度同一份响应返回：分两次取会让"名单是一秒前的、闸是三秒前的"这种错位成为可能。
        // 8b：coverage 为 null（首次建档，没有分母可除）必须原样返回 null，不能折成 ""。
        // 前端 MemberPageVO.coverage 是 number | null，"" 会让它拿不到"这是首次建档"的信号，
        // 从而把 first_build 误判成 ok 去算百分比。Map.of 不允许 null value，改用 HashMap。
        Map<String, Object> body = new HashMap<>();
        body.put("members", mp.page());
        body.put("coverage", mp.coverage());
        body.put("reason", mp.reason());
        return ApiResponse.ok(body);
    }

    @GetMapping("/group/events")
    public ApiResponse<PageResult<GroupEventVO>> events(@AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam Long accountId,
            @RequestParam String chatKey,
            @RequestParam(required = false) String eventType,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int size) {
        var acc = service.resolveAccount(principal.tenantId(), accountId);
        return ApiResponse.ok(query.pageEvents(principal.tenantId(), acc.accountId(), acc.platform(), chatKey,
            eventType, page, size));
    }

    @GetMapping("/customer/{customerId}/groups")
    public ApiResponse<List<GroupVO>> customerGroups(@AuthenticationPrincipal AuthPrincipal principal,
                                                     @RequestParam(required = false) Long accountId,
                                                     @PathVariable long customerId) {
        return ApiResponse.ok(query.customerGroups(principal.tenantId(), accountId, customerId));
    }

    /** 导出取数。列序与行序由服务层钉死，这里只负责转发与限流（50 群上限）。 */
    @GetMapping("/group/members/export-rows")
    public ApiResponse<List<GroupExportRowVO>> exportRows(@AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam Long accountId,
            @RequestParam List<String> chatKeys) {
        var acc = service.resolveAccount(principal.tenantId(), accountId);
        return ApiResponse.ok(query.exportRows(principal.tenantId(), acc.accountId(), acc.platform(), chatKeys));
    }
}
