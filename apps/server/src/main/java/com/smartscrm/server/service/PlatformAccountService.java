package com.smartscrm.server.service;

import com.smartscrm.server.service.msg.MsgTimes;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class PlatformAccountService {

    private final PlatformAccountMapper mapper;
    private final FingerprintProfileService fingerprintService;

    public PlatformAccountService(PlatformAccountMapper mapper, FingerprintProfileService fingerprintService) {
        this.mapper = mapper;
        this.fingerprintService = fingerprintService;
    }

    public List<PlatformAccount> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<PlatformAccount>()
            .eq(PlatformAccount::getTenantId, tenantId)
            .orderByAsc(PlatformAccount::getId))
            .stream()
            .peek(this::withHasFlag)
            .toList();
    }

    public PlatformAccount create(Long tenantId, PlatformAccount body) {
        body.setId(null);
        body.setTenantId(tenantId);
        if (body.getViewId() == null || body.getViewId().isBlank()) {
            body.setViewId(UUID.randomUUID().toString());
        }
        if (existsViewId(tenantId, body.getViewId(), null)) {
            throw new BizException(40901, "该账号视图已存在");
        }
        body.setStatus(body.getStatus() == null ? 0 : body.getStatus());
        mapper.insert(body);
        return withHasFlag(mapper.selectById(body.getId()));
    }

    public PlatformAccount update(Long tenantId, Long id, PlatformAccount body) {
        PlatformAccount existing = requireOwned(tenantId, id);
        existing.setPlatformType(body.getPlatformType());
        existing.setName(body.getName());
        existing.setPhone(body.getPhone());
        existing.setAvatar(body.getAvatar());
        existing.setRemark(body.getRemark());
        mapper.updateById(existing);
        return withHasFlag(mapper.selectById(id));
    }

    /** 导入会话凭据（免扫码登录用）。仅覆盖凭据字段，不动其它配置。 */
    public void importCredential(Long tenantId, Long id, String credential) {
        PlatformAccount existing = requireOwned(tenantId, id);
        existing.setSessionCredential(credential);
        mapper.updateById(existing);
    }

    /** 清除已导入的会话凭据。 */
    public void clearCredential(Long tenantId, Long id) {
        PlatformAccount existing = requireOwned(tenantId, id);
        existing.setSessionCredential(null);
        mapper.updateById(existing);
    }

    /** 读取凭据原文（仅专门的 GET /credential 使用，列表已忽略）。 */
    public String getCredential(Long tenantId, Long id) {
        return requireOwned(tenantId, id).getSessionCredential();
    }

    /**
     * 绑定/解绑指纹档案（B14 指纹注入，spec R1：一个账号最多一份）。
     * {@code profileId} 为 null 即解绑——解绑后该账号不施加任何指纹（R2）。
     * 非 null 时 {@link FingerprintProfileService#get} 会挡住别租户的档案（40404）。
     *
     * <p>这里用 {@code LambdaUpdateWrapper.set} 而不是 {@code updateById}：MyBatis-Plus 默认的
     * NOT_NULL 字段策略会把 null 值从 SET 里剔掉，解绑就写不进库（写了也还是原值）。
     */
    public PlatformAccount bindFingerprint(Long tenantId, Long id, Long profileId) {
        PlatformAccount account = requireOwned(tenantId, id);
        if (profileId != null) {
            fingerprintService.get(tenantId, profileId);
        }
        mapper.update(null, new LambdaUpdateWrapper<PlatformAccount>()
            .eq(PlatformAccount::getId, account.getId())
            .set(PlatformAccount::getFingerprintProfileId, profileId));
        account.setFingerprintProfileId(profileId);
        return account;
    }

    private PlatformAccount withHasFlag(PlatformAccount account) {
        account.setHasCredential(account.getSessionCredential() != null);
        return account;
    }

    public void delete(Long tenantId, Long id) {
        requireOwned(tenantId, id);
        mapper.deleteById(id);
    }

    public void updateStatus(Long tenantId, Long id, Integer status) {
        PlatformAccount account = requireOwned(tenantId, id);
        account.setStatus(status);
        if (status != null && status == 1) {
            account.setLastLoginAt(LocalDateTime.now(MsgTimes.CHAT_ZONE));
        }
        mapper.updateById(account);
    }

    /**
     * 租户闸：账号不属于这个租户就当它不存在（40404，不用 403——403 会替别的租户确认
     * 「这个 id 是有主的」）。删除、凭据与影响预检三条路共用这一处判定。
     */
    public PlatformAccount requireOwned(Long tenantId, Long id) {
        PlatformAccount account = mapper.selectById(id);
        if (account == null || !account.getTenantId().equals(tenantId)) {
            throw new BizException(40404, "账号不存在");
        }
        return account;
    }

    private boolean existsViewId(Long tenantId, String viewId, Long excludeId) {
        return mapper.exists(new LambdaQueryWrapper<PlatformAccount>()
            .eq(PlatformAccount::getTenantId, tenantId)
            .eq(PlatformAccount::getViewId, viewId)
            .ne(excludeId != null, PlatformAccount::getId, excludeId));
    }
}
