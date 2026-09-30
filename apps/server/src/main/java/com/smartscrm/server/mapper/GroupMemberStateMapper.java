package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.GroupMemberState;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

public interface GroupMemberStateMapper extends BaseMapper<GroupMemberState> {

    @Select("SELECT * FROM group_member_state WHERE tenant_id = #{tenantId} AND platform = #{platform}"
        + " AND account_id = #{accountId} AND chat_key = #{chatKey}")
    List<GroupMemberState> selectByGroup(@Param("tenantId") Long tenantId, @Param("platform") String platform,
                                         @Param("accountId") Long accountId, @Param("chatKey") String chatKey);

    @Select("SELECT member_key FROM group_member_state WHERE tenant_id = #{tenantId} AND platform = #{platform}"
        + " AND account_id = #{accountId} AND chat_key = #{chatKey} AND is_in_group = 1")
    List<String> selectInGroupKeys(@Param("tenantId") Long tenantId, @Param("platform") String platform,
                                   @Param("accountId") Long accountId, @Param("chatKey") String chatKey);

    /**
     * 快照建档/刷新：在场的人都在群里。
     *
     * 新行只带 {@code first_seen_at}（＝现在），**不带** {@code latest_join_at}：快照给不出进群时间，
     * 拿建档时刻去填就是造一条查不出来源的假记录（spec §3）。
     * 已有行按 member_key 命中后刷新角色/展示名，{@code snapshot_seen_count} +1；
     * {@code phone} 与 {@code customer_id} 用 COALESCE——页内取不到时不把已经匹配上的抹掉。
     */
    @Insert("INSERT INTO group_member_state (tenant_id, account_id, platform, chat_key, member_key, phone,"
        + " display_name, role_type, is_in_group, join_count, first_seen_at, snapshot_seen_count, customer_id,"
        + " created_at, updated_at)"
        + " VALUES (#{e.tenantId}, #{e.accountId}, #{e.platform}, #{e.chatKey}, #{e.memberKey}, #{e.phone},"
        + " #{e.displayName}, #{e.roleType}, 1, 0, #{now}, 1, #{e.customerId}, #{now}, #{now})"
        + " ON DUPLICATE KEY UPDATE"
        + " phone = COALESCE(VALUES(phone), phone),"
        + " display_name = COALESCE(VALUES(display_name), display_name),"
        + " role_type = VALUES(role_type),"
        + " is_in_group = 1,"
        + " snapshot_seen_count = snapshot_seen_count + 1,"
        + " customer_id = COALESCE(customer_id, VALUES(customer_id)),"
        + " updated_at = VALUES(updated_at)")
    int upsertFromSnapshot(@Param("e") GroupMemberState e, @Param("now") LocalDateTime now);

    /**
     * 事件投影 · 进群（added / joined）。
     * 新行也走这一条：事件本身就说得清"他进来了"，不需要先有快照行。
     */
    @Insert("INSERT INTO group_member_state (tenant_id, account_id, platform, chat_key, member_key, phone,"
        + " display_name, role_type, is_in_group, join_count, latest_join_at, first_seen_at, last_event_at,"
        + " snapshot_seen_count, created_at, updated_at)"
        + " VALUES (#{tenantId}, #{accountId}, #{platform}, #{chatKey}, #{memberKey}, NULL, #{displayName},"
        + " 'member', 1, 1, #{at}, #{now}, #{at}, 0, #{now}, #{now})"
        + " ON DUPLICATE KEY UPDATE is_in_group = 1, join_count = join_count + 1,"
        + " latest_join_at = #{at}, last_event_at = #{at}, updated_at = #{now}")
    int applyJoin(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
                  @Param("platform") String platform, @Param("chatKey") String chatKey,
                  @Param("memberKey") String memberKey, @Param("displayName") String displayName,
                  @Param("at") LocalDateTime at, @Param("now") LocalDateTime now);

    /**
     * 事件投影 · 出群（left / removed）。
     * 这一条**会写** {@code latest_leave_at}——它是事件证据，不是推定。
     * 推定退群（快照里不见了）走 {@link #markAbsent}，那一条刻意不碰这一列。
     */
    @Insert("INSERT INTO group_member_state (tenant_id, account_id, platform, chat_key, member_key, phone,"
        + " display_name, role_type, is_in_group, join_count, latest_leave_at, exit_method, first_seen_at,"
        + " last_event_at, snapshot_seen_count, created_at, updated_at)"
        + " VALUES (#{tenantId}, #{accountId}, #{platform}, #{chatKey}, #{memberKey}, NULL, NULL,"
        + " 'member', 0, 0, #{at}, #{method}, #{now}, #{at}, 0, #{now}, #{now})"
        + " ON DUPLICATE KEY UPDATE is_in_group = 0, latest_leave_at = #{at}, exit_method = #{method},"
        + " last_event_at = #{at}, updated_at = #{now}")
    int applyLeave(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
                   @Param("platform") String platform, @Param("chatKey") String chatKey,
                   @Param("memberKey") String memberKey, @Param("method") String method,
                   @Param("at") LocalDateTime at, @Param("now") LocalDateTime now);

    /**
     * 事件投影 · 升降级。
     *
     * 用纯 UPDATE 而不是 upsert：升降级只说明角色变了，说明不了"他在不在群里"。
     * 为一个从没见过的人凭空建一行、还默认 {@code is_in_group=1}，是拿猜测当事实。
     * 0 行受影响就是"我们还没见过这个人"，保持沉默。
     */
    @Update("UPDATE group_member_state SET role_type = #{role}, last_event_at = #{at}, updated_at = #{at}"
        + " WHERE tenant_id = #{tenantId} AND platform = #{platform} AND account_id = #{accountId}"
        + " AND chat_key = #{chatKey} AND member_key = #{memberKey}")
    int applyRole(@Param("tenantId") Long tenantId, @Param("platform") String platform,
                  @Param("accountId") Long accountId, @Param("chatKey") String chatKey,
                  @Param("memberKey") String memberKey, @Param("role") String role,
                  @Param("at") LocalDateTime at);

    /**
     * 一群群的在场人数与最近变动时间，一次取回（群列表页用）。
     *
     * {@code inGroupCount} 数的是当前 `is_in_group=1` 的人，与 `chat_group.participant_count`
     * （上一次**成功快照**的人数）不是同一个数：快照失败时前者照旧、后者不动。
     * 两个数不一致正是"这次快照没记账"的信号，所以两个都要返回。
     */
    @Select({"<script>",
        "SELECT chat_key chatKey, COALESCE(SUM(is_in_group = 1), 0) inGroupCount,",
        " COUNT(*) memberCount, MAX(last_event_at) lastEventAt",
        " FROM group_member_state WHERE tenant_id = #{tenantId} AND platform = #{platform}",
        " AND account_id = #{accountId} AND chat_key IN",
        " <foreach collection='chatKeys' item='k' open='(' separator=',' close=')'>#{k}</foreach>",
        " GROUP BY chat_key",
        "</script>"})
    List<Map<String, Object>> aggregateByGroups(@Param("tenantId") Long tenantId, @Param("platform") String platform,
                                                @Param("accountId") Long accountId,
                                                @Param("chatKeys") List<String> chatKeys);

    /**
     * 推定退群：这次快照里没看到的人。
     *
     * **绝不写 {@code latest_leave_at}**（spec §2#3 / §6）——快照只能证明"这一刻不在名单里"，
     * 证明不了"他什么时候走的"。写了就会在界面上出现一个看似精确的退群时间，
     * 而那其实是我们上一次成功快照之后的任意时刻。{@code exit_method} 记成 {@code snapshot_absent}
     * 就是为了让人看得出这是推定。
     */
    @Update("UPDATE group_member_state SET is_in_group = 0, exit_method = 'snapshot_absent', updated_at = #{now}"
        + " WHERE id = #{id}")
    int markAbsent(@Param("id") Long id, @Param("now") LocalDateTime now);
}
