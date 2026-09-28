package com.smartscrm.server.service.batch;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;

class BatchJsonTest {

    @Test
    void stringsSurviveQuotesBackslashAndNewline() {
        List<String> in = List.of("他说\"你好\"", "C:\\路径", "两\n行");
        String json = BatchJson.encodeStrings(in);
        assertEquals(in, BatchJson.readStrings(json));
    }

    @Test
    void longsRoundTripAndEmptyListIsTwoBrackets() {
        assertEquals("[7,8,9]", BatchJson.encodeLongs(List.of(7L, 8L, 9L)));
        assertEquals("[]", BatchJson.encodeStrings(List.of()));
        assertEquals(List.of(), BatchJson.readLongs("[]"));
        assertEquals(List.of(), BatchJson.readLongs(null));
    }

    @Test
    void malformedOrWrongShapeIsAnErrorNotEmptyList() {
        assertThrows(IllegalStateException.class, () -> BatchJson.readLongs("not json"));
        assertThrows(IllegalStateException.class, () -> BatchJson.readStrings("{}"));
        assertThrows(IllegalStateException.class, () -> BatchJson.readLongs("[\"x\"]"));
    }
}
