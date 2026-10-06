package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ProxyPool;
import com.smartscrm.server.mapper.ProxyPoolMapper;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B13 代理池 · 数据层（租户隔离，spec §3）。
 *
 * <p>v1 不含自动轮换/健康巡检（spec §2 裁定），{@code status} 由表单显式设置，不自动流转。
 * {@link #probe(Long, Long)} 是本次交付里唯一带"会话出口 IP 探测 + 按 IP 查归属地"语义的动作，
 * 但遵循开源红线——不发起任何真实外连，由 host+port 派生确定性演示数据（TEST-NET-3 + 固定 Geo 表）。
 * 所有写操作校验归属：非本租户返回 404（仿 B20 单测口径）。
 */
@Service
public class ProxyPoolService {

    private static final Set<String> STATUSES = Set.of("online", "offline", "error", "degraded");
    private static final Set<String> PROTOCOLS = Set.of("http", "https", "socks5");

    // 模拟探测的归属地表：由 hash 落入，确定性可复现。country · region · city。
    private static final String[] GEO_POOL = {
        "CN · 广东 · 深圳", "CN · 北京 · 北京", "CN · 上海 · 上海",
        "US · California · San Jose", "JP · Tokyo · Tokyo",
        "SG · Singapore · Singapore", "DE · Hessen · Frankfurt",
        "HK · Hong Kong · Hong Kong"
    };

    private final ProxyPoolMapper mapper;

    public ProxyPoolService(ProxyPoolMapper mapper) {
        this.mapper = mapper;
    }

    /** 新建代理。name/host 必填；protocol 落库归一（未知→http）；status 默认 offline；port 默认 1080。 */
    @Transactional
    public ProxyPool create(Long tenantId, String name, String host, Integer port,
                            String protocol, String username, String password,
                            String status, String remark) {
        if (name == null || name.isBlank()) {
            throw new BizException(40000, "代理名称不能为空");
        }
        if (host == null || host.isBlank()) {
            throw new BizException(40000, "代理地址不能为空");
        }
        ProxyPool d = new ProxyPool();
        d.setTenantId(tenantId);
        d.setName(name.trim());
        d.setHost(host.trim());
        d.setPort(port == null ? 1080 : port);
        d.setProtocol(normalizeProtocol(protocol));
        d.setUsername(username == null || username.isBlank() ? null : username.trim());
        d.setPassword(password == null || password.isBlank() ? null : password);
        d.setStatus(normalizeStatus(status));
        d.setRemark(remark == null || remark.isBlank() ? null : remark.trim());
        mapper.insert(d);
        return d;
    }

    public List<ProxyPool> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<ProxyPool>()
            .eq(ProxyPool::getTenantId, tenantId).orderByDesc(ProxyPool::getId));
    }

    public ProxyPool get(Long tenantId, Long id) {
        ProxyPool d = mapper.selectById(id);
        if (d == null || !tenantId.equals(d.getTenantId())) {
            throw new BizException(40404, "代理记录不存在: " + id);
        }
        return d;
    }

    /** 改：仅更新非 null 字段。 */
    @Transactional
    public ProxyPool update(Long tenantId, Long id, String name, String host, Integer port,
                            String protocol, String username, String password,
                            String status, String remark) {
        ProxyPool d = get(tenantId, id);
        if (name != null) {
            if (name.isBlank()) throw new BizException(40000, "代理名称不能为空");
            d.setName(name.trim());
        }
        if (host != null) d.setHost(host.isBlank() ? null : host.trim());
        if (port != null) d.setPort(port);
        if (protocol != null) d.setProtocol(normalizeProtocol(protocol));
        if (username != null) d.setUsername(username.isBlank() ? null : username.trim());
        if (password != null) d.setPassword(password.isBlank() ? null : password);
        if (status != null) d.setStatus(normalizeStatus(status));
        if (remark != null) d.setRemark(remark.isBlank() ? null : remark.trim());
        mapper.updateById(d);
        return d;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        get(tenantId, id); // 归属校验，非本租户抛 404
        mapper.deleteById(id);
    }

    /**
     * 模拟出口探测：会话出口 IP 探测 + 按 IP 查归属地。
     *
     * <p>开源红线：不真实建连。由 host+port 派生确定性演示数据——
     * 出口 IP 落在 TEST-NET-3（203.0.113.0/24，RFC 5737 文档用途占位网段，非真实路由），
     * 归属地从固定 Geo 表选取，延迟 20–179ms。探测成功即把 status 置 online 并写回探测结果。
     * 后续若部署方自托管探测网关，以环境变量注入的实现替换此模拟即可（代码只留 env 入口）。
     */
    @Transactional
    public ProxyPool probe(Long tenantId, Long id) {
        ProxyPool d = get(tenantId, id);
        int h = Math.floorMod((d.getHost() + ":" + d.getPort()).hashCode(), 1 << 20);
        String egressIp = "203.0.113." + (h % 254 + 1);
        String geo = GEO_POOL[h % GEO_POOL.length];
        int latency = 20 + (h % 160);
        d.setStatus("online");
        d.setEgressIp(egressIp);
        d.setEgressGeo(geo);
        d.setLatencyMs(latency);
        d.setLastCheckedAt(LocalDateTime.now());
        mapper.updateById(d);
        return d;
    }

    private static String normalizeProtocol(String protocol) {
        if (protocol == null) return "http";
        String p = protocol.trim().toLowerCase();
        return PROTOCOLS.contains(p) ? p : "http";
    }

    private static String normalizeStatus(String status) {
        if (status == null) return "offline";
        String s = status.trim().toLowerCase();
        return STATUSES.contains(s) ? s : "offline";
    }
}
