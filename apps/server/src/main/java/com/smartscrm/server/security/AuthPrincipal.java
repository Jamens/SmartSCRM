package com.smartscrm.server.security;

import java.util.Collections;
import java.util.Set;

/**
 * Authenticated caller.
 *
 * <p>{@code tenantId} is nullable: platform-level accounts are not bound to a tenant.
 * {@code menuCodes} is empty here and is populated per-request by the admin permission
 * interceptor, so revoking a role takes effect on the next request rather than waiting
 * for the access token to expire.
 *
 * @param userId application user id
 * @param tenantId owning tenant, or null for platform accounts
 * @param inviteCode tenant invite code
 * @param role legacy role string carried by the token
 * @param platformScope true when the caller acts across tenants
 * @param menuCodes permission codes resolved for this request
 */
public record AuthPrincipal(
        Long userId,
        Long tenantId,
        String inviteCode,
        String role,
        boolean platformScope,
        Set<String> menuCodes) {

    /** Factory for callers resolved by the JWT filter, which does not resolve admin permissions. */
    public static AuthPrincipal of(Long userId, Long tenantId, String inviteCode, String role) {
        return new AuthPrincipal(userId, tenantId, inviteCode, role, false, Collections.emptySet());
    }
}
