package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.CloudPhone;
import com.smartscrm.server.mapper.CloudPhoneMapper;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B10 云手机 · 数据层（租户隔离，spec §3）。
 *
 * <p>v1 不含启动/停止控制（spec §2 裁定），{@code status} 由表单显式设置，不自动流转。
 * 所有写操作校验归属：非本租户返回 404（仿 B20 单测口径）。
 */
@Service
public class CloudPhoneService {

    private static final Set<String> STATUSES = Set.of("offline", "booting", "online", "error");
    private static final Set<String> PROVIDERS = Set.of("generic", "vmos");

    private final CloudPhoneMapper mapper;

    public CloudPhoneService(CloudPhoneMapper mapper) {
        this.mapper = mapper;
    }

    /** 新建设备。name 必填；provider 落库归一（未知→generic）；status 默认 offline。 */
    @Transactional
    public CloudPhone create(Long tenantId, String name, String provider, String host,
                             String status, String androidVersion, String resolution,
                             Integer streamSeed, String remark) {
        if (name == null || name.isBlank()) {
            throw new BizException(40000, "设备名称不能为空");
        }
        CloudPhone d = new CloudPhone();
        d.setTenantId(tenantId);
        d.setName(name.trim());
        d.setProvider(normalizeProvider(provider));
        d.setHost(host == null || host.isBlank() ? null : host.trim());
        d.setStatus(normalizeStatus(status));
        d.setAndroidVersion(androidVersion == null || androidVersion.isBlank() ? null : androidVersion.trim());
        d.setResolution(resolution == null || resolution.isBlank() ? null : resolution.trim());
        d.setStreamSeed(streamSeed == null ? 1 : streamSeed);
        d.setRemark(remark == null || remark.isBlank() ? null : remark.trim());
        mapper.insert(d);
        return d;
    }

    public List<CloudPhone> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<CloudPhone>()
            .eq(CloudPhone::getTenantId, tenantId).orderByDesc(CloudPhone::getId));
    }

    public CloudPhone get(Long tenantId, Long id) {
        CloudPhone d = mapper.selectById(id);
        if (d == null || !tenantId.equals(d.getTenantId())) {
            throw new BizException(40404, "云手机设备不存在: " + id);
        }
        return d;
    }

    /** 改：仅更新非 null 字段。 */
    @Transactional
    public CloudPhone update(Long tenantId, Long id, String name, String provider, String host,
                             String status, String androidVersion, String resolution,
                             Integer streamSeed, String remark) {
        CloudPhone d = get(tenantId, id);
        if (name != null) {
            if (name.isBlank()) throw new BizException(40000, "设备名称不能为空");
            d.setName(name.trim());
        }
        if (provider != null) d.setProvider(normalizeProvider(provider));
        if (host != null) d.setHost(host.isBlank() ? null : host.trim());
        if (status != null) d.setStatus(normalizeStatus(status));
        if (androidVersion != null) d.setAndroidVersion(androidVersion.isBlank() ? null : androidVersion.trim());
        if (resolution != null) d.setResolution(resolution.isBlank() ? null : resolution.trim());
        if (streamSeed != null) d.setStreamSeed(streamSeed);
        if (remark != null) d.setRemark(remark.isBlank() ? null : remark.trim());
        mapper.updateById(d);
        return d;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        get(tenantId, id); // 归属校验，非本租户抛 404
        mapper.deleteById(id);
    }

    private static String normalizeProvider(String provider) {
        if (provider == null) return "generic";
        String p = provider.trim().toLowerCase();
        return PROVIDERS.contains(p) ? p : "generic";
    }

    private static String normalizeStatus(String status) {
        if (status == null) return "offline";
        String s = status.trim().toLowerCase();
        return STATUSES.contains(s) ? s : "offline";
    }
}
