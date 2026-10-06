package com.smartscrm.server.web.vo;

/** B11 仪表盘下钻——单个账号在窗口内的收发量（按 total 降序）。 */
public record AccountStatVO(
    Long accountId, String accountName, String platform, Boolean online,
    long messageIn, long messageOut, long activeConversations) {
    public long messageTotal() {
        return messageIn + messageOut;
    }
}
