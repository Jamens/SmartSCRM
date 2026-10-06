package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ScriptPlaybook;
import com.smartscrm.server.entity.ScriptPlaybookStep;
import com.smartscrm.server.entity.ScriptTask;
import com.smartscrm.server.entity.ScriptTaskStep;
import com.smartscrm.server.mapper.ScriptPlaybookMapper;
import com.smartscrm.server.mapper.ScriptPlaybookStepMapper;
import com.smartscrm.server.mapper.ScriptTaskMapper;
import com.smartscrm.server.mapper.ScriptTaskStepMapper;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B8 炒群引擎 · loop 调度器（**跑在 Java 侧**——与 B7 群发的泵在 Electron 主进程不同，
 * 见 spec §4/§8：两条链运行位置不同，不能各建一个泵抢同一批任务）。
 *
 * <p>本类只管**编排与状态推进**：把到期的 task 推进一格 step 并置 {@code sending}（派发记录），
 * 等桌面端回报 step 结果再推进。真去 WhatsApp 动手由 B18/B19 + 执行器接（本期不做）。
 *
 * <p>核心口径：断点 = {@code task.current_step} + 每步一行 {@code script_task_step}；
 * 恢复只补 pending 步，success 不重跑（重跑=发重复消息）；failover 切号**不重置断点**。
 */
@Service
public class ScriptSchedulerService {

    private static final Logger log = LoggerFactory.getLogger(ScriptSchedulerService.class);
    /** step 状态词表（与 shared/scriptActions.ts 一致）。 */
    private static final String PENDING = "pending", SENDING = "sending", SUCCESS = "success",
        FAILED = "failed", SKIPPED = "skipped";
    /** 任务状态词表（与 batch-send 一致）。 */
    private static final String T_RUNNING = "running", T_ERROR = "error";
    /** 连续失败多少次切号。 */
    private static final int FAILOVER_THRESHOLD = 3;
    /** 心跳超多少秒判 error（不卡 running）。 */
    private static final long STALE_HEARTBEAT_SEC = 300;

    private final ScriptTaskMapper taskMapper;
    private final ScriptTaskStepMapper taskStepMapper;
    private final ScriptPlaybookMapper playbookMapper;
    private final ScriptPlaybookStepMapper playbookStepMapper;
    private final GroupJoinService groupJoinService;
    private final GroupKickService groupKickService;

    public ScriptSchedulerService(ScriptTaskMapper taskMapper, ScriptTaskStepMapper taskStepMapper,
                                  ScriptPlaybookMapper playbookMapper, ScriptPlaybookStepMapper playbookStepMapper) {
        this(taskMapper, taskStepMapper, playbookMapper, playbookStepMapper, null, null);
    }

    /**
     * 生产构造：带 B18/B19 服务，用于委托类动作。
     *
     * <p>刻意标 {@code @Autowired}：本类有**两个**构造器时 Spring 无法自己选（会找无参/报
     * "No default constructor found"）。这不是单测能覆盖的——单测用 new 直调，只有真起
     * 容器才暴露 bean 图错误。
     */
    @org.springframework.beans.factory.annotation.Autowired
    public ScriptSchedulerService(ScriptTaskMapper taskMapper, ScriptTaskStepMapper taskStepMapper,
                                  ScriptPlaybookMapper playbookMapper, ScriptPlaybookStepMapper playbookStepMapper,
                                  GroupJoinService groupJoinService, GroupKickService groupKickService) {
        this.taskMapper = taskMapper;
        this.taskStepMapper = taskStepMapper;
        this.playbookMapper = playbookMapper;
        this.playbookStepMapper = playbookStepMapper;
        this.groupJoinService = groupJoinService;
        this.groupKickService = groupKickService;
    }

    /** 扫描到期 task（next_run_at <= now 且 running/pending），逐个推进一格。到期口径含 heartbeat 回收。 */
    @Transactional
    public int scheduleDue(LocalDateTime now) {
        List<ScriptTask> due = taskMapper.selectList(new LambdaQueryWrapper<ScriptTask>()
            .in(ScriptTask::getStatus, T_RUNNING, PENDING)
            .le(ScriptTask::getNextRunAt, now));
        int n = 0;
        for (ScriptTask t : due) {
            if (advance(t.getId(), now)) n++;
        }
        return n;
    }

    /**
     * 推进一个 task 一格：找到下一个该跑的 step（断点推进），置 sending 并把断点移过去；
     * 一轮跑完（本轮无 pending）→ 重置断点、排下一轮 loop。返回是否真的派发了一格。
     */
    @Transactional
    public boolean advance(Long taskId, LocalDateTime now) {
        ScriptTask task = taskMapper.selectById(taskId);
        if (task == null || !(T_RUNNING.equals(task.getStatus()) || PENDING.equals(task.getStatus()))) {
            return false;
        }
        List<ScriptPlaybookStep> defs = playbookSteps(task.getPlaybookId());
        List<ScriptTaskStep> rows = taskSteps(taskId);
        Integer next = nextStep(rows);
        if (next == null) {
            // 本轮跑完 → loop：断点归零、排下一轮。failed 步不单独重试（下一轮整体重来）。
            resetForNextRound(task, rows, now);
            return false;
        }
        // 补齐该 seq 的执行记录（首次跑到的 seq 没有行），置 sending
        ScriptTaskStep row = rows.stream().filter(r -> next.equals(r.getSeq())).findFirst().orElse(null);
        if (row == null) {
            ScriptPlaybookStep def = defs.stream().filter(d -> next.equals(d.getSeq())).findFirst().orElse(null);
            row = new ScriptTaskStep();
            row.setTenantId(task.getTenantId());
            row.setTaskId(taskId);
            row.setSeq(next);
            row.setActionType(def == null ? "post_message" : def.getActionType());
            row.setStatus(PENDING);
            taskStepMapper.insert(row);
        }
        // 委托类动作（join_group/kick_member）：转 B18/B19 任务，**不当场执行**（spec §6）。
        // 「委托即完成」：委托成功即 success + 记 ref；缺参数/缺依赖判 failed（不无限重试）。
        if ("join_group".equals(row.getActionType()) || "kick_member".equals(row.getActionType())) {
            ScriptPlaybookStep pdef = defs.stream().filter(d -> next.equals(d.getSeq())).findFirst().orElse(null);
            boolean ok = delegate(task, row, pdef == null ? null : pdef.getParams());
            row.setStatus(ok ? SUCCESS : FAILED);
            if (!ok) row.setErrorDetail("委托失败：缺参数或服务不可用");
            taskStepMapper.updateById(row);
            task.setCurrentStep(next);
            task.setStatus(T_RUNNING);
            task.setNextRunAt(nextRunAt(task, now));
            taskMapper.updateById(task);
            log.info("[script] task={} 委托 step={} action={} ok={} ref={}/{}",
                taskId, next, row.getActionType(), ok, row.getRefType(), row.getRefId());
            return true;
        }
        row.setStatus(SENDING);
        taskStepMapper.updateById(row);
        // 断点移到该步；task 置 running、排下一轮唤醒时间
        task.setCurrentStep(next);
        task.setStatus(T_RUNNING);
        task.setNextRunAt(nextRunAt(task, now));
        taskMapper.updateById(task);
        // 真正的"派发"（回报桌面端执行）留到 B18/B19 + 执行器；本期到置 sending 为止。
        log.info("[script] task={} 推进到 step={} action={}", taskId, next, row.getActionType());
        return true;
    }

    /**
     * 委托类动作（join_group/kick_member）**不当场执行**——它们转成 B18/B19 任务交出去
     * （那两个动作不可逆、都带人工门，见 B18/B19 spec §5；剧本直接调 wa-js 等于绕过那道门）。
     * 口径「委托即完成」：委托任务建好即 success，并在 step 上留 ref 供回查。
     *
     * <p>params 约定（缺省用剧本目标群）：
     * <ul>
     *   <li>join_group：{@code {"inviteCode":"..."}}；缺省取 task.target_chat_key</li>
     *   <li>kick_member：{@code {"participantIds":["a@c.us"]}}（必填，没有名单就没法踢）</li>
     * </ul>
     * @return 是否成功委托（false=缺依赖/参数或服务未注入，调用方据此把 step 判 failed）
     */
    @Transactional
    public boolean delegate(ScriptTask task, ScriptTaskStep row, String paramsJson) {
        String at = row.getActionType();
        if ("join_group".equals(at)) {
            if (groupJoinService == null) return false;
            String code = jsonString(paramsJson, "inviteCode");
            if (code == null || code.isBlank()) code = task.getTargetChatKey();
            if (code == null || code.isBlank()) return false;
            var t = groupJoinService.create(task.getTenantId(), task.getAccountId(),
                "剧本委托-" + task.getId() + "-" + row.getSeq(), code, null, null, null);
            row.setRefType("join");
            row.setRefId(t.getId());
            return true;
        }
        if ("kick_member".equals(at)) {
            if (groupKickService == null) return false;
            var ids = jsonList(paramsJson, "participantIds");
            if (ids.isEmpty()) return false; // 没有名单就没法踢
            var t = groupKickService.create(task.getTenantId(), task.getAccountId(), task.getTargetGroupId(),
                "剧本委托-" + task.getId() + "-" + row.getSeq(), null, ids);
            row.setRefType("kick");
            row.setRefId(t.getId());
            return true;
        }
        return false;
    }

    /** 极简取 JSON 字符串字段（够用即可，不引 JSON 库）。 */
    static String jsonString(String json, String key) {
        if (json == null) return null;
        String pat = "\"" + key + "\"";
        int i = json.indexOf(pat);
        if (i < 0) return null;
        int c = json.indexOf(':', i + pat.length());
        if (c < 0) return null;
        int q1 = json.indexOf('"', c + 1);
        if (q1 < 0) return null;
        int q2 = json.indexOf('"', q1 + 1);
        return q2 < 0 ? null : json.substring(q1 + 1, q2);
    }

    /** 极简取 JSON 字符串数组字段。 */
    static List<String> jsonList(String json, String key) {
        List<String> out = new ArrayList<>();
        if (json == null) return out;
        String pat = "\"" + key + "\"";
        int i = json.indexOf(pat);
        if (i < 0) return out;
        int lb = json.indexOf('[', i);
        if (lb < 0) return out;
        int rb = json.indexOf(']', lb);
        if (rb < 0) return out;
        for (String part : json.substring(lb + 1, rb).split(",")) {
            String s = part.trim();
            if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
                out.add(s.substring(1, s.length() - 1));
            }
        }
        return out;
    }

    /** 桌面端回报某步结果：success 推进/收轮；failed 累计 attempts、超阈值切号(failover)、用尽判 error。 */
    @Transactional
    public void onStepResult(Long taskId, int seq, String status, String errorCode, String errorDetail, String msgKey) {
        ScriptTask task = taskMapper.selectById(taskId);
        if (task == null) return;
        ScriptTaskStep row = taskStepMapper.selectOne(new LambdaQueryWrapper<ScriptTaskStep>()
            .eq(ScriptTaskStep::getTaskId, taskId).eq(ScriptTaskStep::getSeq, seq).last("LIMIT 1"));
        if (row == null) return;
        row.setStatus(status);
        row.setErrorCode(errorCode);
        row.setErrorDetail(errorDetail);
        row.setMsgKey(msgKey);
        taskStepMapper.updateById(row);

        if (FAILED.equals(status)) {
            int attempts = (task.getAttempts() == null ? 0 : task.getAttempts()) + 1;
            task.setAttempts(attempts);
            task.setLastError(errorCode);
            // 只有**达阈值**才考虑切号；未达阈值就按兵不动（stay running）。
            // 切号成功留 running 等下一轮 scan 接着跑；账号用尽才判 error。
            // 别把「未达阈值」和「账号用尽」都当成 error——前者不是失败终态。
            if (attempts >= FAILOVER_THRESHOLD) {
                Long nextAcct = failoverAccount(task, attempts);
                if (nextAcct == null) {
                    task.setStatus(T_ERROR);
                }
                // 切号成功：断点不动，等下一轮 scan 继续（不重置 current_step）
            }
        }
        taskMapper.updateById(task);
    }

    /** 桌面端心跳。 */
    @Transactional
    public void heartbeat(Long taskId) {
        taskMapper.update(null, new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<ScriptTask>()
            .eq(ScriptTask::getId, taskId).set(ScriptTask::getHeartbeatAt, LocalDateTime.now()));
    }

    /** 回收心跳超时的 running task → error（不卡住调度）。 */
    @Transactional
    public int reapStale(LocalDateTime now) {
        LocalDateTime cutoff = now.minusSeconds(STALE_HEARTBEAT_SEC);
        List<ScriptTask> stale = taskMapper.selectList(new LambdaQueryWrapper<ScriptTask>()
            .eq(ScriptTask::getStatus, T_RUNNING).lt(ScriptTask::getHeartbeatAt, cutoff));
        for (ScriptTask t : stale) {
            t.setStatus(T_ERROR);
            t.setLastError("心跳超时");
            taskMapper.updateById(t);
        }
        return stale.size();
    }

    // ============ 内部 ============

    /** 断点推进：第一个 pending/无记录的 seq；sending 跳过；failed 不自动重试；全非 pending → null(本轮完)。 */
    private Integer nextStep(List<ScriptTaskStep> rows) {
        int maxSeq = -1;
        for (ScriptTaskStep r : rows) maxSeq = Math.max(maxSeq, r.getSeq());
        for (int seq = 0; seq <= maxSeq; seq++) {
            final int s = seq;
            ScriptTaskStep r = rows.stream().filter(x -> x.getSeq() == s).findFirst().orElse(null);
            if (r == null || PENDING.equals(r.getStatus())) return seq;
        }
        return null;
    }

    /** 一轮跑完：断点归零、已 success 的步清回 pending（下一轮整体重来），排下一轮 loop。 */
    private void resetForNextRound(ScriptTask task, List<ScriptTaskStep> rows, LocalDateTime now) {
        for (ScriptTaskStep r : rows) {
            if (SUCCESS.equals(r.getStatus())) {
                r.setStatus(PENDING);
                taskStepMapper.updateById(r);
            }
        }
        task.setCurrentStep(0);
        task.setNextRunAt(nextRunAt(task, now));
        taskMapper.updateById(task);
    }

    /** failover：attempts 超阈值就切剧本的有序账号列表里下一个；用尽 → null。切号不重置 current_step。 */
    private Long failoverAccount(ScriptTask task, int attempts) {
        if (attempts < FAILOVER_THRESHOLD) return null;
        ScriptPlaybook pb = playbookMapper.selectById(task.getPlaybookId());
        List<Long> ids = pb == null || pb.getAccountIds() == null ? List.of() : parseIds(pb.getAccountIds());
        int cur = ids.indexOf(task.getAccountId());
        for (int i = Math.max(0, cur) + 1; i < ids.size(); i++) {
            task.setAccountId(ids.get(i));
            task.setAttempts(0);
            return ids.get(i);
        }
        return null;
    }

    private LocalDateTime nextRunAt(ScriptTask task, LocalDateTime now) {
        ScriptPlaybook pb = playbookMapper.selectById(task.getPlaybookId());
        int interval = pb == null || pb.getLoopIntervalSec() == null ? 3600 : pb.getLoopIntervalSec();
        return now.plusSeconds(interval);
    }

    private List<ScriptPlaybookStep> playbookSteps(Long playbookId) {
        return playbookStepMapper.selectList(new LambdaQueryWrapper<ScriptPlaybookStep>()
            .eq(ScriptPlaybookStep::getPlaybookId, playbookId).orderByAsc(ScriptPlaybookStep::getSeq));
    }

    private List<ScriptTaskStep> taskSteps(Long taskId) {
        return taskStepMapper.selectList(new LambdaQueryWrapper<ScriptTaskStep>()
            .eq(ScriptTaskStep::getTaskId, taskId).orderByAsc(ScriptTaskStep::getSeq));
    }

    /** 极简 JSON 数组解析（[7,2]）——account_ids 是 JSON 文本数组，避免为此引 JSON 库。 */
    private static List<Long> parseIds(String json) {
        try {
            String body = json.trim();
            if (body.startsWith("[") && body.endsWith("]")) body = body.substring(1, body.length() - 1);
            if (body.isBlank()) return List.of();
            List<Long> out = new java.util.ArrayList<>();
            for (String part : body.split(",")) {
                String s = part.trim();
                if (!s.isEmpty()) out.add(Long.parseLong(s));
            }
            return out;
        } catch (RuntimeException e) {
            return List.of();
        }
    }
}
