package com.smartscrm.server.web.vo;

/** 一条被拒的收件人：点名是谁、在哪个账号下、为什么（计划 R8）。 */
public record BatchRejectedVO(String chatKey, Long accountId, String reason) {
}
