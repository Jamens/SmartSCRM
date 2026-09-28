package com.smartscrm.server.service.batch;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class BatchJsonTest {

    private static final String WHERE = "任务 7 的 contents";

    @Test
    void stringsSurviveQuotesBackslashAndNewline() {
        List<String> in = List.of("他说\"你好\"", "C:\\路径", "两\n行");
        String json = BatchJson.encodeStrings(in);
        assertEquals(in, BatchJson.readStrings(json, WHERE));
    }

    @Test
    void longsRoundTripAndEmptyListIsTwoBrackets() {
        assertEquals("[7,8,9]", BatchJson.encodeLongs(List.of(7L, 8L, 9L)));
        assertEquals("[]", BatchJson.encodeStrings(List.of()));
        assertEquals(List.of(), BatchJson.readLongs("[]", "任务 7 的 account_ids"));
        assertEquals(List.of(), BatchJson.readLongs(null, "任务 7 的 account_ids"));
    }

    @Test
    void malformedOrWrongShapeIsAnErrorNotEmptyList() {
        assertThrows(IllegalStateException.class, () -> BatchJson.readLongs("not json", "任务 7 的 account_ids"));
        assertThrows(IllegalStateException.class, () -> BatchJson.readStrings("{}", WHERE));
        assertThrows(IllegalStateException.class, () -> BatchJson.readLongs("[\"x\"]", "任务 7 的 account_ids"));
    }

    /**
     * 坏 JSON 里存的是别人的正文，异常文案是这条链上唯一会走出后端的东西（GlobalExceptionHandler
     * 把 getMessage() 原样回进响应体），所以它只许点名「哪个任务的哪一列」，不许带一个字的 payload。
     */
    @Test
    void failureNamesTheColumnButNeverCarriesThePayload() {
        String bad = "{\"secret\":\"13800000000\"}";
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> BatchJson.readStrings(bad, WHERE));
        assertTrue(e.getMessage().contains(WHERE), "要点名是哪一列: " + e.getMessage());
        assertFalse(e.getMessage().contains("13800000000"), "不许带 payload: " + e.getMessage());
        assertFalse(e.getMessage().contains("secret"), "不许带 payload: " + e.getMessage());
    }
}
