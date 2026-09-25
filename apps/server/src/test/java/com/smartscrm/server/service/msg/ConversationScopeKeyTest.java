package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.smartscrm.server.common.BizException;
import org.junit.jupiter.api.Test;

/**
 * 会话档 `scope_key` 形态的离线证据：本项目的后端里只有这里能把 (accountId, chatKey) 变成一条键，
 * 只有这一处断得清它什么时候不该变成键。跑不到的部分全在 tmp/p7a-conv-settings.mjs 的 8 行里。
 */
class ConversationScopeKeyTest {

    @Test
    void composesAccountIdColonChatKey() {
        assertEquals("5:8613800001001@c.us", ConversationScopeKey.compose(5L, "8613800001001@c.us"));
    }

    @Test
    void keepsChatKeyBytesUntouched() {
        // 键里不出现大小写折叠、不出现 trim：两条只差大小写的会话必须是两条（V9 的全部意义）
        String upper = ConversationScopeKey.compose(5L, "P7A-CASE-AA@c.us");
        String lower = ConversationScopeKey.compose(5L, "P7A-CASE-aa@c.us");
        assertTrue(!upper.equals(lower), "同 accountId 下只差大小写必须成出两条键");
        assertEquals("5:P7A-CASE-aa@c.us", lower);
    }

    @Test
    void rejectsMissingHalf() {
        assertEquals(40000, assertThrows(BizException.class,
            () -> ConversationScopeKey.compose(null, "8613800001001@c.us")).getCode());
        assertEquals(40000, assertThrows(BizException.class,
            () -> ConversationScopeKey.compose(5L, null)).getCode());
        assertEquals(40000, assertThrows(BizException.class,
            () -> ConversationScopeKey.compose(5L, "   ")).getCode());
    }

    @Test
    void rejectsWhitespaceAndControlsInside() {
        for (String bad : new String[] {"861380000100 1@c.us", "8613800001001@c.us\n", "a\tb"}) {
            assertEquals(40000, assertThrows(BizException.class,
                () -> ConversationScopeKey.compose(5L, bad)).getCode(), "应拒绝: " + bad);
        }
    }

    @Test
    void rejectsOverlongChatKey() {
        String atLimit = "x".repeat(ConversationScopeKey.CHAT_KEY_MAX);
        String over = "x".repeat(ConversationScopeKey.CHAT_KEY_MAX + 1);
        assertEquals("5:" + atLimit, ConversationScopeKey.compose(5L, atLimit));
        assertEquals(40000, assertThrows(BizException.class,
            () -> ConversationScopeKey.compose(5L, over)).getCode());
    }

    /** 读取那条出口不抛：页内上报的脏 chatKey 不该把整次翻译打成 400（spec §4① 的代价是回落，不是报错）。 */
    @Test
    void composeOrNullNeverThrows() {
        assertEquals("5:8613800001001@c.us", ConversationScopeKey.composeOrNull(5L, "8613800001001@c.us"));
        assertNull(ConversationScopeKey.composeOrNull(null, "8613800001001@c.us"));
        assertNull(ConversationScopeKey.composeOrNull(5L, " "));
        assertNull(ConversationScopeKey.composeOrNull(5L, "x".repeat(129)));
    }

    /**
     * `scope_key` 的排序规则 utf8mb4_bin 是 PAD SPACE：尾随空格在 uk_tset_tenant_scope 眼里等于没有，
     * 所以那条带空格的键存进去就跟那条不带的撞成一行，库里留不住任何痕迹——
     * 全系统唯一还能拦下它的地方就是本类。
     * <p>
     * 两条出口各断一次，才分得开"拒绝了这个空格"与"悄悄 trim 成了另一条键"：
     * compose 若做了归一，assertThrows 直接失败；composeOrNull 若做了归一，它会回那条被裁短的键而不是 null，
     * 于是写入口认得 A、读取口认得 B，保存照样报成功。
     */
    @Test
    void rejectsTrailingBlankInsteadOfTrimmingIt() {
        String padded = "8613800001001@c.us ";
        assertEquals(40000, assertThrows(BizException.class,
            () -> ConversationScopeKey.compose(5L, padded)).getCode(), "尾随空格必须被拒绝，不能被裁掉");
        assertNull(ConversationScopeKey.composeOrNull(5L, padded));
        assertNull(ConversationScopeKey.composeOrNull(5L, " 8613800001001@c.us"), "前置空格同理");
    }

    /** Task 4 的写侧是把这句话原样回成 400 的 message 的，所以"回个原因"本身就是它对外的契约：不是布尔的两态，也不是空串。 */
    @Test
    void rejectReasonStatesAReasonInsteadOfJustRefusing() {
        assertNull(ConversationScopeKey.rejectReason(5L, "8613800001001@c.us"), "可成形时必须回 null");
        String[] reasons = {
            ConversationScopeKey.rejectReason(null, "8613800001001@c.us"),
            ConversationScopeKey.rejectReason(5L, null),
            ConversationScopeKey.rejectReason(5L, "   "),
            ConversationScopeKey.rejectReason(5L, "8613800001001@c.us "),
            ConversationScopeKey.rejectReason(5L, "861380000100 1@c.us"),
            ConversationScopeKey.rejectReason(5L, "x".repeat(ConversationScopeKey.CHAT_KEY_MAX + 1)),
        };
        for (String reason : reasons) {
            assertTrue(reason != null && !reason.isBlank(), "每条不成形都得带回一句话，空串到前端就是一片空白: " + reason);
        }
    }
}
