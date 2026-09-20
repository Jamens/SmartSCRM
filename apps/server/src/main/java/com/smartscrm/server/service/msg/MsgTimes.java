package com.smartscrm.server.service.msg;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * 页内上报的是 unix 秒。库里的 DATETIME(3) 与 JDBC 会话时区成对，
 * 所以这里固定的 Asia/Shanghai 必须与 application.yml 里 jdbc url 的 serverTimezone 一致。
 */
public final class MsgTimes {

    public static final ZoneId CHAT_ZONE = ZoneId.of("Asia/Shanghai");
    /** 允许的最大未来偏移：手机与电脑时钟总有偏差，超过这个就当不可信。 */
    private static final long FUTURE_SLACK_SEC = 300;

    private MsgTimes() {
    }

    public static LocalDateTime toDbTime(Long epochSec, LocalDateTime receivedAt) {
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
