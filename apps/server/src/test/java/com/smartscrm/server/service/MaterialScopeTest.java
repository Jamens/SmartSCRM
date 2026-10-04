package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.smartscrm.server.common.BizException;
import org.junit.jupiter.api.Test;

/** B17 P1 — material ownership scope: vocabulary, validation, key shaping, and who may use a row. */
class MaterialScopeTest {

    @Test
    void normalize_blankOrNullFallsBackToPublic() {
        assertEquals("public", MaterialScope.normalize(null));
        assertEquals("public", MaterialScope.normalize("   "));
    }

    @Test
    void normalize_isCaseInsensitiveAndTrimmed() {
        assertEquals("personal", MaterialScope.normalize("  PERSONAL "));
    }

    @Test
    void requireValid_rejectsUnknownScope() {
        BizException ex = assertThrows(BizException.class, () -> MaterialScope.requireValid("team"));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void keyFor_publicIsAlwaysNullEvenIfAKeyIsSupplied() {
        assertNull(MaterialScope.keyFor("public", 7L, "123"));
    }

    /** personal 永远盖成调用者自己的 id：客户端传什么都改不了归属。 */
    @Test
    void keyFor_personalStampsTheCallerNotTheRequest() {
        assertEquals("7", MaterialScope.keyFor("personal", 7L, "999"));
        assertEquals("7", MaterialScope.keyFor("personal", 7L, null));
    }

    @Test
    void keyFor_contactTakesTheCustomerId() {
        assertEquals("42", MaterialScope.keyFor("contact", 7L, " 42 "));
    }

    @Test
    void keyFor_contactRequiresAKey() {
        BizException ex = assertThrows(BizException.class, () -> MaterialScope.keyFor("contact", 7L, null));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void usableBy_publicAndContactAreOpenToAnySeat() {
        assertTrue(MaterialScope.usableBy("public", null, 7L));
        // contact 档绑定的是客户，正在服务该客户的坐席就要能用，不限创建者。
        assertTrue(MaterialScope.usableBy("contact", "42", 7L));
        assertTrue(MaterialScope.usableBy("contact", "42", 999L));
    }

    @Test
    void usableBy_personalOnlyForTheOwner() {
        assertTrue(MaterialScope.usableBy("personal", "7", 7L));
        assertFalse(MaterialScope.usableBy("personal", "7", 8L));
    }

    /** 归属键为 null 的 personal 行是脏数据，必须判成不可用而不是"人人可见"。 */
    @Test
    void usableBy_personalWithoutKeyFailsClosed() {
        assertFalse(MaterialScope.usableBy("personal", null, 7L));
    }
}
