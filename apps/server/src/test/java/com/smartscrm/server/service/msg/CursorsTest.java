package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class CursorsTest {

    @Test
    void roundTripsToMillisBecauseDateTime3IsTheSortKey() {
        LocalDateTime t = LocalDateTime.of(2026, 9, 20, 14, 33, 20, 123_000_000);
        String raw = Cursors.encode(t, 42L);
        Cursors.Pos back = Cursors.decode(raw);
        assertEquals(t, back.time());
        assertEquals(42L, back.id());
    }

    @Test
    void rejectsGarbageInsteadOfThrowing() {
        assertNull(Cursors.decode(null));
        assertNull(Cursors.decode(""));
        assertNull(Cursors.decode("abc"));
        assertNull(Cursors.decode("1759000000000"));
        assertNull(Cursors.decode("1759000000000:notanumber"));
    }

    /** 同一毫秒内的两条消息靠 id 断开平局；游标必须两个都带上，否则翻页会漏或重。 */
    @Test
    void keepsTheIdTieBreaker() {
        LocalDateTime same = LocalDateTime.of(2026, 9, 20, 14, 33, 20);
        assertEquals(Cursors.encode(same, 7L), Cursors.encode(same, 7L));
        assertEquals(7L, Cursors.decode(Cursors.encode(same, 7L)).id());
    }
}
