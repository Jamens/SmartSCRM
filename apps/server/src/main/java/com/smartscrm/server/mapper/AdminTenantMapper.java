package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.Tenant;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * Tenant administration for the platform console.
 *
 * <p>Queries here deliberately carry no tenant filter. Platform administrators act
 * across tenants, so spanning every row is the intended behaviour. Keeping these
 * queries in their own mapper -- rather than reusing the tenant-scoped
 * {@code TenantMapper} -- makes that difference explicit and impossible to lose.
 */
public interface AdminTenantMapper extends BaseMapper<Tenant> {

    @Select("SELECT COUNT(*) FROM app_user WHERE tenant_id = #{tenantId}")
    long countUsers(@Param("tenantId") Long tenantId);

    /**
     * Platform accounts are the WhatsApp / Telegram logins a tenant operates,
     * named "platform" in the business tables.
     */
    @Select("SELECT COUNT(*) FROM platform_account WHERE tenant_id = #{tenantId}")
    long countPlatformAccounts(@Param("tenantId") Long tenantId);
}
