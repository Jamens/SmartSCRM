package com.smartscrm.server.service;

import com.smartscrm.server.common.BizException;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * B17 P1 — material ownership scope: the single place that knows the three scopes.
 *
 * <p>Modeled on {@code service/msg/ConversationScopeKey}: one class owns the vocabulary,
 * the validation, and the key shaping, so no caller re-derives them. Three scopes:
 * <ul>
 *   <li>{@code public} — tenant-wide, {@code owner_key} is NULL</li>
 *   <li>{@code personal} — one seat, {@code owner_key} = {@code app_user.id}</li>
 *   <li>{@code contact} — one customer, {@code owner_key} = {@code customer.id}</li>
 * </ul>
 */
public final class MaterialScope {

    public static final String PUBLIC = "public";
    public static final String PERSONAL = "personal";
    public static final String CONTACT = "contact";

    private static final Set<String> ALL = Set.of(PUBLIC, PERSONAL, CONTACT);

    private MaterialScope() {
    }

    /** Null / blank means "public": that is the DB default and the least surprising reading. */
    public static String normalize(String scope) {
        if (scope == null || scope.isBlank()) {
            return PUBLIC;
        }
        return scope.trim().toLowerCase(Locale.ROOT);
    }

    public static void requireValid(String scope) {
        String normalized = normalize(scope);
        if (!ALL.contains(normalized)) {
            throw new BizException(40000, "ownerScope 只能是 public / personal / contact");
        }
    }

    /**
     * Resolves the effective {@code owner_key}, which is where "never trust the caller"
     * is enforced: {@code personal} is always stamped with the caller's own user id, so a
     * client cannot file a material under someone else's name and then complain they
     * cannot see it. {@code contact} takes the customer id from the request because the
     * caller is binding the material to a customer, not to themselves.
     */
    public static String keyFor(String scope, Long userId, String requestedKey) {
        String normalized = normalize(scope);
        requireValid(normalized);
        return switch (normalized) {
            case PUBLIC -> null;
            case PERSONAL -> String.valueOf(userId);
            case CONTACT -> requireContactKey(requestedKey);
            default -> throw new BizException(40000, "ownerScope 只能是 public / personal / contact");
        };
    }

    /**
     * Whether a seat may use a material they already found by tenant. {@code contact} rows
     * are open to any seat: the material is bound to a customer, and whichever seat is
     * serving that customer is the one who needs it.
     */
    public static boolean usableBy(String scope, String ownerKey, Long userId) {
        String normalized = normalize(scope);
        if (PUBLIC.equals(normalized) || CONTACT.equals(normalized)) {
            return true;
        }
        // personal: only the owner. A null owner_key on a personal row is corrupt data;
        // fail closed rather than letting it become "visible to everyone".
        return ownerKey != null && Objects.equals(ownerKey, String.valueOf(userId));
    }

    private static String requireContactKey(String requestedKey) {
        if (requestedKey == null || requestedKey.isBlank()) {
            throw new BizException(40000, "contact 归属必须指定 ownerKey（客户 id）");
        }
        return requestedKey.trim();
    }
}
