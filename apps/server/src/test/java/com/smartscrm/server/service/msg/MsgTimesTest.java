package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.TimeZone;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/**
 * 方法顺序在这里是承重的：CHAT_ZONE 在 MsgTimes 被第一次触碰时就定格（类初始化），
 * 所以换区那条必须抢在本 JVM 里任何一处读 MsgTimes 之前跑，否则常量是在系统默认时区（+8）下抓的，
 * 换成 UTC 也看不出区别——实测过：不钉顺序时把 CHAT_ZONE 改成 ZoneId.systemDefault() 依然全绿。
 * 见 keepsAsiaShanghaiWhenTheJvmDefaultZoneIsUtc 里的行内注释。
 */
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class MsgTimesTest {

    private static final LocalDateTime RECEIVED = LocalDateTime.of(2026, 9, 20, 12, 0, 0);

    /**
     * 本机系统时区就是 +8，光看 epoch 那条断言分不清"按 CHAT_ZONE 算"和"跟随 JVM 默认时区"。
     * 这条把默认时区换成 UTC 再问同一个 epoch：CHAT_ZONE 仍然硬编码 Asia/Shanghai 才可能绿，
     * 一旦改成 ZoneId.systemDefault() 就会得到 2023-11-14T22:13:20 而变红。
     * 前提是本类的方法顺序保证这条最先跑（常量还没定格）。
     * 换完必须还原——漏还原会污染同一个 JVM 里的后续测试，那类污染极难查。
     */
    @Test
    @Order(1)
    void keepsAsiaShanghaiWhenTheJvmDefaultZoneIsUtc() {
        TimeZone original = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
            assertEquals("UTC", TimeZone.getDefault().getID(), "换区没生效的话这条断言是空的");
            // 注意：这一行是对 MsgTimes 的第一次触碰，CHAT_ZONE 就在这一刻定格，所以它必须在换区之后。
            // 把任何读 MsgTimes 的语句（包括下面那条常量断言）挪到 try 之前，都会让它改在 +8 下定格，
            // 这条用例就又不区分"硬编码"和"跟随系统"了。
            assertEquals(LocalDateTime.of(2023, 11, 15, 6, 13, 20),
                MsgTimes.toDbTime(1_700_000_000L, RECEIVED),
                "JVM 默认时区是 UTC：按 systemDefault 算会得到 2023-11-14T22:13:20");
            assertEquals(ZoneId.of("Asia/Shanghai"), MsgTimes.CHAT_ZONE,
                "公开的常量本身就是契约：Task 3/4 直接引用它来算墙钟");
        } finally {
            TimeZone.setDefault(original);
        }
        assertEquals(original.getID(), TimeZone.getDefault().getID(), "默认时区必须已经还原");
    }

    @Test
    void convertsEpochSecondsInAsiaShanghaiBecauseThatIsTheJdbcSessionZone() {
        // 1_700_000_000 = 2023-11-14 22:13:20 UTC = 2023-11-15 06:13:20 Asia/Shanghai
        assertEquals(LocalDateTime.of(2023, 11, 15, 6, 13, 20),
            MsgTimes.toDbTime(1_700_000_000L, RECEIVED));
    }

    /**
     * receivedAt 既是唯一的"现在几点"来源，也是不可信时间戳的唯一退回目标：
     * 为空时两条分支都必须显式失败，而不是一个返回 null、一个抛 NPE。
     */
    @Test
    void refusesToConvertWithoutAReceiveTime() {
        assertThrows(NullPointerException.class, () -> MsgTimes.toDbTime(1_700_000_000L, null));
        assertThrows(NullPointerException.class, () -> MsgTimes.toDbTime(null, null));
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
