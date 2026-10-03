package com.smartscrm.server.web.vo;

import com.smartscrm.server.common.PageResult;

/**
 * `GET /group/members` 的一整份响应：名单与快照新鲜度**同一份**返回。
 *
 * 用 record 而不是 {@code Map.of}——后者不允许 null 值，会把首次建档的 {@code coverage == null}
 * 压成空串，前端就拿不到"这是首次建档，没有分母可除"的信号（spec §8）。
 * 这里的 {@code coverage} 直接读 {@code chat_group} 落库的那一列（V13），不在读侧现场算。
 */
public record MemberPageVO(
    PageResult<GroupMemberVO> members,
    Double coverage,
    String reason
) {
}
