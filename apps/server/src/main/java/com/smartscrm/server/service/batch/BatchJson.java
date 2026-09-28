package com.smartscrm.server.service.batch;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;

/**
 * `batch_send_task` 那两个 TEXT 列（account_ids / contents）的编解码。
 * 用 ObjectMapper 而不是拼字符串：contents 是用户写的正文，里面什么字符都可能有的
 * （引号、反斜杠、换行），转义规则不是本项目该重新发明一遍的东西。
 * `new ObjectMapper()` 这份形制与 service/provider 下的两处一致，不注册 Spring 的 mapper bean。
 * <p>
 * 读侧出错一律抛 IllegalStateException 而不是回空表：这两列是任务定义本身，
 * 解不出来就是数据坏了，静默回空表会让引擎"跑一个没有内容的任务"。
 */
public final class BatchJson {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private BatchJson() {
    }

    public static String encodeLongs(List<Long> values) {
        try {
            return MAPPER.writeValueAsString(values == null ? List.of() : values);
        } catch (Exception e) {
            throw new IllegalStateException("account_ids 编码失败", e);
        }
    }

    public static String encodeStrings(List<String> values) {
        try {
            return MAPPER.writeValueAsString(values == null ? List.of() : values);
        } catch (Exception e) {
            throw new IllegalStateException("contents 编码失败", e);
        }
    }

    public static List<Long> readLongs(String json, String where) {
        return read(json, new TypeReference<List<Long>>() { }, where);
    }

    public static List<String> readStrings(String json, String where) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        return read(json, new TypeReference<List<String>>() { }, where);
    }

    /**
     * {@code where} 是「哪个任务的哪一列」这种调用方才知道的标签，异常文案只带它。
     * 这两列里存的是别人的正文，而 {@code GlobalExceptionHandler} 会把 {@code getMessage()} 原样
     * 回进响应体（R36）——把 payload 拼进文案就等于把一行正文交给一个只需要知道「哪一列坏了」的人。
     */
    private static <T> T read(String json, TypeReference<T> type, String where) {
        if (json == null || json.isBlank()) {
            try {
                return MAPPER.readValue("[]", type);
            } catch (Exception e) {
                throw new IllegalStateException(where + " 空白成形失败", e);
            }
        }
        try {
            return MAPPER.readValue(json, type);
        } catch (Exception e) {
            throw new IllegalStateException(where + " 解不出来", e);
        }
    }
}
