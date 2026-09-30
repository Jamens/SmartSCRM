package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/**
 * 群进退流水（V12 / spec §3）。
 *
 * 刻意**不设外键到 {@code chat_message}**：事件行比消息行长寿，清理聊天记录不该把进退史一起删掉。
 *
 * {@code occurredAt} 对在线事件是"观测时刻"而非真实发生时刻——{@code participant_changed}
 * 不带时间（spec §15#5）。离线重放或多设备下的偏差量级待实测，实测后可能要在界面标注，
 * 但那不动去重键。
 */
@Data
@TableName("group_member_event")
public class GroupMemberEvent {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long accountId;
    private String platform;
    private String chatKey;
    /** 冗余一份发生时的群名：群后来改名不该改写历史流水。 */
    private String groupTitle;
    /** 目标人。 */
    private String memberKey;
    private String actorKey;
    private String actorName;
    /** added | joined | left | removed | promoted | demoted。 */
    private String eventType;
    private LocalDateTime occurredAt;
    /** system_message | live_event。 */
    private String source;
    /** 系统消息取 msgKey；在线事件取 actor|epochSec|action 合成。 */
    private String dedupKey;
    private String rawType;
    private String rawSubtype;
    private String bodySnapshot;
    private LocalDateTime createdAt;
}
