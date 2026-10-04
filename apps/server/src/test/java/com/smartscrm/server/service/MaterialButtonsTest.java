package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.smartscrm.server.common.BizException;
import org.junit.jupiter.api.Test;

/**
 * B17 P3 — button payload rules. Every rejection here is a constraint wa-js would enforce
 * at send time; catching it at save time is the whole point of this class.
 */
class MaterialButtonsTest {

    private static String payload(String... buttons) {
        return "{\"body\":\"选一个\",\"buttons\":[" + String.join(",", buttons) + "]}";
    }

    private static String reply(String id, String text) {
        return "{\"type\":\"reply\",\"text\":\"" + text + "\",\"id\":\"" + id + "\"}";
    }

    private static String url(String text) {
        return "{\"type\":\"url\",\"text\":\"" + text + "\",\"url\":\"https://example.com\"}";
    }

    @Test
    void acceptsASingleReplyButton() {
        MaterialButtons.requireValid(payload(reply("yes", "是")));
    }

    @Test
    void acceptsThreeButtons() {
        MaterialButtons.requireValid(
            payload(reply("a", "A"), reply("b", "B"), reply("c", "C")));
    }

    @Test
    void rejectsZeroButtons() {
        BizException ex = assertThrows(BizException.class,
            () -> MaterialButtons.requireValid("{\"body\":\"x\",\"buttons\":[]}"));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void rejectsFourButtons() {
        BizException ex = assertThrows(BizException.class, () -> MaterialButtons.requireValid(
            payload(reply("a", "A"), reply("b", "B"), reply("c", "C"), reply("d", "D"))));
        assertEquals(40000, ex.getCode());
    }

    /** 混用会被 wa-js 在发送时抛 reply_and_cta_btn_not_allowed，所以保存时就该拒。 */
    @Test
    void rejectsMixingReplyWithCta() {
        BizException ex = assertThrows(BizException.class,
            () -> MaterialButtons.requireValid(payload(reply("yes", "是"), url("官网"))));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void acceptsAllCtaButtons() {
        MaterialButtons.requireValid(payload(url("官网"), url("文档")));
    }

    @Test
    void rejectsUnknownButtonType() {
        BizException ex = assertThrows(BizException.class, () -> MaterialButtons.requireValid(
            payload("{\"type\":\"video\",\"text\":\"看视频\"}")));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void rejectsMissingText() {
        BizException ex = assertThrows(BizException.class,
            () -> MaterialButtons.requireValid(payload("{\"type\":\"reply\",\"id\":\"x\"}")));
        assertEquals(40000, ex.getCode());
    }

    /** WA 对可见文案有 20 字上限。 */
    @Test
    void rejectsOverlongText() {
        String longText = "x".repeat(21);
        BizException ex = assertThrows(BizException.class,
            () -> MaterialButtons.requireValid(payload(reply("a", longText))));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void rejectsMissingValueField() {
        BizException ex = assertThrows(BizException.class,
            () -> MaterialButtons.requireValid(payload("{\"type\":\"reply\",\"text\":\"是\"}")));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void rejectsBlankAndMalformedPayload() {
        assertThrows(BizException.class, () -> MaterialButtons.requireValid(null));
        assertThrows(BizException.class, () -> MaterialButtons.requireValid("  "));
        assertThrows(BizException.class, () -> MaterialButtons.requireValid("{not json"));
    }

    @Test
    void rejectsNonObjectRoot() {
        assertThrows(BizException.class, () -> MaterialButtons.requireValid("[1,2,3]"));
    }

    @Test
    void countOf_readsButtonCount() {
        assertEquals(2, MaterialButtons.countOf(payload(reply("a", "A"), reply("b", "B"))));
        assertEquals(0, MaterialButtons.countOf(null));
        assertEquals(0, MaterialButtons.countOf("{oops"));
    }
}
