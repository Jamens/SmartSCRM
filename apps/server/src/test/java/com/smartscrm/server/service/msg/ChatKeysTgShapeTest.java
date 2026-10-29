package com.smartscrm.server.service.msg;

// 期一：契约层，未经真机验证
// 期二待办：拿到真实 TG 账号后，实测 chat_key 是否恒为纯数字（超级群 -100… / 单聊正整数）；
//           若出现 'tg_' 前缀等非数字形态，须连同 ChatKeys.TG_CHAT、customer.open_id 的种子口径、
//           前端 tgChatKeyOf（src/shared/protocol/map.ts）与 ChatKeysTest 的反向闸一起改，不能只放宽一侧
// 契约见 docs/superpowers/specs/2026-10-28-telegram-mtproto-collection-design.md

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * TG 采集链期一（spec R3）的形态复查哨兵 + platform_type 映射闸。
 * <p>
 * 形态复查结论：{@code ChatKeys.TG_CHAT = ^-?\d{4,20}$} 与前端 {@code tgChatKeyOf}（{@code /^-?\d+$/}
 * 且去前导零后长度 4–20）**同形**，已覆盖超级群 {@code -1001234567890} 与单聊正整数，
 * 因此形态闸本轮**不改动**——下面前四个用例只是把这个结论钉住，防止以后有人顺手收紧/放宽导致两侧分叉。
 * <p>
 * 后半段的映射闸是后补的：前端 {@code @shared/chatPlatform.ts} 先加了 {@code TELEGRAM_PROTOCOL_ACCOUNT_TYPE = 8}，
 * 而 Java 侧没跟上，两处漂移。缺了 {@code case 8} 的话，期二即使接上真实 MTProto 网关，
 * {@code MessageService.resolveAccount} 仍会以 40000 把整批消息拒掉——本类把它钉住。
 * <p>
 * 纯单测：不起 Spring、不连库，只依赖 {@link ChatKeys} 的静态方法。
 */
class ChatKeysTgShapeTest {

    @Test
    void telegramAcceptsSupergroupChatKey() {
        assertTrue(ChatKeys.matchesPlatform("telegram", "-1001234567890"),
            "超级群：-100 前缀的负整数串必须过闸");
    }

    @Test
    void telegramAcceptsDirectChatKey() {
        assertTrue(ChatKeys.matchesPlatform("telegram", "1234567890"),
            "单聊：正整数串必须过闸");
    }

    @Test
    void telegramRejectsWhatsappShapedChatKey() {
        assertFalse(ChatKeys.matchesPlatform("telegram", "123@c.us"),
            "TG 不接受 WA 的 xxx@c.us 形态：写错源会把 WA 会话落到 TG 账号名下");
    }

    @Test
    void telegramRejectsNonNumericChatKey() {
        assertFalse(ChatKeys.matchesPlatform("telegram", "abc"),
            "TG 的 chat_key 形态闸：非数字一律不放过");
    }

    // -----------------------------------------------------------------------
    // platform_type → platform：与前端 @shared/chatPlatform.ts 的 BY_CODE 必须同形
    // -----------------------------------------------------------------------

    @Test
    void telegramProtocolAccountTypeMapsToTelegram() {
        assertEquals("telegram", ChatKeys.platformOfAccountType(8),
            "8 = TG 协议源（MTProto）：映射不成 platform 的话，期二的消息会被 40000 整批拒掉");
    }

    @Test
    void platformMappingSentinelsStayPut() {
        assertEquals("whatsapp", ChatKeys.platformOfAccountType(7),
            "回归哨兵：7 = WA 协议号，别被加 8 那次改动带坏");
        assertEquals("telegram", ChatKeys.platformOfAccountType(4),
            "回归哨兵：4 = TG 网页版，与 8 同 platform 列值但走不同接入面");
    }

    @Test
    void unsupportedAccountTypesStillRejected() {
        assertNull(ChatKeys.platformOfAccountType(null),
            "null → null：调用方据此拒绝入库");
        assertNull(ChatKeys.platformOfAccountType(0));
        assertNull(ChatKeys.platformOfAccountType(5));
        assertNull(ChatKeys.platformOfAccountType(9),
            "未支持的类型仍必须落到 default → null，不能因为加了 case 8 就把 unknown 一并放行");
    }

    /**
     * 映射闸与形态闸是两件事：8 映射出来的 "telegram" 要真的能过 {@link ChatKeys#matchesPlatform}，
     * 否则期二推来的消息会在形态闸上被静默丢掉——这里用映射的返回值跑形态闸，而不是写死字面量，
     * 这样以后改映射时这条会跟着红。
     */
    @Test
    void mappedTelegramPlatformStillPassesShapeGate() {
        String platform = ChatKeys.platformOfAccountType(8);
        assertEquals("telegram", platform);
        assertTrue(ChatKeys.matchesPlatform(platform, "-1001234567890"),
            "8 号账号的超级群 chat_key 必须过闸");
        assertTrue(ChatKeys.matchesPlatform(platform, "1234567890"),
            "8 号账号的单聊 chat_key 必须过闸");
        assertFalse(ChatKeys.matchesPlatform(platform, "123@c.us"),
            "8 号账号仍不接受 WA 形态：写错源会把 WA 会话落到 TG 账号名下");
    }
}
