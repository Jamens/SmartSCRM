package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.GroupMemberEvent;
import java.util.List;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface GroupMemberEventMapper extends BaseMapper<GroupMemberEvent> {

    /**
     * 采集链的唯一写入口。{@code uk_event} 命中即忽略：在线事件重放、系统消息补底、
     * 两条来源同时报道同一件事，全都靠这一条消解。返回值 = 真正插入的行数。
     */
    @Insert({"<script>",
        "INSERT IGNORE INTO group_member_event",
        "(tenant_id, account_id, platform, chat_key, group_title, member_key, actor_key, actor_name,",
        " event_type, occurred_at, source, dedup_key, raw_type, raw_subtype, body_snapshot) VALUES",
        "<foreach collection='list' item='e' separator=','>",
        "(#{e.tenantId}, #{e.accountId}, #{e.platform}, #{e.chatKey}, #{e.groupTitle}, #{e.memberKey},",
        " #{e.actorKey}, #{e.actorName}, #{e.eventType}, #{e.occurredAt}, #{e.source}, #{e.dedupKey},",
        " #{e.rawType}, #{e.rawSubtype}, #{e.bodySnapshot})",
        "</foreach>",
        "</script>"})
    int insertIgnoreBatch(@Param("list") List<GroupMemberEvent> list);

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
