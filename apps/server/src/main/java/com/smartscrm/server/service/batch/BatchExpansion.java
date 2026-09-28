package com.smartscrm.server.service.batch;

import java.util.ArrayList;
import java.util.List;

/**
 * 收件人主序展开：同一收件人的多条内容连续排完再换人。
 * 这样 msg_interval 只管"同人相邻两条"、chat_interval 只管"换人那一跳"，两个间隔各管一段，
 * 不需要在执行环里再判一次"上一条是不是同一个人"。
 */
public final class BatchExpansion {

    private BatchExpansion() {
    }

    public record Recipient(long accountId, String chatKey, Long customerId) {
    }

    public record ExpandedRow(int seq, long accountId, String chatKey, Long customerId,
                              int contentIndex, String body) {
    }

    @FunctionalInterface
    public interface FieldSource {
        BatchRender.Fields fields(Recipient recipient);
    }

    /** 预览与单测用的空字段源：变量一律走兜底。 */
    public static final FieldSource NO_FIELDS = r -> BatchRender.EMPTY_FIELDS;

    public static List<ExpandedRow> expand(List<Recipient> recipients, List<String> contents,
                                           FieldSource source) {
        List<ExpandedRow> rows = new ArrayList<>();
        if (recipients == null || contents == null) {
            return rows;
        }
        FieldSource src = source == null ? NO_FIELDS : source;
        int seq = 1;
        for (Recipient r : recipients) {
            BatchRender.Fields fields = src.fields(r);
            for (int ci = 0; ci < contents.size(); ci++) {
                rows.add(new ExpandedRow(seq++, r.accountId(), r.chatKey(), r.customerId(),
                        ci, BatchRender.render(contents.get(ci), fields)));
            }
        }
        return rows;
    }
}
