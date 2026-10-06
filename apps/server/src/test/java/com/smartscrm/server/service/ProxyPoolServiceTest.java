package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ProxyPool;
import com.smartscrm.server.mapper.ProxyPoolMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** B13 单测：归属校验（跨租户 404）/ 缺名·缺地址 400 / protocol·status 归一 / 列表隔离 / 模拟探测确定性。 */
class ProxyPoolServiceTest {

    private static final Long TENANT = 1L, OTHER = 2L;

    private ProxyPoolMapper mapper;
    private ProxyPoolService svc;

    @BeforeEach
    void setUp() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), ProxyPool.class);
        mapper = mock(ProxyPoolMapper.class);
        svc = new ProxyPoolService(mapper);
    }

    private static ProxyPool proxy(Long id, Long tenantId) {
        ProxyPool d = new ProxyPool();
        d.setId(id);
        d.setTenantId(tenantId);
        d.setName("px-" + id);
        d.setHost("10.0.0." + id);
        d.setPort(1080);
        d.setProtocol("http");
        d.setStatus("offline");
        return d;
    }

    @Test
    void createRejectsBlankName() {
        assertThrows(BizException.class,
            () -> svc.create(TENANT, "  ", "10.0.0.1", 1080, "http", null, null, null, null));
    }

    @Test
    void createRejectsBlankHost() {
        assertThrows(BizException.class,
            () -> svc.create(TENANT, "proxy", "  ", 1080, "http", null, null, null, null));
    }

    @Test
    void createNormalizesProtocolAndStatus() {
        ProxyPool created = svc.create(TENANT, "PX", "10.0.0.9", 3128, "SOCKS5", "u", "p", "Online", "r");
        verify(mapper).insert(any(ProxyPool.class));
        assertEquals("socks5", created.getProtocol()); // 大写→小写，仍识别
        assertEquals("online", created.getStatus());
        assertEquals(3128, created.getPort());
        assertEquals(TENANT, created.getTenantId());
    }

    @Test
    void listIsTenantScoped() {
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(proxy(10L, TENANT)));
        List<ProxyPool> out = svc.list(TENANT);
        assertEquals(1, out.size());
        verify(mapper).selectList(any(LambdaQueryWrapper.class));
    }

    @Test
    void getEnforcesTenantIsolation() {
        when(mapper.selectById(10L)).thenReturn(proxy(10L, TENANT));
        assertEquals(10L, svc.get(TENANT, 10L).getId());
        // 跨租户 → 404
        when(mapper.selectById(11L)).thenReturn(proxy(11L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.get(TENANT, 11L));
        assertEquals(40404, ex.getCode());
        // 不存在 → 404
        when(mapper.selectById(99L)).thenReturn(null);
        assertThrows(BizException.class, () -> svc.get(TENANT, 99L));
    }

    @Test
    void updateAppliesPartialAndNormalizes() {
        ProxyPool existing = proxy(10L, TENANT);
        when(mapper.selectById(10L)).thenReturn(existing);
        ProxyPool up = svc.update(TENANT, 10L, null, "bogus-host", 8080, "WEIRD", null, null, "Error", null);
        // host 非 null 时按提供值处理（不校验格式），这里提供 "bogus-host" 应被采用
        assertEquals("bogus-host", up.getHost());
        assertEquals(8080, up.getPort());
        assertEquals("http", up.getProtocol());     // 未知 protocol → http
        assertEquals("error", up.getStatus());
        verify(mapper).updateById(any(ProxyPool.class));
        // 空名拒绝
        assertThrows(BizException.class,
            () -> svc.update(TENANT, 10L, "  ", null, null, null, null, null, null, null));
    }

    @Test
    void deleteEnforcesTenantIsolation() {
        when(mapper.selectById(10L)).thenReturn(proxy(10L, TENANT));
        svc.delete(TENANT, 10L);
        verify(mapper).deleteById(10L);
        // 跨租户删 → 404（get 先拒）
        when(mapper.selectById(11L)).thenReturn(proxy(11L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.delete(TENANT, 11L));
        assertEquals(40404, ex.getCode());
    }

    @Test
    void probeSimulatesEgressDeterministically() {
        ProxyPool existing = proxy(10L, TENANT);
        when(mapper.selectById(10L)).thenReturn(existing);
        ProxyPool probed = svc.probe(TENANT, 10L);
        assertEquals("online", probed.getStatus());
        assertNotNull(probed.getEgressIp());
        assertTrue(probed.getEgressIp().startsWith("203.0.113."), "出口 IP 应在 TEST-NET-3 占位网段");
        assertNotNull(probed.getEgressGeo());
        assertNotNull(probed.getLatencyMs());
        assertTrue(probed.getLatencyMs() >= 20 && probed.getLatencyMs() < 180, "延迟应在演示区间");
        assertNotNull(probed.getLastCheckedAt());
        verify(mapper).updateById(any(ProxyPool.class));
        // 跨租户 → 404（探测也受归属约束）
        when(mapper.selectById(11L)).thenReturn(proxy(11L, OTHER));
        assertThrows(BizException.class, () -> svc.probe(TENANT, 11L));
    }
}
