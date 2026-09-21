package com.smartscrm.server.web.vo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class MessageVOOrderTest {

    private static MessageVO msg(long id, LocalDateTime time) {
        return new MessageVO(id, 1L, "whatsapp", "8613800001001@c.us", "M" + id, "in", null,
            null, null, "b" + id, null, null, time, null, null, null);
    }

    private static List<Long> idsAfterSort(MessageVO... input) {
        List<MessageVO> rows = new ArrayList<>(List.of(input));
        rows.sort(MessageVO.CHRONOLOGICAL);
        return rows.stream().map(MessageVO::id).toList();
    }

    /** 输入故意给成倒序：排序没动的话断言就会红，"排了个寂寞"骗不过去。 */
    @Test
    void sortsAscendingByTime() {
        LocalDateTime early = LocalDateTime.of(2026, 9, 20, 10, 0);
        LocalDateTime late = LocalDateTime.of(2026, 9, 20, 11, 0);
        assertEquals(List.of(1L, 2L), idsAfterSort(msg(2L, late), msg(1L, early)));
    }

    /** DATETIME(3) 允许同一毫秒两条：只按时间排是不稳定序，平局必须由 id 断开。 */
    @Test
    void breaksTiesOnIdWithinTheSameMillisecond() {
        LocalDateTime same = LocalDateTime.of(2026, 9, 20, 10, 0, 30, 123_000_000);
        assertEquals(List.of(3L, 7L), idsAfterSort(msg(7L, same), msg(3L, same)));
    }

    /** id 只在平局时起作用，不能反过来盖过时间——自增 id 反映入库顺序，不是聊天顺序。 */
    @Test
    void timeWinsOverId() {
        LocalDateTime early = LocalDateTime.of(2026, 9, 20, 9, 0);
        LocalDateTime late = LocalDateTime.of(2026, 9, 20, 9, 0, 0, 500_000);
        assertEquals(List.of(9L, 2L), idsAfterSort(msg(2L, late), msg(9L, early)));
    }
}
