package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.CloudPhone;
import com.smartscrm.server.mapper.CloudPhoneMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B10 单测：归属校验（跨租户 404）/ 缺名 400 / provider·status 归一 / 列表租户隔离。 */
class CloudPhoneServiceTest {

    private static final Long TENANT = 1L, OTHER = 2L;

    private CloudPhoneMapper mapper;
    private CloudPhoneService svc;

    @BeforeEach
    void setUp() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), CloudPhone.class);
        mapper = mock(CloudPhoneMapper.class);
        svc = new CloudPhoneService(mapper);
    }

    private static CloudPhone device(Long id, Long tenantId) {
        CloudPhone d = new CloudPhone();
        d.setId(id);
        d.setTenantId(tenantId);
        d.setName("dev-" + id);
        d.setProvider("generic");
        d.setStatus("offline");
        return d;
    }

    @Test
    void createRejectsBlankName() {
        assertThrows(BizException.class,
            () -> svc.create(TENANT, "  ", "generic", null, null, null, null, null, null));
    }

    @Test
    void createNormalizesProviderAndStatus() {
        CloudPhone created = svc.create(TENANT, "Pixel", "VMOS", "h:1", "online", "14", "1080x1920", null, "r");
        verify(mapper).insert(any(CloudPhone.class));
        assertEquals("vmos", created.getProvider());   // 大写→小写，仍识别
        assertEquals("online", created.getStatus());
        assertEquals(1, created.getStreamSeed());        // null → 默认 1
        assertEquals(TENANT, created.getTenantId());
    }

    @Test
    void listIsTenantScoped() {
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(device(10L, TENANT)));
        List<CloudPhone> out = svc.list(TENANT);
        assertEquals(1, out.size());
        ArgumentCaptor<LambdaQueryWrapper<CloudPhone>> cap = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(mapper).selectList(cap.capture());
    }

    @Test
    void getEnforcesTenantIsolation() {
        when(mapper.selectById(10L)).thenReturn(device(10L, TENANT));
        assertEquals(10L, svc.get(TENANT, 10L).getId());
        // 跨租户 → 404
        when(mapper.selectById(11L)).thenReturn(device(11L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.get(TENANT, 11L));
        assertEquals(40404, ex.getCode());
        // 不存在 → 404
        when(mapper.selectById(99L)).thenReturn(null);
        assertThrows(BizException.class, () -> svc.get(TENANT, 99L));
    }

    @Test
    void updateAppliesPartialAndNormalizes() {
        CloudPhone existing = device(10L, TENANT);
        when(mapper.selectById(10L)).thenReturn(existing);
        CloudPhone up = svc.update(TENANT, 10L, null, "bogus-provider", null, "ERROR", null, null, 42, null);
        assertEquals("generic", up.getProvider()); // 未知 provider → generic
        assertEquals("error", up.getStatus());
        assertEquals(42, up.getStreamSeed());
        verify(mapper).updateById(any(CloudPhone.class));
        // 空名拒绝
        assertThrows(BizException.class,
            () -> svc.update(TENANT, 10L, "  ", null, null, null, null, null, null, null));
    }

    @Test
    void deleteEnforcesTenantIsolation() {
        when(mapper.selectById(10L)).thenReturn(device(10L, TENANT));
        svc.delete(TENANT, 10L);
        verify(mapper).deleteById(10L);
        // 跨租户删 → 404（get 先拒）
        when(mapper.selectById(11L)).thenReturn(device(11L, OTHER));
        BizException ex = assertThrows(BizException.class, () -> svc.delete(TENANT, 11L));
        assertEquals(40404, ex.getCode());
    }
}
