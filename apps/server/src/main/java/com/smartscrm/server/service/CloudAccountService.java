package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.CloudAccount;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.CloudAccountMapper;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B21 云账号池 · 云账号数据层（租户隔离，spec §3）。
 *
 * <p>v1 覆盖四件事：分组挂靠（{@code groupId}）、状态（供统计卡与筛选）、
 * {@link #transfer} 批量转移、{@link #sync} 同步到本地。
 *
 * <p><strong>开源红线</strong>：{@code sync} 只是把云号落成一条本地 {@code platform_account} 记录
 * 并把 {@code syncedAccountId} 回写——不连任何真实云号服务、不发起任何外连。
 * 真实号源由部署方自托管后自行对接（与 B10 模拟拉流 / B13 模拟出口探测 / B14 模拟生成指纹同口径）。
 */
@Service
public class CloudAccountService {

    private static final Set<String> PLATFORMS = Set.of("whatsapp", "telegram", "line");
    private static final Set<String> STATUSES = Set.of("online", "offline", "warming", "banned");

    private final CloudAccountMapper mapper;
    private final CloudAccountGroupService groupService;
    private final PlatformAccountService platformAccountService;

    public CloudAccountService(CloudAccountMapper mapper, CloudAccountGroupService groupService,
                               PlatformAccountService platformAccountService) {
        this.mapper = mapper;
        this.groupService = groupService;
        this.platformAccountService = platformAccountService;
    }

    /** 新建云号。name 必填；groupId 非空时校验归属；platform/status 落库归一。 */
    @Transactional
    public CloudAccount create(Long tenantId, Long groupId, String name, String phone,
                               String platform, String status, String remark) {
        if (name == null || name.isBlank()) {
            throw new BizException(40000, "云号名称不能为空");
        }
        if (groupId != null) {
            groupService.requireOwned(tenantId, groupId);
        }
        CloudAccount a = new CloudAccount();
        a.setTenantId(tenantId);
        a.setGroupId(groupId);
        a.setName(name.trim());
        a.setPhone(phone == null || phone.isBlank() ? null : phone.trim());
        a.setPlatform(normalizePlatform(platform));
        a.setStatus(normalizeStatus(status));
        a.setRemark(remark == null || remark.isBlank() ? null : remark.trim());
        mapper.insert(a);
        return a;
    }

    public List<CloudAccount> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<CloudAccount>()
            .eq(CloudAccount::getTenantId, tenantId).orderByDesc(CloudAccount::getId));
    }

    public CloudAccount get(Long tenantId, Long id) {
        CloudAccount a = mapper.selectById(id);
        if (a == null || !tenantId.equals(a.getTenantId())) {
            throw new BizException(40404, "云号不存在: " + id);
        }
        return a;
    }

    /** 改：仅更新非 null 字段；groupId 传空串/null 表示不改动，显式 0 表示取消分组由调用方约定。 */
    @Transactional
    public CloudAccount update(Long tenantId, Long id, Long groupId, String name, String phone,
                               String platform, String status, String remark) {
        CloudAccount a = get(tenantId, id);
        if (groupId != null) {
            groupService.requireOwned(tenantId, groupId);
            a.setGroupId(groupId);
        }
        if (name != null) {
            if (name.isBlank()) throw new BizException(40000, "云号名称不能为空");
            a.setName(name.trim());
        }
        if (phone != null) a.setPhone(phone.isBlank() ? null : phone.trim());
        if (platform != null) a.setPlatform(normalizePlatform(platform));
        if (status != null) a.setStatus(normalizeStatus(status));
        if (remark != null) a.setRemark(remark.isBlank() ? null : remark.trim());
        mapper.updateById(a);
        return a;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        get(tenantId, id); // 归属校验，非本租户抛 404
        mapper.deleteById(id);
    }

    /**
     * 批量转移：把 ids 里的云号整体挪到 groupId 分组（groupId 为空 = 移出分组）。
     * 目标分组与本批次每个云号都做归属校验，任一越权即整批回滚（@Transactional）。
     *
     * @return 实际转移条数
     */
    @Transactional
    public int transfer(Long tenantId, List<Long> ids, Long groupId) {
        if (ids == null || ids.isEmpty()) {
            throw new BizException(40000, "请先选择要转移的云号");
        }
        if (groupId != null) {
            groupService.requireOwned(tenantId, groupId);
        }
        int n = 0;
        for (Long id : ids) {
            CloudAccount a = get(tenantId, id);
            a.setGroupId(groupId);
            mapper.updateById(a);
            n++;
        }
        return n;
    }

    /**
     * 同步到本地：把云号落成一条本地 platform_account 记录，并回写 syncedAt / syncedAccountId。
     * 纯本地写库，不连任何真实云号服务、不发起任何外连（开源红线）。
     */
    @Transactional
    public CloudAccount sync(Long tenantId, Long id) {
        CloudAccount a = get(tenantId, id);
        PlatformAccount local = new PlatformAccount();
        local.setPlatformType(platformTypeOf(a.getPlatform()));
        local.setName(a.getName());
        local.setPhone(a.getPhone());
        // 本地账号 status：1=在线，0=离线（同 DashboardService 口径）。
        local.setStatus("online".equals(a.getStatus()) ? 1 : 0);
        local.setRemark("云账号池同步 #" + a.getId());
        PlatformAccount created = platformAccountService.create(tenantId, local);
        a.setSyncedAt(LocalDateTime.now());
        a.setSyncedAccountId(created.getId());
        mapper.updateById(a);
        return a;
    }

    /** 云号平台 → platform_type（与 packages/shared PlatformType 一致：WhatsApp=1, Line=2, Telegram=4）。 */
    static Integer platformTypeOf(String platform) {
        return switch (platform) {
            case "telegram" -> 4;
            case "line" -> 2;
            default -> 1;
        };
    }

    private static String normalizePlatform(String platform) {
        if (platform == null) return "whatsapp";
        String p = platform.trim().toLowerCase();
        return PLATFORMS.contains(p) ? p : "whatsapp";
    }

    private static String normalizeStatus(String status) {
        if (status == null) return "offline";
        String s = status.trim().toLowerCase();
        return STATUSES.contains(s) ? s : "offline";
    }
}
