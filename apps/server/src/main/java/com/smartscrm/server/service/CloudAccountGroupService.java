package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.CloudAccount;
import com.smartscrm.server.entity.CloudAccountGroup;
import com.smartscrm.server.mapper.CloudAccountGroupMapper;
import com.smartscrm.server.mapper.CloudAccountMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B21 云账号池 · 分组（租户隔离）。
 *
 * <p>删分组前先把挂靠的云号置为未分组，避免留下悬挂的 {@code group_id}
 * （否则前端会把「分组已删」误显示成号还在某个组里）。
 */
@Service
public class CloudAccountGroupService {

    private final CloudAccountGroupMapper mapper;
    private final CloudAccountMapper accountMapper;

    public CloudAccountGroupService(CloudAccountGroupMapper mapper, CloudAccountMapper accountMapper) {
        this.mapper = mapper;
        this.accountMapper = accountMapper;
    }

    public CloudAccountGroup create(Long tenantId, String name, String remark) {
        if (name == null || name.isBlank()) {
            throw new BizException(40000, "分组名不能为空");
        }
        CloudAccountGroup g = new CloudAccountGroup();
        g.setTenantId(tenantId);
        g.setName(name.trim());
        g.setRemark(remark == null || remark.isBlank() ? null : remark.trim());
        mapper.insert(g);
        return g;
    }

    public List<CloudAccountGroup> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<CloudAccountGroup>()
            .eq(CloudAccountGroup::getTenantId, tenantId).orderByAsc(CloudAccountGroup::getId));
    }

    public CloudAccountGroup get(Long tenantId, Long id) {
        CloudAccountGroup g = mapper.selectById(id);
        if (g == null || !tenantId.equals(g.getTenantId())) {
            throw new BizException(40404, "云号分组不存在: " + id);
        }
        return g;
    }

    /** 归属校验（供 CloudAccountService 校验目标分组），非本租户抛 404。 */
    public void requireOwned(Long tenantId, Long id) {
        get(tenantId, id);
    }

    @Transactional
    public CloudAccountGroup update(Long tenantId, Long id, String name, String remark) {
        CloudAccountGroup g = get(tenantId, id);
        if (name != null) {
            if (name.isBlank()) throw new BizException(40000, "分组名不能为空");
            g.setName(name.trim());
        }
        if (remark != null) g.setRemark(remark.isBlank() ? null : remark.trim());
        mapper.updateById(g);
        return g;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        get(tenantId, id);
        accountMapper.update(null, new LambdaUpdateWrapper<CloudAccount>()
            .eq(CloudAccount::getTenantId, tenantId)
            .eq(CloudAccount::getGroupId, id)
            .set(CloudAccount::getGroupId, null));
        mapper.deleteById(id);
    }
}
