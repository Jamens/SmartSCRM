package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ChatKeysTest {

    @Test
    void mapsPlatformTypes() {
        assertEquals("whatsapp", ChatKeys.platformOfAccountType(1));
        assertEquals("telegram", ChatKeys.platformOfAccountType(4));
        assertNull(ChatKeys.platformOfAccountType(7));
        assertNull(ChatKeys.platformOfAccountType(null));
    }

    @Test
    void extractsPeerPhoneFromWhatsappChatKey() {
        assertEquals("8613800001001", ChatKeys.peerPhoneOf("8613800001001@c.us"));
        assertEquals("15533445566778899", ChatKeys.peerPhoneOf("15533445566778899@lid"));
        assertNull(ChatKeys.peerPhoneOf("12036325554444@g.us"), "群聊没有对端号码");
        assertNull(ChatKeys.peerPhoneOf("tg_10002003"), "TG 的 open id 不是手机号");
        assertNull(ChatKeys.peerPhoneOf(null));
    }

    @Test
    void detectsGroups() {
        assertTrue(ChatKeys.isGroup("12036325554444@g.us"));
        assertTrue(ChatKeys.isGroup("-1001234567890"));
        assertFalse(ChatKeys.isGroup("8613800001001@c.us"));
        assertFalse(ChatKeys.isGroup(null));
    }

    @Test
    void normalizesPhoneForFallbackMatch() {
        assertEquals("8613800001001", ChatKeys.normalizePhone("+86 138-0000-1001"));
        assertEquals("8613800001001", ChatKeys.normalizePhone("8613800001001"));
        assertNull(ChatKeys.normalizePhone("   "));
        assertNull(ChatKeys.normalizePhone(null));
    }

    @Test
    void chatKeyShapeMustMatchTheAccountPlatform() {
        assertTrue(ChatKeys.matchesPlatform("whatsapp", "8613800001001@c.us"));
        assertTrue(ChatKeys.matchesPlatform("whatsapp", "12036325554444@g.us"));
        assertTrue(ChatKeys.matchesPlatform("whatsapp", "15533445566778899@lid"));
        assertFalse(ChatKeys.matchesPlatform("whatsapp", "-1001234567890"));
        assertFalse(ChatKeys.matchesPlatform("whatsapp", "8613800001001"));
        assertTrue(ChatKeys.matchesPlatform("telegram", "-1001234567890"));
        assertTrue(ChatKeys.matchesPlatform("telegram", "123456789"));
        assertFalse(ChatKeys.matchesPlatform("telegram", "8613800001001@c.us"));
        assertFalse(ChatKeys.matchesPlatform("whatsapp", null));
        assertFalse(ChatKeys.matchesPlatform(null, "8613800001001@c.us"));
    }
}
