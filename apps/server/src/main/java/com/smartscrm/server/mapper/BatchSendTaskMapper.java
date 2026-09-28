package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.BatchSendTask;
import java.time.LocalDateTime;
import java.util.Map;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface BatchSendTaskMapper extends BaseMapper<BatchSendTask> {

    /** 只给在跑的任务续心跳：paused/cancelled 之后心跳必须停止，否则 reconcile 永远判它「活着」。 */
    @Update("UPDATE batch_send_task SET heartbeat_at = NOW(3) "
            + "WHERE tenant_id = #{tenantId} AND id = #{id} AND status = 'running'")
    int heartbeat(@Param("tenantId") long tenantId, @Param("id") long id);

    /** CAS 式迁移：返回 0 就是「当前态不是 fromStatus」，调用方据此出 40902 并点名现状。 */
    @Update("UPDATE batch_send_task SET status = #{toStatus} "
            + "WHERE tenant_id = #{tenantId} AND id = #{id} AND status = #{fromStatus}")
    int moveTo(@Param("tenantId") long tenantId, @Param("id") long id,
               @Param("fromStatus") String fromStatus, @Param("toStatus") String toStatus);

    /** fail 只算 'failed'：unknown 不发不撤（R2），skipped 是没跑（R2）。 */
    @Select("SELECT SUM(send_status = 'success') AS sentCount, SUM(send_status = 'failed') AS failCount "
            + "FROM batch_send_detail WHERE tenant_id = #{tenantId} AND task_id = #{id}")
    Map<String, Object> recount(@Param("tenantId") long tenantId, @Param("id") long id);

    /** 「还没结论」= pending + sending。全部账号熔断的判定与 done 的判定都读它。 */
    @Select("SELECT COUNT(1) FROM batch_send_detail WHERE tenant_id = #{tenantId} AND task_id = #{id} "
            + "AND send_status IN ('pending','sending')")
    int openCount(@Param("tenantId") long tenantId, @Param("id") long id);

    /** R4 第一拍：先判 unknown，顺序不可与 pauseStaleTasks 互换。 */
    @Update("UPDATE batch_send_detail d JOIN batch_send_task t ON t.id = d.task_id "
            + "SET d.send_status = 'unknown', d.error_code = 'ENGINE_LOST', "
            + "    d.error_detail = 'engine heartbeat stale at shutdown' "
            + "WHERE d.tenant_id = #{tenantId} AND t.tenant_id = #{tenantId} AND t.status = 'running' "
            + "AND (t.heartbeat_at IS NULL OR t.heartbeat_at < #{staleBefore}) AND d.send_status = 'sending'")
    int markStaleSendingUnknown(@Param("tenantId") long tenantId, @Param("staleBefore") LocalDateTime staleBefore);

    /** R4 第二拍。 */
    @Update("UPDATE batch_send_task SET status = 'paused' "
            + "WHERE tenant_id = #{tenantId} AND status = 'running' "
            + "AND (heartbeat_at IS NULL OR heartbeat_at < #{staleBefore})")
    int pauseStaleTasks(@Param("tenantId") long tenantId, @Param("staleBefore") LocalDateTime staleBefore);
}
