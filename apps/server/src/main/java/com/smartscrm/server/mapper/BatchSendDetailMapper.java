package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.BatchSendDetail;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface BatchSendDetailMapper extends BaseMapper<BatchSendDetail> {

    @Insert({
        "<script>",
        "INSERT INTO batch_send_detail (tenant_id, task_id, seq, account_id, chat_key, customer_id,",
        " content_index, body, send_status, recall_status) VALUES",
        "<foreach collection='rows' item='r' separator=','>",
        "(#{r.tenantId}, #{r.taskId}, #{r.seq}, #{r.accountId}, #{r.chatKey}, #{r.customerId},",
        " #{r.contentIndex}, #{r.body}, 'pending', 'none')",
        "</foreach>",
        "</script>"
    })
    int insertBatch(@Param("rows") List<BatchSendDetail> rows);

    /** localId/msgKey/sentAt 用 COALESCE 保留旧值（同一行可能被重报），错误列无条件覆盖。 */
    @Update("UPDATE batch_send_detail SET send_status = #{sendStatus}, "
            + " local_id = COALESCE(#{localId}, local_id), error_code = #{errorCode}, "
            + " error_detail = #{errorDetail}, msg_key = COALESCE(#{msgKey}, msg_key), "
            + " sent_at = COALESCE(#{sentAt}, sent_at) "
            + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} AND id = #{detailId}")
    int applyReport(@Param("tenantId") long tenantId, @Param("taskId") long taskId,
                    @Param("detailId") long detailId, @Param("sendStatus") String sendStatus,
                    @Param("localId") String localId, @Param("errorCode") String errorCode,
                    @Param("errorDetail") String errorDetail, @Param("msgKey") String msgKey,
                    @Param("sentAt") LocalDateTime sentAt);

    @Update("UPDATE batch_send_detail SET send_status = 'skipped', error_code = 'TASK_HALT' "
            + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} AND send_status = 'pending'")
    int skipAllPending(@Param("tenantId") long tenantId, @Param("taskId") long taskId);

    /**
     * R3：WHERE 里只有 'failed'，绝不含 unknown / skipped。
     * `ids == null` 或空 = 整批复位（spec §5 的 `retry-failed` 原语义）；带 ids = 只复位勾选的那几条
     * （spec §7 的单条重发）。两条语义共用一条原语，是因为 SET 子句一个字都不能差：少清一列
     * `local_id`，重跑那一行就会拿旧 localId 去认领新回执（`sendRegistry` 的 FIFO 会认错）。
     */
    @Update("<script>UPDATE batch_send_detail SET send_status = 'pending', error_code = NULL, "
            + " error_detail = NULL, local_id = NULL "
            + " WHERE tenant_id = #{tenantId} AND task_id = #{taskId} AND send_status = 'failed' "
            + " <if test='ids != null and ids.size() > 0'> AND id IN "
            + "   <foreach collection='ids' item='d' open='(' separator=',' close=')'>#{d}</foreach>"
            + " </if>"
            + "</script>")
    int retryFailed(@Param("tenantId") long tenantId, @Param("taskId") long taskId, @Param("ids") List<Long> ids);

    @Update({
        "<script>",
        "UPDATE batch_send_detail SET recall_status = 'recalling', recall_detail = NULL "
            + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} "
            + "AND recall_status IN ('none','recall_failed') "
            + "AND id IN",
        "<foreach collection='ids' item='i' open='(' separator=',' close=')'>#{i}</foreach>",
        "</script>"
    })
    int markRecalling(@Param("tenantId") long tenantId, @Param("taskId") long taskId,
                      @Param("ids") List<Long> ids);

    /**
     * 只结 recalling 的行：迟到的撤回回执不得改写已经判过 recall_failed 的结论。
     */
    @Update("UPDATE batch_send_detail SET recall_status = #{recallStatus}, recall_detail = #{detail} "
            + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} AND id = #{detailId} "
            + "AND recall_status = 'recalling'")
    int applyRecallReport(@Param("tenantId") long tenantId, @Param("taskId") long taskId,
                          @Param("detailId") long detailId, @Param("recallStatus") String recallStatus,
                          @Param("detail") String detail);

    /**
     * I-2 第三拍：把孤儿 `recalling` 结回 `recall_failed`。
     * 生产者是主进程 `host.ts` 的 `batch:recall`：一条 `recallText` 从 `sendLock.run` 抛出会中断整批循环，
     * 而 `applyRecallReport` 只结 `recalling` 的行——中断之后没有生产者再报，那些行就永远显示「撤回中」。
     * `reconcile` 只在应用启动时跑一次，此刻不可能有合法的在途撤回（宿主已经死了或刚起来），
     * 所以整张租户下所有 `recalling` 都算孤儿。守卫只读 `recall_status`（不 JOIN 任务表：撤回行不属于
     * running 任务也要结）。它同时是 I-6 的回程入口：`markRecalling` 现在认 `recall_failed` 再进，
     * 少了这一拍孤儿就永远停在 `recalling`。
     */
    @Update("UPDATE batch_send_detail SET recall_status = 'recall_failed', recall_detail = #{detail} "
            + "WHERE tenant_id = #{tenantId} AND recall_status = 'recalling'")
    int markOrphanRecallingFailed(@Param("tenantId") long tenantId, @Param("detail") String detail);

    /** 每状态一行，供 Task 5 的 reports 结算与 Task 4 的自检。 */
    @Select("SELECT send_status AS sendStatus, COUNT(1) AS c FROM batch_send_detail "
            + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} GROUP BY send_status")
    List<Map<String, Object>> countByTask(@Param("tenantId") long tenantId, @Param("taskId") long taskId);
}
