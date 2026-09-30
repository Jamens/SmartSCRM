package com.smartscrm.server.web.vo;

import java.time.LocalDateTime;

/**
 * 导出的一行，14 列，列序与 shared/groupMembers.ts 的 {@code EXPORT_COLUMNS} 逐个对齐（spec §10）。
 *
 * 刻意**没有"地区"列**：库里没有这个数据来源，硬填只会造出一列空值（spec §2#5）。
 * {@code seq} 是整份文件内的连续序号，跨群不重置。
 */
public record GroupExportRowVO(
    Integer seq,
    String groupName,
    String groupId,
    String phone,
    String name,
    String role,
    String inGroup,
    LocalDateTime joinAt,
    Integer joinCount,
    LocalDateTime leaveAt,
    String exitMethod,
    LocalDateTime lastMsgAt,
    Long dayMsgCount,
    Long msgCount
) {
}
