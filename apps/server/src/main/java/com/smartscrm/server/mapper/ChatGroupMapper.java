package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.ChatGroup;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

public interface ChatGroupMapper extends BaseMapper<ChatGroup> {

    @Select("SELECT * FROM chat_group WHERE tenant_id = #{tenantId} AND platform = #{platform}"
        + " AND account_id = #{accountId} AND chat_key = #{chatKey} LIMIT 1")
    ChatGroup selectByKey(@Param("tenantId") Long tenantId, @Param("platform") String platform,
                          @Param("accountId") Long accountId, @Param("chatKey") String chatKey);

    /**
     * 群登记 upsert：来了就更新标题，不来就建档。
     *
     * 刻意**不动** {@code participant_count} / {@code last_snapshot_at} / {@code snapshot_count}：
     * 那三列是"快照成功"的记账，只有 {@link #markSnapshotSuccess} 能写。混在一起写，
     * 一次失败的拉取就会污染覆盖率闸的分母。
     * {@code title} 用 COALESCE：页内取不到群名时不该把已经有的名字抹成 NULL。
     */
    @Insert("INSERT INTO chat_group (tenant_id, account_id, platform, chat_key, title, created_at, updated_at)"
        + " VALUES (#{e.tenantId}, #{e.accountId}, #{e.platform}, #{e.chatKey}, #{e.title},"
        + " #{now}, #{now})"
        + " ON DUPLICATE KEY UPDATE title = COALESCE(VALUES(title), title), updated_at = VALUES(updated_at)")
    int upsertGroup(@Param("e") ChatGroup e, @Param("now") LocalDateTime now);

    /**
     * 一次**成功**快照的记账：写分母、打时间戳、快照次数 +1。
     * 只有调用方确认这份快照可用（非空名单）时才调用——空名单当成功会把整群人判成已退群。
     */
    @Update("UPDATE chat_group SET participant_count = #{count}, last_snapshot_at = #{at},"
        + " snapshot_count = snapshot_count + 1, updated_at = #{at} WHERE id = #{id}")
    int markSnapshotSuccess(@Param("id") Long id, @Param("count") int count, @Param("at") LocalDateTime at);
}
