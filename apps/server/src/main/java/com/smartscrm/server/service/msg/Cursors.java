package com.smartscrm.server.service.msg;

import java.time.Instant;
import java.time.LocalDateTime;

/**
 * 键集游标：`"<epochMillis>:<rowId>"`。不用 offset，因为采集是持续写入的——
 * 翻页过程中新行会把旧页往后推，offset 必然重复或漏行。
 * 毫秒 + id 一起带，是因为 DATETIME(3) 允许同一毫秒内有两条消息。
 */
public final class Cursors {

    public record Pos(LocalDateTime time, long id) {
    }

    private Cursors() {
    }

    public static String encode(LocalDateTime time, long id) {
        return time.atZone(MsgTimes.CHAT_ZONE).toInstant().toEpochMilli() + ":" + id;
    }

    public static Pos decode(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        int sep = raw.lastIndexOf(':');
        if (sep <= 0 || sep == raw.length() - 1) {
            return null;
        }
        try {
            long millis = Long.parseLong(raw.substring(0, sep));
            long id = Long.parseLong(raw.substring(sep + 1));
            return new Pos(LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), MsgTimes.CHAT_ZONE), id);
        } catch (NumberFormatException notACursor) {
            return null;
        }
    }
}
