package com.smartscrm.server.web.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiTransferRule;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.AiTransferRuleService;
import java.util.List;
import java.util.Set;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * B28 P3 — the admin rule controller's tenant resolution.
 *
 * <p>This is the one piece of the controller with real logic and the only place a
 * cross-tenant mistake could be made, so it is covered directly: a tenant-bound admin
 * is pinned to its own tenant, an explicit foreign {@code tenantId} is refused rather
 * than ignored, and a platform admin must name a tenant.
 */
class AdminTakeoverRuleControllerTest {

    private AiTransferRuleService ruleService;
    private AdminTakeoverRuleController controller;

    @BeforeEach
    void setUp() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), AiTransferRule.class);
        ruleService = mock(AiTransferRuleService.class);
        controller = new AdminTakeoverRuleController(ruleService);
        when(ruleService.list(anyLong())).thenReturn(List.of());
    }

    private static AuthPrincipal tenantAdmin(Long tenantId) {
        return new AuthPrincipal(1L, tenantId, "DEMO0001", "tenant_admin", false, Set.of("ai_rule:list"));
    }

    private static AuthPrincipal platformAdmin() {
        return new AuthPrincipal(2L, null, null, "super_admin", true, Set.of("ai_rule:list"));
    }

    @Test
    void list_pinsTenantAdminToItsOwnTenant() {
        controller.list(tenantAdmin(7L), null);
        verify(ruleService).list(7L);
    }

    @Test
    void list_acceptsExplicitSameTenant() {
        controller.list(tenantAdmin(7L), 7L);
        verify(ruleService).list(7L);
    }

    @Test
    void list_refusesForeignTenantInsteadOfSilentlyRedirecting() {
        BizException ex = assertThrows(BizException.class, () -> controller.list(tenantAdmin(7L), 99L));
        assertEquals(40300, ex.getCode());
        verify(ruleService, never()).list(anyLong());
    }

    @Test
    void list_requiresExplicitTenantForPlatformAdmin() {
        BizException ex = assertThrows(BizException.class, () -> controller.list(platformAdmin(), null));
        assertEquals(40001, ex.getCode());
    }

    @Test
    void list_usesRequestedTenantForPlatformAdmin() {
        controller.list(platformAdmin(), 42L);
        verify(ruleService).list(42L);
    }
}
