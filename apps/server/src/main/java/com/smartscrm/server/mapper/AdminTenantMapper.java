package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.Tenant;
import java.util.Collection;
import java.util.List;
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

    /**
     * Seat usage per tenant, fetched in one grouped query so the tenant list can
     * render "used / limit" without an N+1 count per row. Only rows with a
     * non-null tenant_id are counted (platform-scope accounts are excluded).
     */
    @Select("<script>"
            + "SELECT tenant_id AS tenantId, COUNT(*) AS cnt FROM app_user "
            + "WHERE tenant_id IN "
            + "<foreach collection='ids' item='id' open='(' separator=',' close=')'>#{id}</foreach> "
            + "GROUP BY tenant_id"
            + "</script>")
    List<TenantUserCount> userCountsByTenantIds(@Param("ids") Collection<Long> ids);

    /** tenant_id -> sub-account count, from {@link #userCountsByTenantIds}. */
    record TenantUserCount(Long tenantId, Long cnt) {}
}
