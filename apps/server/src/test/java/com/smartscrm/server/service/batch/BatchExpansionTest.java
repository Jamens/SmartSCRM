package com.smartscrm.server.service.batch;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

class BatchExpansionTest {

    private static final List<String> TWO = List.of("第一条 {客户名}", "第二条 {号码}");

    private static final BatchExpansion.Recipient C1 = new BatchExpansion.Recipient(7L, "c1@c.us", 11L);
    private static final BatchExpansion.Recipient C2 = new BatchExpansion.Recipient(7L, "c2@c.us", null);

    private static final BatchExpansion.FieldSource NAMED = r ->
            new BatchRender.Fields("Nick-" + r.chatKey(), r.chatKey(), "13800000000");

    @Test
    void seqIsRecipientMajorAndContentsStayAdjacent() {
        List<BatchExpansion.ExpandedRow> rows =
                BatchExpansion.expand(List.of(C1, C2), TWO, NAMED);
        assertEquals(List.of(1, 2, 3, 4), rows.stream().map(BatchExpansion.ExpandedRow::seq).toList());
        assertEquals(List.of("c1@c.us", "c1@c.us", "c2@c.us", "c2@c.us"),
                rows.stream().map(BatchExpansion.ExpandedRow::chatKey).toList());
        assertEquals(List.of(0, 1, 0, 1),
                rows.stream().map(BatchExpansion.ExpandedRow::contentIndex).toList());
    }

    @Test
    void totalIsRecipientsTimesContents() {
        assertEquals(2 * TWO.size(), BatchExpansion.expand(List.of(C1, C2), TWO, NAMED).size());
        assertEquals(0, BatchExpansion.expand(List.of(), TWO, NAMED).size());
        assertEquals(0, BatchExpansion.expand(List.of(C1), List.of(), NAMED).size());
    }

    @Test
    void bodiesComeFromTheSameRendererForBothRecipients() {
        List<BatchExpansion.ExpandedRow> rows = BatchExpansion.expand(List.of(C1, C2), TWO, NAMED);
        assertEquals("第一条 Nick-c1@c.us", rows.get(0).body());
        assertEquals("第二条 13800000000", rows.get(1).body());
        assertEquals("第一条 Nick-c2@c.us", rows.get(2).body());
    }

    @Test
    void accountChatKeyAndCustomerIdAreCarriedThrough() {
        List<BatchExpansion.ExpandedRow> rows = BatchExpansion.expand(List.of(C1), TWO, BatchExpansion.NO_FIELDS);
        assertEquals(7L, rows.get(0).accountId());
        assertEquals(11L, rows.get(0).customerId().longValue());
        // NO_FIELDS 之下两个变量都走"什么都没有"的兜底：昵称空 + openId 空 → 空串。
        assertEquals("第一条 ", rows.get(0).body());
        assertEquals("第二条 ", rows.get(1).body());
    }
}
