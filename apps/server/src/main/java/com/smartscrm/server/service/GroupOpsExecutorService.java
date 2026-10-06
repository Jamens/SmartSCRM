package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.GroupJoinItem;
import com.smartscrm.server.entity.GroupJoinTask;
import com.smartscrm.server.entity.GroupKickItem;
import com.smartscrm.server.entity.GroupKickTask;
import com.smartscrm.server.mapper.GroupJoinItemMapper;
import com.smartscrm.server.mapper.GroupJoinTaskMapper;
import com.smartscrm.server.mapper.GroupKickItemMapper;
import com.smartscrm.server.mapper.GroupKickTaskMapper;
import java.time.LocalDateTime;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B18/B19 执行链编排（spec §5/§9）。**Java 只编排状态，真正动 WhatsApp 的动作在注入层**
 * （bridge/whatsapp/groupOps.ts 调 wa-js）——这条分工是硬的，别想在 Java 里直接调 wa-js。
 *
 * <p>本类负责：选下一个待办 → **判人工门**（不只 UI 挡）→ 派发一条给桌面端 → 收结果回填 → 计数。
 * 随机间隔按 {@code shared/groupOps.ts} 的可复现 LCG 口径在 {@link #nextDelayMs} 里实现
 * （Java 侧同口径另写一份：那边给驱动/单测用、这边给服务端派发节奏用，规则一致但运行时不同）。
 *
 * <p><b>不自动重试 join</b>：邀请码失效/被封时重试只是浪费配额、还加深风控（spec §5）。
 */
@Service
public class GroupOpsExecutorService {

    private static final Logger log = LoggerFactory.getLogger(GroupOpsExecutorService.class);

    private final GroupJoinTaskMapper joinTaskMapper;
    private final GroupJoinItemMapper joinItemMapper;
    private final GroupKickTaskMapper kickTaskMapper;
    private final GroupKickItemMapper kickItemMapper;

    public GroupOpsExecutorService(GroupJoinTaskMapper joinTaskMapper, GroupJoinItemMapper joinItemMapper,
                                   GroupKickTaskMapper kickTaskMapper, GroupKickItemMapper kickItemMapper) {
        this.joinTaskMapper = joinTaskMapper;
        this.joinItemMapper = joinItemMapper;
        this.kickTaskMapper = kickTaskMapper;
        this.kickItemMapper = kickItemMapper;
    }

    // ==================== B18 加群 ====================

    /**
     * 取加群任务的下一个待办明细（pending 的第一条），并置 {@code joining} 占位。
     *
     * <p>**先判人工门**：{@link GroupJoinService#requireConfirmed}。这是第二道（UI 之外那道）——
     * 直接调本方法绕过 UI 时，非 confirmed 的任务在这里就被拒。
     *
     * @return 下一个待办；没有待办了返回 null（任务可能刚跑完一轮）
     */
    @Transactional
    public GroupJoinItem claimNextJoinItem(Long tenantId, Long taskId) {
        GroupJoinTask t = joinTaskMapper.selectById(taskId);
        if (t == null || !tenantId.equals(t.getTenantId())) throw new BizException(40404, "加群任务不存在: " + taskId);
        GroupJoinService.requireConfirmed(t); // 人工门：未确认一律拒绝执行

        GroupJoinItem item = joinItemMapper.selectOne(new LambdaQueryWrapper<GroupJoinItem>()
            .eq(GroupJoinItem::getTenantId, tenantId)
            .eq(GroupJoinItem::getTaskId, taskId)
            .eq(GroupJoinItem::getStatus, "pending")
            .orderByAsc(GroupJoinItem::getId).last("LIMIT 1"));
        if (item == null) {
            return null;
        }
        item.setStatus("joining");
        joinItemMapper.updateById(item);
        if (!"running".equals(t.getStatus())) {
            t.setStatus("running");
            joinTaskMapper.updateById(t);
        }
        return item;
    }

    /**
     * 收加群结果并回填。{@code pendingApproval} 也算 joined（已提交审核），
     * 但记进 {@code msgKey} 留痕——主进程据此区分"真进去了"和"等审核"。
     * 失败**不重试**：直接 failed，等人工换码（spec §5）。
     */
    @Transactional
    public void reportJoinResult(Long tenantId, Long taskId, Long itemId, boolean ok,
                                 String groupId, boolean pendingApproval, String error) {
        GroupJoinItem item = joinItemMapper.selectById(itemId);
        if (item == null || !tenantId.equals(item.getTenantId()) || !taskId.equals(item.getTaskId())) {
            throw new BizException(40404, "加群明细不存在: " + itemId);
        }
        if (!"joining".equals(item.getStatus())) {
            // 重复回报（重试/重复帧）：已终态就不动，避免把 joined 覆盖成 failed。
            return;
        }
        item.setStatus(ok ? "joined" : "failed");
        if (ok) {
            item.setGroupId(groupId);
            if (pendingApproval) item.setMsgKey("pending_approval");
        } else {
            item.setErrorDetail(clip(error, 255));
        }
        joinItemMapper.updateById(item);
        recountJoin(tenantId, taskId);
    }

    /** 全部明细到终态 → 任务置 done。计数每次回报后回填。 */
    @Transactional
    public void recountJoin(Long tenantId, Long taskId) {
        List<GroupJoinItem> items = joinItemMapper.selectList(new LambdaQueryWrapper<GroupJoinItem>()
            .eq(GroupJoinItem::getTenantId, tenantId).eq(GroupJoinItem::getTaskId, taskId));
        int ok = 0;
        int bad = 0;
        boolean running = false;
        for (GroupJoinItem i : items) {
            if ("joined".equals(i.getStatus())) ok++;
            else if ("failed".equals(i.getStatus())) bad++;
            else if ("joining".equals(i.getStatus())) running = true;
        }
        GroupJoinTask t = joinTaskMapper.selectById(taskId);
        if (t == null) return;
        t.setTotal(items.size());
        t.setSucceeded(ok);
        t.setFailed(bad);
        if (!running && ok + bad == items.size()) {
            t.setStatus("done");
        }
        joinTaskMapper.updateById(t);
    }

    /**
     * 下一个派发前的等待毫秒（随机间隔 + 抖动，spec §5）。
     * 与 shared/groupOps.ts 的 joinIntervalMs 同一套口径：可复现 LCG + ±jitter。
     * seed 用 taskId，index 用已终态的条数——同一任务跑到同一步必得同间隔（断点续跑节奏稳定）。
     */
    public long nextDelayMs(GroupJoinTask t, int doneCount) {
        int lo = t.getIntervalMinSec() == null ? 60 : t.getIntervalMinSec();
        int hi = t.getIntervalMaxSec() == null ? 120 : t.getIntervalMaxSec();
        if (lo > hi) { int x = lo; lo = hi; hi = x; }
        int jitterPct = t.getJitterPct() == null ? 20 : t.getJitterPct();
        long baseMs = (lo * 1000L) + Math.round(lcg(t.getId() * 7919 + doneCount * 104729) * (hi - lo) * 1000L);
        double p = Math.max(0, jitterPct) / 100.0;
        long jitter = Math.round(baseMs * p * (lcg(t.getId() * 15485863 + doneCount * 32452843) * 2 - 1));
        return Math.max(0L, baseMs + jitter);
    }

    // ==================== B19 踢人 ====================

    /**
     * 取踢人任务的下一个待踢成员，置 {@code removing}。
     * **先判人工门**（{@link GroupKickService#requireApproved}）——名单没审阅过不许踢。
     */
    @Transactional
    public GroupKickItem claimNextKickItem(Long tenantId, Long taskId) {
        GroupKickTask t = kickTaskMapper.selectById(taskId);
        if (t == null || !tenantId.equals(t.getTenantId())) throw new BizException(40404, "踢人任务不存在: " + taskId);
        GroupKickService.requireApproved(t); // 人工门：未审阅一律拒绝执行

        GroupKickItem item = kickItemMapper.selectOne(new LambdaQueryWrapper<GroupKickItem>()
            .eq(GroupKickItem::getTenantId, tenantId)
            .eq(GroupKickItem::getTaskId, taskId)
            .eq(GroupKickItem::getStatus, "pending")
            .orderByAsc(GroupKickItem::getId).last("LIMIT 1"));
        if (item == null) {
            return null;
        }
        item.setStatus("removing");
        kickItemMapper.updateById(item);
        if (!"running".equals(t.getStatus())) {
            t.setStatus("running");
            kickTaskMapper.updateById(t);
        }
        return item;
    }

    /**
     * 收踢人结果并回填。
     *
     * <p>{@code canRemove=false} → 标 {@code skipped}，**不算失败、不重试**：
     * 那是能力不允许（超管/自己），硬踢才是事故（spec §5 第 2 道门）。
     * 页内 {@code kickParticipants} 已经先判过 canRemove 再踢，这里只如实回填。
     */
    @Transactional
    public void reportKickResult(Long tenantId, Long taskId, Long itemId, String outcome, String error) {
        GroupKickItem item = kickItemMapper.selectById(itemId);
        if (item == null || !tenantId.equals(item.getTenantId()) || !taskId.equals(item.getTaskId())) {
            throw new BizException(40404, "待踢明细不存在: " + itemId);
        }
        if (!"removing".equals(item.getStatus())) {
            return; // 重复回报：已终态不动
        }
        String o = outcome == null ? "failed" : outcome;
        if ("removed".equals(o)) {
            item.setStatus("removed");
            item.setCanRemove(1);
        } else if ("skipped".equals(o)) {
            item.setStatus("skipped");
            item.setCanRemove(0);
        } else {
            item.setStatus("failed");
            item.setErrorDetail(clip(error, 255));
        }
        kickItemMapper.updateById(item);
        recountKick(tenantId, taskId);
    }

    @Transactional
    public void recountKick(Long tenantId, Long taskId) {
        List<GroupKickItem> items = kickItemMapper.selectList(new LambdaQueryWrapper<GroupKickItem>()
            .eq(GroupKickItem::getTenantId, tenantId).eq(GroupKickItem::getTaskId, taskId));
        int ok = 0;
        int bad = 0;
        boolean running = false;
        for (GroupKickItem i : items) {
            if ("removed".equals(i.getStatus())) ok++;
            else if ("failed".equals(i.getStatus())) bad++;
            else if ("removing".equals(i.getStatus())) running = true;
        }
        GroupKickTask t = kickTaskMapper.selectById(taskId);
        if (t == null) return;
        t.setTotal(items.size());
        t.setSucceeded(ok);
        t.setFailed(bad);
        if (!running && ok + bad == items.size()) {
            t.setStatus("done");
        }
        kickTaskMapper.updateById(t);
    }

    // ==================== 内部 ====================

    /** 与 shared/groupOps.ts 同款 LCG（可复现）。 */
    private static double lcg(long seed) {
        long s = (seed * 1664525L + 1013904223L) & 0xFFFFFFFFL;
        return s / 4294967296.0;
    }

    private static String clip(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
