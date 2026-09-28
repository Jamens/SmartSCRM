package com.smartscrm.server.service.batch;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class BatchRulesTest {

    @Test
    void platformWhatsappOnly() {
        List<String> v = BatchRules.violations("telegram", 1, List.of("正文"), 1);
        assertTrue(v.contains("第一版只放开 whatsapp 平台"), "实际: " + v);
    }

    @Test
    void capsAreReportedTogetherNotFirstOnly() {
        List<String> contents = new ArrayList<>();
        for (int i = 0; i < 21; i++) {
            contents.add("正文" + i);
        }
        List<String> v = BatchRules.violations("whatsapp", 1001, contents, 20001);
        assertEquals(3, v.size(), "三条上限要一起回，实际: " + v);
        assertTrue(v.get(0).contains("1000"));
        assertTrue(v.get(1).contains("20"));
        assertTrue(v.get(2).contains("20000"));
    }

    @Test
    void blankAndOversizedBodiesAreNamedByIndex() {
        List<String> v = BatchRules.violations("whatsapp", 2, List.of("  ", "a".repeat(5001), "正常"), 6);
        assertEquals(2, v.size(), "实际: " + v);
        assertTrue(v.get(0).contains("第 1 条"), v.get(0));
        assertTrue(v.get(1).contains("第 2 条"), v.get(1));
    }

    @Test
    void realSendFloorsBiteButDryRunZeroPasses() {
        assertEquals(List.of(), BatchRules.intervalViolations(0, 0, 0, 0, true));
        List<String> v = BatchRules.intervalViolations(0, 8, 5, 15, false);
        assertEquals(1, v.size(), "实际: " + v);
        assertTrue(v.get(0).contains("3"), v.get(0));
    }

    @Test
    void intervalOrderAndCeiling() {
        List<String> v = BatchRules.intervalViolations(10, 8, 20, 4000, false);
        assertTrue(v.stream().anyMatch(s -> s.contains("min 不能大于 max")), "实际: " + v);
        assertTrue(v.stream().anyMatch(s -> s.contains("3600")), "实际: " + v);
    }

    @Test
    void renderedBodyIsWhatTheCapMeasuresNotTheTemplate() {
        // 模板那一遍只管向导里的字；真正要发出去的是渲染后的 body。
        // 这里两条都是「模板过、渲染后不过」的形状：4900 字模板 + 昵称填进来就破 5000，
        // 以及整条模板只剩一个没有兜底的 {号码}（渲染成空串）。
        List<String> longOnes = BatchRules.renderedViolations(List.of(
                row(1, "a".repeat(5001))));
        assertEquals(1, longOnes.size(), "实际: " + longOnes);
        assertTrue(longOnes.get(0).contains("seq 1"), longOnes.get(0));
        assertTrue(longOnes.get(0).contains("5000"), longOnes.get(0));

        assertEquals(1, BatchRules.renderedViolations(List.of(row(2, "   "))).size(),
                "渲染后只剩空白的行也要点名");
        assertEquals(List.of(), BatchRules.renderedViolations(List.of(row(3, "正常正文"))),
                "正常渲染不该多出一条违规");
    }

    @Test
    void renderedViolationCountsEveryRowButNamesOnlyThreeSeq() {
        List<BatchExpansion.ExpandedRow> rows = new ArrayList<>();
        for (int i = 1; i <= 5; i++) {
            rows.add(row(i, ""));
        }
        List<String> v = BatchRules.renderedViolations(rows);
        assertEquals(1, v.size(), "实际: " + v);
        assertTrue(v.get(0).contains("5 行"), "总数要说得出有几行: " + v.get(0));
        assertTrue(v.get(0).contains("seq 1、2、3"), "点名前三行: " + v.get(0));
        assertFalse(v.get(0).contains("、4"), "2 万行全点名会把 message 撑成一坨: " + v.get(0));
    }

    private static BatchExpansion.ExpandedRow row(int seq, String body) {
        return new BatchExpansion.ExpandedRow(seq, 7L, "8613800000000@c.us", null, 0, body);
    }
}
