package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

class SimulatedTranslationEngineTest {

    private static final Map<String, Map<String, String>> DICT = Map.of(
        "zh-CN", Map.of(
            "greet_hello", "你好",
            "ship_done", "订单已发货",
            "ship_done_ok", "订单已发货成功"),
        "en", Map.of(
            "greet_hello", "Hello",
            "ship_done", "your order has been shipped",
            "ship_done_ok", "your order has been shipped successfully"),
        "vi", Map.of(
            "greet_hello", "Xin chào",
            "ship_done", "đơn hàng đã được gửi"));

    private final SimulatedTranslationEngine engine =
        new SimulatedTranslationEngine(PhraseDict.of(DICT));

    @Test
    void prefersTheLongestMatchingPhrase() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("订单已发货成功", "zh-CN", "en", "1");
        assertEquals("your order has been shipped successfully", r.translation());
        assertFalse(r.partial());
    }

    @Test
    void keepsUnmatchedFragmentsAndMarksPartial() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("你好 abc123", "zh-CN", "en", "1");
        assertEquals("Hello abc123", r.translation());
        assertTrue(r.partial());
    }

    @Test
    void detectsSourceLanguageByBestCoverage() {
        assertEquals("vi", engine.translate("Xin chào", "", "en", "1").fromLang());
        assertEquals("zh-CN", engine.translate("订单已发货", "", "en", "1").fromLang());
    }

    @Test
    void matchesPhraseRegardlessOfCasing() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("hello", "en", "zh-CN", "1");
        assertEquals("你好", r.translation());
        assertFalse(r.partial());

        SimulatedTranslationEngine.EngineResult mixed =
            engine.translate("hello your ORDER has been shipped", "en", "zh-CN", "1");
        assertEquals("你好 订单已发货", mixed.translation());
        assertFalse(mixed.partial());
    }

    @Test
    void detectsSourceLanguageRegardlessOfCasing() {
        assertEquals("en", engine.translate("HELLO", "", "zh-CN", "1").fromLang());
    }

    @Test
    void spacesInsideMatchedPhrasesDoNotHideUnmatchedPunctuation() {
        SimulatedTranslationEngine.EngineResult r =
            engine.translate("Xin chào, đơn hàng đã được gửi", "", "zh-CN", "1");
        assertEquals("你好, 订单已发货", r.translation());
        assertEquals("vi", r.fromLang());
        assertTrue(r.partial());
    }

    @Test
    void unsupportedPairReturnsSourceTextAndPartial() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("habari gani", "sw", "is", "1");
        assertEquals("habari gani", r.translation());
        assertTrue(r.partial());
    }

    @Test
    void sameLanguageReturnsInputWithoutTouchingDictionary() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("你好", "zh-CN", "zh-CN", "3");
        assertEquals("你好", r.translation());
        assertFalse(r.partial());
    }

    @Test
    void googleKeepsLineBreaksAndDeeplCollapsesThem() {
        String twoLines = "你好\n订单已发货";
        assertEquals("Hello\nyour order has been shipped",
            engine.translate(twoLines, "zh-CN", "en", "1").translation());
        assertEquals("Hello your order has been shipped",
            engine.translate(twoLines, "zh-CN", "en", "2").translation());
    }

    @Test
    void chatGptStyleCapitalisesEnglishTarget() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("你好", "zh-CN", "en", "3");
        assertEquals("Hello.", r.translation());
    }

    @Test
    void geminiStyleAppendsChineseFullStopForChineseTarget() {
        SimulatedTranslationEngine.EngineResult r = engine.translate("你好", "en", "zh-CN", "4");
        assertEquals("你好。", r.translation());
    }

    @Test
    void normalizeCollapsesSpacesButKeepsNewlines() {
        assertEquals("a b\nc d", SimulatedTranslationEngine.normalize("  a   b \n c  d  "));
    }
}
