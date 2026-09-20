package com.smartscrm.server.service.msg;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Objects;

/**
 * 页内上报的是 unix 秒。库里的 DATETIME(3) 与 JDBC 会话时区成对，
 * 所以这里固定的 Asia/Shanghai 必须与 application.yml 里 jdbc url 的 serverTimezone 一致。
 * <p>
 * 墙钟要真正对上，成对的是三件事而不是两件：本类的 CHAT_ZONE（秒数按哪个区摊成墙钟）、
 * jdbc url 的 serverTimezone（会话把这个区当成哪一区）、JVM 的 user.timezone
 * （所有带时刻的类型——Instant / java.util.Date / 服务端的 NOW() 与 session time_zone——
 * 落进同一列时的换算基准）。本类只经手 LocalDateTime 字面量通道，但同一列上别的写入者不是，
 * 所以三处口径必须一起看，改一处要在另两处留下指认。
 */
public final class MsgTimes {

    public static final ZoneId CHAT_ZONE = ZoneId.of("Asia/Shanghai");
    /** 允许的最大未来偏移：手机与电脑时钟总有偏差，超过这个就当不可信。 */
    private static final long FUTURE_SLACK_SEC = 300;

    private MsgTimes() {
    }

    /**
     * 不可信就退回接收时刻：epochSec 为 null / 非正 / 超出 receivedAt 之后 300 秒的，都返回 receivedAt，
     * 其余按 CHAT_ZONE 原样换算（过去的时间戳不动它，不做"取 max"式的向上钳）。
     *
     * @param epochSec    页内上报的 unix 秒，可空
     * @param receivedAt  采集侧收到这条消息那一刻的墙钟，非空，且必须是按 {@link #CHAT_ZONE}
     *                    读出的值（{@code LocalDateTime.now(CHAT_ZONE)}）。它同时是本方法唯一的
     *                    "现在几点"来源：传进来的墙钟整体偏移，未来钳制窗口就跟着整体平移——
     *                    偏早会把正常时间戳全判成未来而统统退回入库时刻，偏晚会让真正未来的脏时间戳蒙过闸门。
     * @throws NullPointerException receivedAt 为 null。此时没有可信的退回目标，宁可当场显式失败，
     *                              也不返回 null 让一条没有时间的行进到 NOT NULL 列前才炸。
     */
    public static LocalDateTime toDbTime(Long epochSec, LocalDateTime receivedAt) {
        Objects.requireNonNull(receivedAt, "receivedAt 必须是按 CHAT_ZONE 读出的墙钟，不能为空");
        if (epochSec == null || epochSec <= 0) {
            return receivedAt;
        }
        long nowSec = receivedAt.atZone(CHAT_ZONE).toEpochSecond();
        if (epochSec > nowSec + FUTURE_SLACK_SEC) {
            return receivedAt;
        }
        return LocalDateTime.ofInstant(Instant.ofEpochSecond(epochSec), CHAT_ZONE);
    }
}
