package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class MsgTimesTest {

    private static final LocalDateTime RECEIVED = LocalDateTime.of(2026, 9, 20, 12, 0, 0);

    @Test
    void convertsEpochSecondsInAsiaShanghaiBecauseThatIsTheJdbcSessionZone() {
        // 1_700_000_000 = 2023-11-14 22:13:20 UTC = 2023-11-15 06:13:20 Asia/Shanghai
        assertEquals(LocalDateTime.of(2023, 11, 15, 6, 13, 20),
            MsgTimes.toDbTime(1_700_000_000L, RECEIVED));
    }

    @Test
    void clampsZeroAndFutureAndNegativeToReceiveTime() {
        assertEquals(RECEIVED, MsgTimes.toDbTime(0L, RECEIVED));
        assertEquals(RECEIVED, MsgTimes.toDbTime(-5L, RECEIVED));
        assertEquals(RECEIVED, MsgTimes.toDbTime(null, RECEIVED));
        assertEquals(RECEIVED, MsgTimes.toDbTime(9_999_999_999L, RECEIVED), "未来时间戳不可信");
    }

    @Test
    void pastTimestampsAreKeptAsIs() {
        LocalDateTime past = MsgTimes.toDbTime(1_000_000_000L, RECEIVED);
        assertNotEquals(RECEIVED, past);
        assertEquals(2001, past.getYear());
    }
}
