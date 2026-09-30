package com.smartscrm.server.web.vo;

import java.time.LocalDateTime;

/**
 * 进退流水行（spec §7 `GET /group/events`）。
 *
 * {@code occurredAt} 对 {@code live_event} 是**观测时刻**而非真实发生时刻
 * （`participant_changed` 不带时间，spec §15#5）；实测出偏差量级后可能要在界面标注，
 * 但那不改变这一行的含义。
 */
public record GroupEventVO(
    Long id,
    String chatKey,
    String groupTitle,
    String memberKey,
    String actorKey,
    String actorName,
    String eventType,
    LocalDateTime occurredAt,
    String source,
    String rawType,
    String rawSubtype,
    String bodySnapshot
) {
}
