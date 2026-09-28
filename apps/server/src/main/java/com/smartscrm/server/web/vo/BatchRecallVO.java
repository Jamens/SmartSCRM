package com.smartscrm.server.web.vo;

import java.util.List;

/**
 * 撤回资格裁决：eligible 交给执行环去撤，rejected 点名每一条为什么不能撤。
 * 每一条被点名的 detailId 都会落进这两个列表之一，绝不静默少一条。
 */
public record BatchRecallVO(List<Target> eligible, List<Blocked> rejected) {

    /** 可以撤的一条：带齐执行环定位消息所需的 accountId / chatKey / msgKey。 */
    public record Target(long detailId, long accountId, String chatKey, String msgKey) {
    }

    /** 被挡下的一条：reason 是人能看懂的一句话（spec §2 的三条判据 + recall_status 已占用的第四条）。 */
    public record Blocked(long detailId, String reason) {
    }
}
