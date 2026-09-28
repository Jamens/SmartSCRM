package com.smartscrm.server.web.vo;

import java.util.List;

/** 创建结果：任务 id + 被拒清单（全通过时为空数组）+ 展开后的明细总数。 */
public record BatchCreateVO(long taskId, List<BatchRejectedVO> rejected, int totalCount) {
}
