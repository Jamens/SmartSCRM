package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.BatchSendDetail;
import com.smartscrm.server.entity.BatchSendTask;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.BatchSendDetailMapper;
import com.smartscrm.server.mapper.BatchSendTaskMapper;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.service.batch.BatchExpansion;
import com.smartscrm.server.service.batch.BatchJson;
import com.smartscrm.server.service.batch.BatchRender;
import com.smartscrm.server.service.batch.BatchRules;
import com.smartscrm.server.service.batch.BatchStatus;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.web.dto.BatchPreviewDTO;
import com.smartscrm.server.web.dto.BatchRecallReportItemDTO;
import com.smartscrm.server.web.dto.BatchRecallReportsDTO;
import com.smartscrm.server.web.dto.BatchRecipientDTO;
import com.smartscrm.server.web.dto.BatchReportItemDTO;
import com.smartscrm.server.web.dto.BatchReportsDTO;
import com.smartscrm.server.web.dto.BatchTaskCreateDTO;
import com.smartscrm.server.web.vo.BatchCreateVO;
import com.smartscrm.server.web.vo.BatchDetailVO;
import com.smartscrm.server.web.vo.BatchPreviewVO;
import com.smartscrm.server.web.vo.BatchRecallVO;
import com.smartscrm.server.web.vo.BatchRejectedVO;
import com.smartscrm.server.web.vo.BatchReportsResultVO;
import com.smartscrm.server.web.vo.BatchTaskVO;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BatchSendService {

    /** 预览只渲染前 5 个收件人：向导里要看的是"变量填得对不对"，不是"能不能刷屏"。 */
    private static final int PREVIEW_MAX_RECIPIENTS = 5;
    private static final int INSERT_CHUNK = 500;
    /** R4：心跳断超过 60 s 即判「引擎没了」，先 unknown 后 paused。阈值定义在后端（spec §5），引擎什么都不传。 */
    private static final int STALE_SECONDS = 60;

    /** action → 目标态；action → 允许的来源态集合。两张表就是 spec §2 状态机全部代码化。 */
    private static final Map<String, String> TARGET_OF = Map.of(
            "start", "running", "pause", "paused", "resume", "running", "cancel", "cancelled");
    private static final Map<String, List<String>> SOURCES_OF = Map.of(
            "start", List.of("pending", "paused"),
            "pause", List.of("running"),
            "resume", List.of("paused"),
            "cancel", List.of("pending", "running", "paused"));

    private final BatchSendTaskMapper taskMapper;
    private final BatchSendDetailMapper detailMapper;
    private final PlatformAccountMapper accountMapper;
    private final ChatConversationMapper conversationMapper;
    private final CustomerMapper customerMapper;
    private final NotificationService notificationService;
    private static final Logger log = LoggerFactory.getLogger(BatchSendService.class);

    public BatchSendService(BatchSendTaskMapper taskMapper, BatchSendDetailMapper detailMapper,
                            PlatformAccountMapper accountMapper, ChatConversationMapper conversationMapper,
                            CustomerMapper customerMapper, NotificationService notificationService) {
        this.taskMapper = taskMapper;
        this.detailMapper = detailMapper;
        this.accountMapper = accountMapper;
        this.conversationMapper = conversationMapper;
        this.customerMapper = customerMapper;
        this.notificationService = notificationService;
    }

    @Transactional
    public BatchCreateVO create(long tenantId, BatchTaskCreateDTO dto) {
        List<BatchRecipientDTO> recipients = dedupe(dto.getConversations());
        int expandedTotal = recipients.size() * dto.getContents().size();
        List<String> v = new ArrayList<>(BatchRules.violations(dto.getPlatform(), recipients.size(),
                dto.getContents(), expandedTotal));
        v.addAll(BatchRules.intervalViolations(dto.getMsgIntervalMin(), dto.getMsgIntervalMax(),
                dto.getChatIntervalMin(), dto.getChatIntervalMax(), Boolean.TRUE.equals(dto.getDryRun())));
        if (dto.getAccountIds() == null || dto.getAccountIds().isEmpty()) {
            // spec §3.2 的第一句「accountIds 非空」归任务头，不进 BatchRules（它的签名只管任务体）。
            // 必须打在 requireAccountsBound 之前：空表会让那条 IN 塌成 `IN ()`，回 500 而不是 40013。
            v.add("账号不能为空");
        }
        if (!v.isEmpty()) {
            throw new BizException(40013, String.join("；", v));
        }
        requireAccountsBound(tenantId, dto.getAccountIds());

        Map<String, ChatConversation> convIndex = loadConversations(tenantId, recipients);
        Set<Long> chosen = new HashSet<>(dto.getAccountIds());
        List<BatchExpansion.Recipient> ok = new ArrayList<>();
        List<BatchRejectedVO> rejected = new ArrayList<>();
        for (BatchRecipientDTO r : recipients) {
            ChatConversation c = convIndex.get(convKey(r.getAccountId(), r.getChatKey()));
            if (!chosen.contains(r.getAccountId())) {
                // spec §3.2 的后半句「account_id ∈ accountIds」。不拦在这里的代价是静默半跑：
                // Task 11 的 buildQueues 按 accountIds 分组，不属于任何一组的明细行永远留在 pending，
                // openCount 也就永远不归零、任务永远到不了 done。
                rejected.add(new BatchRejectedVO(r.getChatKey(), r.getAccountId(), "这条会话所属的账号不在本次勾选的账号里"));
            } else if (c == null) {
                rejected.add(new BatchRejectedVO(r.getChatKey(), r.getAccountId(), "当前账号下没有这条会话的采集记录"));
            } else {
                ok.add(new BatchExpansion.Recipient(r.getAccountId(), r.getChatKey(), c.getCustomerId()));
            }
        }
        if (ok.isEmpty()) {
            throw new BizException(40012, "所有收件人都不可寻址");
        }
        Map<String, BatchRender.Fields> fieldsByKey = resolveFields(tenantId, convIndex, ok);
        List<BatchExpansion.ExpandedRow> rows = BatchExpansion.expand(ok, dto.getContents(),
                r -> fieldsByKey.getOrDefault(convKey(r.accountId(), r.chatKey()), BatchRender.EMPTY_FIELDS));

        // R35：上面那一遍量的是向导里的模板，这一遍量的是真要发出去的那串字——变量填进来才决定
        // 这一行有多长、还剩不剩下东西。放在落库之前，所以这一趟一行都不会留下。
        List<String> rendered = BatchRules.renderedViolations(rows);
        if (!rendered.isEmpty()) {
            throw new BizException(40013, String.join("；", rendered));
        }

        // 先落任务头拿自增 id，再分块落明细，最后用 countByTask 自检（spec §3.5）。
        BatchSendTask task = newTask(tenantId, dto, rows.size());
        taskMapper.insert(task);
        List<BatchSendDetail> details = toDetails(tenantId, task.getId(), rows);
        for (int i = 0; i < details.size(); i += INSERT_CHUNK) {
            detailMapper.insertBatch(details.subList(i, Math.min(i + INSERT_CHUNK, details.size())));
        }
        long counted = detailMapper.countByTask(tenantId, task.getId()).stream()
                .mapToLong(m -> ((Number) m.get("c")).longValue()).sum();
        if (counted != rows.size()) {
            // @Transactional 会回滚，所以这条抛出去就是"一行都不留"，不是"留一半"。
            throw new BizException(40014, "展开自检失败：期望 " + rows.size() + " 行，实落 " + counted + " 行");
        }
        return new BatchCreateVO(task.getId(), rejected, rows.size());
    }

    /**
     * 预览只走渲染器：不查库、不校验会话存在性（spec §4「渲染规则只有后端一份」）。
     * 变量取值与创建侧同一条兜底链（R9），但预览手上没有客户档，`{客户名}` 落到 chatKey 本地段、
     * `{号码}` 落到空串——这一格要给的是"变量填得对不对"的形状，不是真实收件人的号码。
     */
    public BatchPreviewVO preview(BatchPreviewDTO dto) {
        List<BatchRecipientDTO> recipients = dto.getConversations();
        List<String> contents = dto.getContents();
        int limit = Math.min(recipients.size(), PREVIEW_MAX_RECIPIENTS);
        List<BatchPreviewVO.Sample> rows = new ArrayList<>();
        for (int i = 0; i < limit; i++) {
            BatchRecipientDTO r = recipients.get(i);
            BatchRender.Fields fields = new BatchRender.Fields(null, localPart(r.getChatKey()), null);
            for (int ci = 0; ci < contents.size(); ci++) {
                rows.add(new BatchPreviewVO.Sample(r.getChatKey(), ci,
                        BatchRender.render(contents.get(ci), fields)));
            }
        }
        return new BatchPreviewVO(rows, recipients.size() > PREVIEW_MAX_RECIPIENTS);
    }

    public PageResult<BatchTaskVO> pageTasks(long tenantId, String status, int page, int size) {
        LambdaQueryWrapper<BatchSendTask> wrapper = new LambdaQueryWrapper<BatchSendTask>()
                .eq(BatchSendTask::getTenantId, tenantId)
                .eq(status != null && !status.isBlank(), BatchSendTask::getStatus, status)
                .orderByDesc(BatchSendTask::getId);
        Page<BatchSendTask> result = taskMapper.selectPage(new Page<>(page, size), wrapper);
        List<BatchTaskVO> records = result.getRecords().stream().map(this::toVO).toList();
        return PageResult.of(records, result.getTotal(), result.getCurrent(), result.getSize());
    }

    public BatchTaskVO task(long tenantId, long id) {
        return toVO(requireOwned(tenantId, id));
    }

    public PageResult<BatchDetailVO> pageDetails(long tenantId, long taskId, String sendStatus,
                                                 String recallStatus, int page, int size) {
        // R40：先过租户闸。少了这一闸，外来/不存在的 taskId 会回「一页空行」——
        // 那与「这一档筛选下确实没有行」在响应体上分不出来，而八跳运行端点对同一种输入说的是 40404。
        requireOwned(tenantId, taskId);
        LambdaQueryWrapper<BatchSendDetail> wrapper = new LambdaQueryWrapper<BatchSendDetail>()
                .eq(BatchSendDetail::getTenantId, tenantId)
                .eq(BatchSendDetail::getTaskId, taskId)
                .eq(sendStatus != null && !sendStatus.isBlank(), BatchSendDetail::getSendStatus, sendStatus)
                .eq(recallStatus != null && !recallStatus.isBlank(), BatchSendDetail::getRecallStatus, recallStatus)
                .orderByAsc(BatchSendDetail::getSeq);
        Page<BatchSendDetail> result = detailMapper.selectPage(new Page<>(page, size), wrapper);
        List<BatchDetailVO> records = result.getRecords().stream().map(this::toVO).toList();
        return PageResult.of(records, result.getTotal(), result.getCurrent(), result.getSize());
    }

    /** 租户闸：Task 5 的十条运行端点全部复用它。 */
    public BatchSendTask requireOwned(long tenantId, long taskId) {
        BatchSendTask task = taskMapper.selectOne(new LambdaQueryWrapper<BatchSendTask>()
                .eq(BatchSendTask::getTenantId, tenantId)
                .eq(BatchSendTask::getId, taskId));
        if (task == null) {
            throw new BizException(40404, "任务不存在");
        }
        return task;
    }

    @Transactional
    public BatchReportsResultVO transition(long tenantId, long taskId, String action) {
        BatchSendTask task = requireOwned(tenantId, taskId);
        String to = TARGET_OF.get(action);
        List<String> sources = SOURCES_OF.getOrDefault(action, List.of());
        if (to == null || !sources.contains(task.getStatus()) || !BatchStatus.canMove(task.getStatus(), to)) {
            throw new BizException(40902,
                    "当前状态 " + task.getStatus() + " 不能 " + action, HttpStatus.CONFLICT);
        }
        // 0 行 = 有人先我一步搬走了它（两个窗口同时点「继续」）。
        if (taskMapper.moveTo(tenantId, taskId, task.getStatus(), to) == 0) {
            throw new BizException(40902, "任务状态已被并发改变，请刷新后重试", HttpStatus.CONFLICT);
        }
        // R39：搬进 running 的当下就续一次心跳。引擎第一跳心跳最快也要 15 s 后，
        // 而 reconcile 的判据是「heartbeat_at 为空或早于 60 s」——不补这一拍，
        // 刚点下「开始」的任务在一次重启里就会被判成陈旧：明细转 unknown、任务转 paused。
        if ("running".equals(to)) {
            taskMapper.heartbeat(tenantId, taskId);
        }
        if ("cancel".equals(action)) {
            detailMapper.skipAllPending(tenantId, taskId);
        }
        return resultOf(tenantId, taskId);
    }

    public int heartbeat(long tenantId, long taskId) {
        return taskMapper.heartbeat(tenantId, taskId);
    }

    @Transactional
    public BatchReportsResultVO reports(long tenantId, long taskId, BatchReportsDTO dto) {
        requireOwned(tenantId, taskId);
        if (dto.getItems() != null) {
            // R37：先扫一遍词表再动手，越界就整页拒收。半收半拒会让这一页的计数与明细对不上，
            // 而引擎那一侧只看得到 code=0。词表在 BatchStatus 里只写一次，这里只读。
            List<String> outOfVocabulary = new ArrayList<>();
            for (BatchReportItemDTO item : dto.getItems()) {
                if (!BatchStatus.REPORTABLE_SEND_STATUS.contains(item.getSendStatus())) {
                    outOfVocabulary.add(item.getDetailId() + "=" + item.getSendStatus());
                }
            }
            if (!outOfVocabulary.isEmpty()) {
                throw new BizException(40013, "send_status 越界: " + String.join("、", outOfVocabulary));
            }
            LocalDateTime now = LocalDateTime.now(MsgTimes.CHAT_ZONE);
            for (BatchReportItemDTO item : dto.getItems()) {
                // 除词表外不做逐行状态守卫：引擎是唯一写入者（单实例锁），这一行结掉就是结掉。
                detailMapper.applyReport(tenantId, taskId, item.getDetailId(), item.getSendStatus(),
                        item.getLocalId(), item.getErrorCode(), item.getErrorDetail(),
                        item.getMsgKey(), item.getSentAtEpochSec() == null
                                ? ("success".equals(item.getSendStatus()) ? now : null)
                                : MsgTimes.toDbTime(item.getSentAtEpochSec(), now));
            }
        }
        Map<String, Object> counts = taskMapper.recount(tenantId, taskId);
        writeCounts(tenantId, taskId, intOf(counts, "sentCount"), intOf(counts, "failCount"));
        BatchSendTask task = requireOwned(tenantId, taskId);
        if ("running".equals(task.getStatus())) {
            int open = taskMapper.openCount(tenantId, taskId);
            if (dto.isAllHalted() && open > 0) {
                taskMapper.moveTo(tenantId, taskId, "running", "error");
                publishFinished(tenantId, task, false);
            } else if (open == 0) {
                taskMapper.moveTo(tenantId, taskId, "running", "done");
                publishFinished(tenantId, task, true);
            }
        }
        return resultOf(tenantId, taskId);
    }

    /**
     * A10 投递触发点：群发跑到终态（done / error）时给租户发一条系统通知。
     *
     * 只在**这一趟真的把状态搬进终态**时才发（外层已判 running），所以重复 reports 轮询
     * 不会重复投递。`userId=null` = 租户全员广播（任务表没记创建人，无法定向）。
     * 通知失败**不能**反过来把群发结算带崩——投递是旁路，包一层 try/catch 记日志。
     */
    private void publishFinished(long tenantId, BatchSendTask task, boolean done) {
        try {
            String title = done ? "批量群发任务已完成" : "批量群发任务异常终止";
            String content = task.getName() + "：成功 " + nvl(task.getSentCount())
                + " 条，失败 " + nvl(task.getFailCount()) + " 条";
            notificationService.publish(tenantId, "system", title, content, "/broadcast", null);
        } catch (RuntimeException e) {
            log.warn("群发终态通知投递失败 taskId={}", task.getId(), e);
        }
    }

    private static int nvl(Integer v) {
        return v == null ? 0 : v;
    }

    /**
     * R3 + R11。三跳一个事务：复位 → 刷计数 → 必要时唤醒。
     * `detailIds` 为空＝整批复位（spec §5 的 retry-failed 原语义），非空＝只复位勾选的那几条（spec §7 的单条重发）；
     * 两种都受 `WHERE send_status='failed'` 约束，所以 unknown 永远复位不掉。
     * 唤醒只在 done/error 上做：running 本来就有泵在跑，把它的状态搬走会让那一趟收尾（reports 的
     * running→done/error 判定）找不到自己认得的状态；但要按「running 中复位出来的 pending 行会被这台
     * 泵捡走」来理解就错了——主进程那台泵拿的是起泵时拉好的明细快照，这一行不在它的队列里，得由人工
     * 暂停再续才会重跑（界面按这个口径提示，V1 不做运行中重排队列）。
     * cancelled 不唤醒（那是人明确按下的停）。revive 与 reset 都判：一条都没复位就把终态搬走，
     * 页面上会出现"暂停中但无事可跑"的任务。
     */
    @Transactional
    public Map<String, Object> retryFailed(long tenantId, long taskId, List<Long> detailIds) {
        BatchSendTask task = requireOwned(tenantId, taskId);
        List<Long> ids = (detailIds == null || detailIds.isEmpty())
                ? null
                : List.copyOf(new LinkedHashSet<>(detailIds));
        int reset = detailMapper.retryFailed(tenantId, taskId, ids);
        if (reset > 0) {
            Map<String, Object> counts = taskMapper.recount(tenantId, taskId);
            writeCounts(tenantId, taskId, intOf(counts, "sentCount"), intOf(counts, "failCount"));
        }
        String from = task.getStatus();
        String to = from;
        // 唤醒三步各判一次，写成 if 而不是布尔表达式：moveTo 是带副作用的，藏在 && 链里读起来像纯判定。
        if (reset > 0 && ("done".equals(from) || "error".equals(from)) && BatchStatus.canMove(from, "paused")) {
            if (taskMapper.moveTo(tenantId, taskId, from, "paused") > 0) {
                to = "paused";
            }
        }
        // `status` 这一键桌面侧故意没人读（`batchApi.ts` 的 retryFailed 只取 `reset`，那儿的注释写明
        // "不穿 status，避免第二个状态真值源"）。留着它是因为唤醒这件事本身要说得出话——契约驱动按
        // 键名钉死这三列，删一行就会红；权威读数永远在 GET /tasks/{id}，别把这里当状态源。
        return Map.of("reset", reset, "status", to);
    }

    @Transactional
    public BatchRecallVO recall(long tenantId, long taskId, List<Long> detailIds) {
        BatchSendTask task = requireOwned(tenantId, taskId);
        Set<Long> wanted = new LinkedHashSet<>(detailIds);
        List<BatchSendDetail> found = detailMapper.selectList(new LambdaQueryWrapper<BatchSendDetail>()
                .eq(BatchSendDetail::getTenantId, tenantId)
                .eq(BatchSendDetail::getTaskId, taskId)
                .in(BatchSendDetail::getId, wanted)
                .orderByAsc(BatchSendDetail::getSeq));
        Set<Long> seen = new HashSet<>();
        List<BatchRecallVO.Target> eligible = new ArrayList<>();
        List<BatchRecallVO.Blocked> blocked = new ArrayList<>();
        // 读一遍再分区：每一条被挡都要说得出为什么（spec §4 的 recall 那行）。
        for (BatchSendDetail d : found) {
            seen.add(d.getId());
            String reason = BatchStatus.recallBlocker(task.getDryRun(), d.getSendStatus(), d.getMsgKey());
            if (reason != null) {
                blocked.add(new BatchRecallVO.Blocked(d.getId(), reason));
            } else if ("recalled".equals(d.getRecallStatus())) {
                // 撤回已经落定：这一条消息在客户脸上撤掉了就是撤掉了，再点一次什么也不会多。
                blocked.add(new BatchRecallVO.Blocked(d.getId(),
                        "已经撤回成功（recall_status=recalled），没有可再撤的东西"));
            } else if ("recalling".equals(d.getRecallStatus())) {
                // 挡死 `recalling`：可能正在别人的手里（另一台宿主或上一趟没跑完的循环），
                // 让它进 eligible 会把同一条消息扇出两遍，撤回不可回收。孤儿 `recalling` 由
                // `reconcile` 第三拍结回 `recall_failed`，然后走 `recall_failed` 那一条回程。
                blocked.add(new BatchRecallVO.Blocked(d.getId(),
                        "这条正在撤回中（recall_status=recalling），请等这一趟收口"));
            } else {
                // `none` 与 `recall_failed` 都落到 eligible（I-6 裁定：一次超时或一次页内失败
                // 不能把消息永久钉在客户脸上；`markRecalling` 现在也认 `recall_failed` 再进）。
                eligible.add(new BatchRecallVO.Target(d.getId(), d.getAccountId(), d.getChatKey(), d.getMsgKey()));
            }
        }
        // 库里没有的 id 也要点名：只按 id 传而不核对，打错消息的人是无辜的收件人。
        for (Long id : wanted) {
            if (!seen.contains(id)) {
                blocked.add(new BatchRecallVO.Blocked(id, "这一条不属于本任务或不存在"));
            }
        }
        if (!eligible.isEmpty()) {
            detailMapper.markRecalling(tenantId, taskId,
                    eligible.stream().map(BatchRecallVO.Target::detailId).toList());
        }
        return new BatchRecallVO(eligible, blocked);
    }

    /**
     * R4 两拍 + I-2 第三拍。前二拍顺序换了就是重复发送事故（先 unknown 后 paused）；第三拍读的是
     * 撤回行的 `recall_status`，那两拍读的是 `send_status` / 任务状态，两套列互不相干，所以第三拍
     * 放在最后与放在最前等价。它是 I-6 那条回程的入口：主进程 `batch:recall` 一条抛出会留下整批
     * 孤儿 `recalling`（`applyRecallReport` 只结 recalling 的行，没有生产者再报）——这里把它们
     * 结回 `recall_failed`，`markRecalling` 现在认 `recall_failed` 再进（同一批 Mapper 修改），
     * 用户才点得动「再试一次撤回」。
     */
    @Transactional
    public Map<String, Object> reconcile(long tenantId) {
        LocalDateTime staleBefore = LocalDateTime.now(MsgTimes.CHAT_ZONE).minusSeconds(STALE_SECONDS);
        int unknown = taskMapper.markStaleSendingUnknown(tenantId, staleBefore);
        int paused = taskMapper.pauseStaleTasks(tenantId, staleBefore);
        int recallFailed = detailMapper.markOrphanRecallingFailed(tenantId,
                "宿主在撤回途中中断，撤回结果未知");
        return Map.of("pausedTasks", paused, "markedUnknown", unknown,
                "markedRecallFailed", recallFailed);
    }

    /**
     * 逐条结撤回回执，把受影响行数累加返回：只有 recalling 的行结得掉（守卫在 SQL 里），
     * 差值就是「迟到的那一报」。getRecalled() 是包装 Boolean，缺字段读到 null——必须走
     * Boolean.TRUE.equals(...)，直接进条件会 NPE 出 50000，引擎只看得到「这一跳挂了」。
     * 先 requireOwned：任务不存在时要和其余九跳说同一句话。少了这一闸，错的 taskId 会回
     * settled:0——那与「每一条报都迟到了」在响应体上一模一样，而后者正是 reconcile 要处理的状态。
     */
    @Transactional
    public int recallReports(long tenantId, long taskId, BatchRecallReportsDTO dto) {
        requireOwned(tenantId, taskId);
        int settled = 0;
        for (BatchRecallReportItemDTO item : dto.getItems()) {
            settled += detailMapper.applyRecallReport(tenantId, taskId, item.getDetailId(),
                    Boolean.TRUE.equals(item.getRecalled()) ? "recalled" : "recall_failed", item.getDetail());
        }
        return settled;
    }

    /** 只碰这两列：updateById 会拿整个实体覆盖行，而这里手上的实体是旧的。 */
    private void writeCounts(long tenantId, long taskId, int sent, int fail) {
        taskMapper.update(null, new LambdaUpdateWrapper<BatchSendTask>()
                .eq(BatchSendTask::getTenantId, tenantId)
                .eq(BatchSendTask::getId, taskId)
                .set(BatchSendTask::getSentCount, sent)
                .set(BatchSendTask::getFailCount, fail));
    }

    /** 状态搬完之后的权威读数：Task 12 的 host 拿它广播，渲染层只认这一份。 */
    private BatchReportsResultVO resultOf(long tenantId, long taskId) {
        BatchSendTask t = requireOwned(tenantId, taskId);
        return new BatchReportsResultVO(nz(t.getSentCount()), nz(t.getFailCount()), nz(t.getTotalCount()),
                t.getStatus());
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }

    /** SUM(...) 无行时是 null；JDBC 也可能给 Long / BigDecimal，所以只认 Number。 */
    private static int intOf(Map<String, Object> row, String key) {
        Object v = row == null ? null : row.get(key);
        return v instanceof Number n ? n.intValue() : 0;
    }

    /** 两个 JSON 列 + 心跳：实体存串，VO 给结构。时间原样透传 LocalDateTime（Task 4 Step 2 的口径）。 */
    private BatchTaskVO toVO(BatchSendTask t) {
        // R36：只把「哪个任务的哪一列」交给解码异常，正文本身不许进异常文案。
        String where = "任务 " + t.getId() + " 的 ";
        return new BatchTaskVO(t.getId(), t.getName(), t.getPlatform(), Boolean.TRUE.equals(t.getDryRun()),
                t.getStatus(), BatchJson.readLongs(t.getAccountIds(), where + "account_ids"),
                BatchJson.readStrings(t.getContents(), where + "contents"),
                t.getMsgIntervalMin(), t.getMsgIntervalMax(), t.getChatIntervalMin(), t.getChatIntervalMax(),
                t.getTotalCount(), t.getSentCount(), t.getFailCount(), t.getHeartbeatAt(), t.getCreatedAt());
    }

    private BatchDetailVO toVO(BatchSendDetail d) {
        return new BatchDetailVO(d.getId(), d.getTaskId(), d.getSeq(), d.getAccountId(), d.getChatKey(),
                d.getCustomerId(), d.getContentIndex(), d.getBody(), d.getLocalId(), d.getSendStatus(),
                d.getErrorCode(), d.getErrorDetail(), d.getMsgKey(), d.getRecallStatus(), d.getRecallDetail(),
                d.getSentAt());
    }

    /** 保序去重：同一条会话在选人面板里可能被勾两次。key = accountId + ":" + chatKey。 */
    private List<BatchRecipientDTO> dedupe(List<BatchRecipientDTO> in) {
        Map<String, BatchRecipientDTO> m = new LinkedHashMap<>();
        for (BatchRecipientDTO r : in) {
            m.putIfAbsent(convKey(r.getAccountId(), r.getChatKey()), r);
        }
        return new ArrayList<>(m.values());
    }

    private String convKey(Long accountId, String chatKey) {
        return accountId + ":" + chatKey;
    }

    /** 缺任何一个 id、或它的 viewId 是空，都算账号不可用 —— 点名是哪几个。 */
    private void requireAccountsBound(long tenantId, List<Long> accountIds) {
        List<PlatformAccount> found = accountMapper.selectList(new LambdaQueryWrapper<PlatformAccount>()
                .eq(PlatformAccount::getTenantId, tenantId)
                .in(PlatformAccount::getId, accountIds));
        Map<Long, PlatformAccount> byId = new HashMap<>();
        found.forEach(a -> byId.put(a.getId(), a));
        List<String> bad = new ArrayList<>();
        for (Long id : accountIds) {
            PlatformAccount a = byId.get(id);
            if (a == null || a.getViewId() == null || a.getViewId().isBlank()) {
                bad.add(String.valueOf(id));
            }
        }
        if (!bad.isEmpty()) {
            throw new BizException(40011, "账号不可用: " + String.join(",", bad));
        }
    }

    /** 一次性把这些账号涉及会话捞进内存表，避免 N 个收件人打 N 次库。 */
    private Map<String, ChatConversation> loadConversations(long tenantId, List<BatchRecipientDTO> recipients) {
        Set<Long> accounts = new HashSet<>();
        Set<String> keys = new HashSet<>();
        recipients.forEach(r -> {
            accounts.add(r.getAccountId());
            keys.add(r.getChatKey());
        });
        List<ChatConversation> found = conversationMapper.selectList(new LambdaQueryWrapper<ChatConversation>()
                .eq(ChatConversation::getTenantId, tenantId)
                .in(ChatConversation::getAccountId, accounts)
                .in(ChatConversation::getChatKey, keys));
        Map<String, ChatConversation> index = new HashMap<>();
        found.forEach(c -> index.put(convKey(c.getAccountId(), c.getChatKey()), c));
        return index;
    }

    /**
     * 两个变量的取值来源（R9）：有客户用客户档案；没客户落到会话标题与 chat_key 本地段。
     * 一次性批量查客户，绝不在循环里 selectById —— 1000 个收件人会打出 1000 条 SQL。
     */
    private Map<String, BatchRender.Fields> resolveFields(long tenantId,
                                                          Map<String, ChatConversation> convIndex,
                                                          List<BatchExpansion.Recipient> ok) {
        Set<Long> customerIds = new HashSet<>();
        ok.forEach(r -> {
            if (r.customerId() != null) {
                customerIds.add(r.customerId());
            }
        });
        Map<Long, Customer> customers = new HashMap<>();
        if (!customerIds.isEmpty()) {
            // 租户闸：错链的那一行会把别人的昵称/号码渲染进 body，而 body 是要发出去的。
            customerMapper.selectList(new LambdaQueryWrapper<Customer>()
                            .eq(Customer::getTenantId, tenantId)
                            .in(Customer::getId, customerIds))
                    .forEach(c -> customers.put(c.getId(), c));
        }
        Map<String, BatchRender.Fields> out = new HashMap<>();
        for (BatchExpansion.Recipient r : ok) {
            ChatConversation c = convIndex.get(convKey(r.accountId(), r.chatKey()));
            Customer cu = r.customerId() == null ? null : customers.get(r.customerId());
            String nickname = cu != null && cu.getNickname() != null ? cu.getNickname() : (c == null ? null : c.getTitle());
            String openId = cu != null && cu.getOpenId() != null ? cu.getOpenId() : localPart(r.chatKey());
            out.put(convKey(r.accountId(), r.chatKey()),
                    new BatchRender.Fields(nickname, openId, cu == null ? null : cu.getPhone()));
        }
        return out;
    }

    /** `8613800000000@c.us` → `8613800000000`；群聊键 `1234-5678@c.us` 保持整串本地段。 */
    private String localPart(String chatKey) {
        int at = chatKey.indexOf('@');
        return at < 0 ? chatKey : chatKey.substring(0, at);
    }

    private BatchSendTask newTask(long tenantId, BatchTaskCreateDTO dto, int totalCount) {
        BatchSendTask t = new BatchSendTask();
        t.setTenantId(tenantId);
        t.setName(dto.getName().trim());
        t.setPlatform(dto.getPlatform());
        t.setDryRun(dto.getDryRun());
        t.setStatus("pending");
        t.setAccountIds(BatchJson.encodeLongs(dto.getAccountIds()));
        t.setContents(BatchJson.encodeStrings(dto.getContents()));
        t.setMsgIntervalMin(dto.getMsgIntervalMin());
        t.setMsgIntervalMax(dto.getMsgIntervalMax());
        t.setChatIntervalMin(dto.getChatIntervalMin());
        t.setChatIntervalMax(dto.getChatIntervalMax());
        t.setTotalCount(totalCount);
        t.setSentCount(0);
        t.setFailCount(0);
        return t;
    }

    private List<BatchSendDetail> toDetails(long tenantId, long taskId, List<BatchExpansion.ExpandedRow> rows) {
        List<BatchSendDetail> out = new ArrayList<>(rows.size());
        for (BatchExpansion.ExpandedRow r : rows) {
            BatchSendDetail d = new BatchSendDetail();
            d.setTenantId(tenantId);
            d.setTaskId(taskId);
            d.setSeq(r.seq());
            d.setAccountId(r.accountId());
            d.setChatKey(r.chatKey());
            d.setCustomerId(r.customerId());
            d.setContentIndex(r.contentIndex());
            d.setBody(r.body());
            d.setSendStatus("pending");
            d.setRecallStatus("none");
            out.add(d);
        }
        return out;
    }
}
