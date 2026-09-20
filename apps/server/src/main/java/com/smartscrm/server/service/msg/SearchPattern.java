package com.smartscrm.server.service.msg;

/** 搜索词 → LIKE 模式。全表 LIKE 是本阶段刻意选择的简单方案（本地量级够用）。 */
public final class SearchPattern {

    private SearchPattern() {
    }

    public static String like(String q) {
        if (q == null) {
            return null;
        }
        String trimmed = q.trim();
        if (trimmed.isEmpty() || trimmed.replace("%", "").replace("_", "").isEmpty()) {
            return null;
        }
        String escaped = trimmed.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + escaped + "%";
    }
}
