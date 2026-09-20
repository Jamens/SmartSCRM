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
        // 群号里的 '-' 只允许当分隔符：1234-5678@g.us 是 chat_conversation.chat_key 列注释自己举的例子，必须继续放过；
        // 全标点形状正是本方法要挡的脏数据，收紧前它是 true。
        assertTrue(ChatKeys.matchesPlatform("whatsapp", "1234-5678@g.us"));
        assertFalse(ChatKeys.matchesPlatform("whatsapp", "-----@g.us"));
        assertTrue(ChatKeys.matchesPlatform("telegram", "-1001234567890"));
        assertTrue(ChatKeys.matchesPlatform("telegram", "123456789"));
        assertFalse(ChatKeys.matchesPlatform("telegram", "8613800001001@c.us"));
        // telegram 分支等价于"纯数字即放过"，所以丢了 @c.us 后缀的 WA 号码在这条闸上是 true：
        // 形状歧义不由本闸负责，见 matchesPlatform 的 javadoc（钉住它是为了别被当 bug 顺手收紧）。
        assertTrue(ChatKeys.matchesPlatform("telegram", "8613800001001"));
        assertFalse(ChatKeys.matchesPlatform("whatsapp", null));
        assertFalse(ChatKeys.matchesPlatform(null, "8613800001001@c.us"));
    }

    /**
     * TG 的 chat_key 形态当前只认数字，与 chat_conversation.chat_key 的列注释同口径；
     * 'tg_' 前缀只出现在 platform_type=4 的 customer.open_id 种子里，两边形态未决，
     * 以 Task 0 的真实探测为准。
     * <p>
     * 这两条是故意钉住当前闸行为的反向闸：探测结论一旦要求收 'tg_'，放宽 TG_CHAT 会先把这里改红，
     * 逼那一次提交同时改掉种子口径与页内的 chatKeys.ts，而不是让两侧悄悄分叉。
     */
    @Test
    void telegramGateCurrentlyAcceptsNumericChatKeysOnly() {
        assertFalse(ChatKeys.matchesPlatform("telegram", "tg_10002003"),
            "tg_ 前缀当前不过闸；要收它，就得连 customer.open_id 的种子口径一起改");
        assertTrue(ChatKeys.matchesPlatform("telegram", "123456789"));
    }
}
