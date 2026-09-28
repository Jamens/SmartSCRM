package com.smartscrm.server.service.batch;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class BatchRenderTest {

    @Test
    void replacesBothKnownTokens() {
        String out = BatchRender.render("你好 {客户名}，你的号码是 {号码}",
                new BatchRender.Fields("Ada", "15000000000@c.us", "15000000000"));
        assertEquals("你好 Ada，你的号码是 15000000000", out);
    }

    @Test
    void missingNicknameFallsBackToOpenIdTailFour() {
        String out = BatchRender.render("{客户名} 您好",
                new BatchRender.Fields(null, "1500009999@c.us", null));
        assertEquals("9999 您好", out);
    }

    @Test
    void openIdShorterThanFourKeepsWholeTail() {
        String out = BatchRender.render("{客户名}",
                new BatchRender.Fields("  ", "77@c.us", null));
        assertEquals("77", out);
    }

    @Test
    void missingPhoneRendersEmptyAndMissingEverythingIsSafe() {
        assertEquals("[]", BatchRender.render("[{号码}]", new BatchRender.Fields(null, null, null)));
        assertEquals("[]", BatchRender.render("[{客户名}]", new BatchRender.Fields(null, "", null)));
    }

    @Test
    void keepsUnknownBracesVerbatim() {
        BatchRender.Fields f = new BatchRender.Fields("Ada", "12345@c.us", "7");
        // 未识别的花括号一个都不吞（{a{b}、{}、未闭合的 {客户名 都原样活下来）。
        assertEquals("{订单号} Ada {a{b} {} 7 {客户名",
                BatchRender.render("{订单号} {客户名} {a{b} {} {号码} {客户名", f));
    }

    @Test
    void rendersWithoutTokensAndWithoutTemplate() {
        assertEquals("纯文本", BatchRender.render("纯文本", BatchRender.EMPTY_FIELDS));
        assertEquals("", BatchRender.render(null, BatchRender.EMPTY_FIELDS));
    }
}
