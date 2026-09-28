package com.smartscrm.server.web.vo;

import java.time.LocalDateTime;

/** 明细视图：16 个字段与 `BatchSendService.toVO(BatchSendDetail)` 的实参顺序逐个一致。 */
public record BatchDetailVO(
    Long id, Long taskId, Integer seq, Long accountId, String chatKey, Long customerId,
    Integer contentIndex, String body, String localId, String sendStatus,
    String errorCode, String errorDetail, String msgKey, String recallStatus, String recallDetail,
    LocalDateTime sentAt
) {
}
