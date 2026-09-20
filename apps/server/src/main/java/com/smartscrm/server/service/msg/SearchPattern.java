package com.smartscrm.server.service.msg;

/** 搜索词 → LIKE 模式。全表 LIKE 是本阶段刻意选择的简单方案（本地量级够用）。 */
public final class SearchPattern {

    private SearchPattern() {
    }

    /**
     * 搜索词 → 可直接绑进 LIKE 的模式。
     * <p>
     * 返回 null 的契约："这个词不该发起搜索"。调用方必须按"不搜索"处理，
     * 不能按"全表"处理——把 null 当成"没有过滤条件"就是一次无约束的全表扫。
     * <p>
     * 空白判定用 strip() 而不是 trim()：trim() 只去 U+0020 及以下的控制位，
     * 全角空格（U+3000）会从空白判定里漏过去，变成一次带隐形空格的 %…% 全表 LIKE。
     * 已知限制：不换行空格（U+00A0）一类 Character.isWhitespace 为假的空白 strip() 也救不了，
     * 它们会被当成正常搜索词——本阶段接受，不为此造机械。
     * <p>
     * 转义前提是"MySQL 默认 LIKE 转义符就是反斜杠"：反斜杠先自身翻倍，再转义 % 与 _。
     * 所以 SQL 侧不要再写 ESCAPE 子句、也不做二次转义；一旦环境把 sql_mode 加上
     * NO_BACKSLASH_ESCAPES，本方法的产物整体失效。
     */
    public static String like(String q) {
        if (q == null) {
            return null;
        }
        String stripped = q.strip();
        if (stripped.isEmpty() || stripped.replace("%", "").replace("_", "").isEmpty()) {
            return null;
        }
        String escaped = stripped.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + escaped + "%";
    }
}
