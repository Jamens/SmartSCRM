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

    public static List<Long> readLongs(String json) {
        return read(json, new TypeReference<List<Long>>() { });
    }

    public static List<String> readStrings(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        return read(json, new TypeReference<List<String>>() { });
    }

    private static <T> T read(String json, TypeReference<T> type) {
        if (json == null || json.isBlank()) {
            try {
                return MAPPER.readValue("[]", type);
            } catch (Exception e) {
                throw new IllegalStateException("JSON 列空白成形失败", e);
            }
        }
        try {
            return MAPPER.readValue(json, type);
        } catch (Exception e) {
            throw new IllegalStateException("JSON 列解不出来: " + json, e);
        }
    }
}
