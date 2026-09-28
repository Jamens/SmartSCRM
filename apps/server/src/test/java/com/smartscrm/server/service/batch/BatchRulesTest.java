package com.smartscrm.server.service.batch;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
}
