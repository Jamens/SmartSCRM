package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.GroupMemberEvent;
import java.util.List;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface GroupMemberEventMapper extends BaseMapper<GroupMemberEvent> {

    /**
     * 采集链的唯一写入口（单条）。{@code uk_event} 命中即忽略：在线事件重放、系统消息补底、
     * 两条来源同时报道同一件事，全都靠这一条消解。返回值 = 这一行**真正插入**没有（1 插了 / 0 被 IGNORE）。
     *
     * 为什么单条而不是批量：批量 {@code INSERT IGNORE} 只给得出"插了几行"，说不出"哪几行是新的"，
     * 而 {@code join_count} 的投影必须**按行**决定——对重复事件无条件投影会双计且永远回不去（spec §6 / R39）。
     * 攒批的量级（每批 ≤100 条、每 2s 一趟）在这一百次本地往返上不构成瓶颈，所以宁可按行拿准确性。
     */
    @Insert("INSERT IGNORE INTO group_member_event"
        + " (tenant_id, account_id, platform, chat_key, group_title, member_key, actor_key, actor_name,"
        + " event_type, occurred_at, source, dedup_key, raw_type, raw_subtype, body_snapshot)"
        + " VALUES (#{e.tenantId}, #{e.accountId}, #{e.platform}, #{e.chatKey}, #{e.groupTitle}, #{e.memberKey},"
        + " #{e.actorKey}, #{e.actorName}, #{e.eventType}, #{e.occurredAt}, #{e.source}, #{e.dedupKey},"
        + " #{e.rawType}, #{e.rawSubtype}, #{e.bodySnapshot})")
    int insertIgnore(@Param("e") GroupMemberEvent e);

    /**
     * 这个群里已经存在哪些去重键。
     *
     * 投影前先问一次，是为了**只对新事件做投影**：{@code INSERT IGNORE} 只能告诉调用方"插了几行"，
     * 说不出"哪几行是新的"，而 {@code join_count} 一旦对重复事件累加就永远回不去（spec §6）。
     */
    @Select("SELECT dedup_key, event_type, member_key FROM group_member_event"
        + " WHERE tenant_id = #{tenantId} AND platform = #{platform} AND account_id = #{accountId}"
        + " AND chat_key = #{chatKey}")
    List<GroupMemberEvent> selectDedupKeys(@Param("tenantId") Long tenantId, @Param("platform") String platform,
                                           @Param("accountId") Long accountId, @Param("chatKey") String chatKey);
}
