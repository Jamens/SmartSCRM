package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.NurturePlan;
import com.smartscrm.server.entity.NurtureRun;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.NurturePlanMapper;
import com.smartscrm.server.mapper.NurtureRunMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B9 互聊养号 · 执行链编排（spec §5）。**Java 编排，注入层真发消息**（与 B8/B18/B19 同构分工）。
 *
 * <p>到点判定与发言顺序全部用**可复现**口径（与 shared/nurturePlan.ts 同一套 LCG 规则）：
 * 同 seed 同计划必得同发言顺序，且 {@code uk(plan,at,round,account)} 保证一个 slot 只发一次。
 * 断点落在 {@code plan.lastRunDate}（当天跑到哪个时间点）。
 */
@Service
public class NurtureExecutorService {

    private static final Logger log = LoggerFactory.getLogger(NurtureExecutorService.class);

    private final NurtureRunMapper runMapper;
    private final NurturePlanMapper planMapper;
    private final PlatformAccountMapper accountMapper;

    public NurtureExecutorService(NurtureRunMapper runMapper, NurturePlanMapper planMapper,
                                  PlatformAccountMapper accountMapper) {
        this.runMapper = runMapper;
        this.planMapper = planMapper;
        this.accountMapper = accountMapper;
    }

    /**
     * 扫到点的计划，为该到的时间点生成发言 run 行（幂等：已存在的 slot 不重复建）。
     *
     * <p>只处理 {@code confirmed/running} 的计划（**人工门**：未确认的养号计划不发言），
     * 且只处理「今天已到点、且断点没跑过」的时间点。
     *
     * @return 新建的 run 行数
     */
    @Transactional
    public int scheduleDue(LocalDateTime now) {
        LocalDate today = now.toLocalDate();
        int created = 0;
        for (NurturePlan plan : listActive()) {
            NurturePlanService.requireConfirmed(plan);
            List<String> atPoints = parseJsonList(plan.getAtPoints());
            List<Long> accountIds = parseJsonLongs(plan.getAccountIds());
            if (atPoints.isEmpty() || accountIds.isEmpty()) continue;
            // 断点：今天已跑过就不重复（lastRunDate 存"已跑到哪个日期"）
            if (today.equals(plan.getLastRunDate()) && allSlotsDone(plan.getId(), atPoints, accountIds)) {
                continue;
            }
            for (String at : atPoints) {
                // 到点了才建（at <= 当前时间点；跨过午夜的时间点不提前建）
                if (!atReached(at, now)) continue;
                created += ensureSlots(plan, at, accountIds, today);
            }
            if (!today.equals(plan.getLastRunDate())) {
                plan.setLastRunDate(today);
                plan.setStatus("running");
                planMapper.updateById(plan);
            }
        }
        return created;
    }

    /** 某时间点为所有账号建 run 行（幂等）。发言顺序用可复现洗牌。 */
    private int ensureSlots(NurturePlan plan, String at, List<Long> accountIds, LocalDate today) {
        List<Long> order = speakingOrder(accountIds, seedOf(plan));
        int made = 0;
        for (int round = 0; round < Math.max(1, nvl(plan.getSpeakingRounds())); round++) {
            for (int i = 0; i < order.size(); i++) {
                Long accountId = order.get(i);
                // 幂等：同 (plan,at,round,account) 已存在就不建
                if (runMapper.selectCount(new LambdaQueryWrapper<NurtureRun>()
                    .eq(NurtureRun::getPlanId, plan.getId()).eq(NurtureRun::getAtPoint, at)
                    .eq(NurtureRun::getRoundIdx, round).eq(NurtureRun::getAccountId, accountId)) > 0) {
                    continue;
                }
                NurtureRun r = new NurtureRun();
                r.setTenantId(plan.getTenantId());
                r.setPlanId(plan.getId());
                r.setAccountId(accountId);
                r.setAtPoint(at);
                r.setRoundIdx(round);
                r.setSlotIndex(round * order.size() + i);
                r.setStatus("pending");
                runMapper.insert(r);
                made++;
            }
        }
        return made;
    }

    /** 取待发的 run（置 sending 占位）——桌面端按这个列表派发。 */
    @Transactional
    public List<NurtureRun> claimPending(Long tenantId, int limit) {
        List<NurtureRun> pending = runMapper.selectList(new LambdaQueryWrapper<NurtureRun>()
            .eq(NurtureRun::getTenantId, tenantId).eq(NurtureRun::getStatus, "pending")
            .orderByAsc(NurtureRun::getSlotIndex).orderByAsc(NurtureRun::getId)
            .last("LIMIT " + Math.max(1, limit)));
        for (NurtureRun r : pending) {
            r.setStatus("sending");
            runMapper.updateById(r);
        }
        return pending;
    }

    /** 桌面端回报发言结果。 */
    @Transactional
    public void reportResult(Long tenantId, Long runId, boolean ok, String msgKey, String error) {
        NurtureRun r = runMapper.selectById(runId);
        if (r == null || !tenantId.equals(r.getTenantId())) {
            throw new BizException(40404, "发言记录不存在: " + runId);
        }
        if (!"sending".equals(r.getStatus())) {
            return; // 重复回报，不改已终态
        }
        r.setStatus(ok ? "success" : "failed"); // 失败下一轮自然重试（不自动重试，spec §5）
        r.setMsgKey(msgKey);
        r.setErrorDetail(error == null ? null : (error.length() <= 255 ? error : error.substring(0, 255)));
        runMapper.updateById(r);
    }

    public List<NurtureRun> listRuns(Long tenantId, Long planId) {
        return runMapper.selectList(new LambdaQueryWrapper<NurtureRun>()
            .eq(NurtureRun::getTenantId, tenantId)
            .eq(planId != null, NurtureRun::getPlanId, planId)
            .orderByAsc(NurtureRun::getSlotIndex).orderByAsc(NurtureRun::getId));
    }

    // ============ 内部 ============

    private List<NurturePlan> listActive() {
        return planMapper.selectList(new LambdaQueryWrapper<NurturePlan>()
            .in(NurturePlan::getStatus, "confirmed", "running"));
    }

    private boolean allSlotsDone(Long planId, List<String> atPoints, List<Long> accountIds) {
        long pending = runMapper.selectCount(new LambdaQueryWrapper<NurtureRun>()
            .eq(NurtureRun::getPlanId, planId).in(NurtureRun::getStatus, "pending", "sending"));
        return pending == 0;
    }

    private static boolean atReached(String at, LocalDateTime now) {
        int target = atMinutes(at);
        if (target < 0) return false;
        return now.getHour() * 60 + now.getMinute() >= target;
    }

    /** 可复现洗牌（与 shared/nurturePlan.ts speakingOrder 同款 LCG）。 */
    static List<Long> speakingOrder(List<Long> accountIds, long seed) {
        List<Long> out = new ArrayList<>(accountIds);
        for (int i = out.size() - 1; i > 0; i--) {
            int j = (int) (lcg(seed * 7919 + i * 2654435761L) * (i + 1));
            Long t = out.get(i);
            out.set(i, out.get(Math.min(j, i)));
            out.set(Math.min(j, i), t);
        }
        return out;
    }

    private static double lcg(long seed) {
        long s = (seed * 1664525L + 1013904223L) & 0xFFFFFFFFL;
        return s / 4294967296.0;
    }

    private static long seedOf(NurturePlan p) {
        return p.getSeed() == null ? 1L : p.getSeed();
    }

    private static int atMinutes(String at) {
        if (at == null) return -1;
        try {
            String[] hm = at.trim().split(":");
            int h = Integer.parseInt(hm[0]);
            int m = hm.length > 1 ? Integer.parseInt(hm[1]) : 0;
            if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
            return h * 60 + m;
        } catch (RuntimeException e) {
            return -1;
        }
    }

    private static int nvl(Integer v) {
        return v == null ? 0 : v;
    }

    static List<String> parseJsonList(String json) {
        List<String> out = new ArrayList<>();
        for (String s : parseRaw(json)) out.add(s);
        return out;
    }

    static List<Long> parseJsonLongs(String json) {
        List<Long> out = new ArrayList<>();
        for (String s : parseRaw(json)) {
            try {
                out.add(Long.parseLong(s));
            } catch (NumberFormatException ignored) {
                // 脏数据跳过，不让一条坏数据炸掉整个 tick
            }
        }
        return out;
    }

    /** 极简 JSON 数组解析（取引号内或裸值）。 */
    private static List<String> parseRaw(String json) {
        List<String> out = new ArrayList<>();
        if (json == null) return out;
        String body = json.trim();
        if (body.startsWith("[") && body.endsWith("]")) body = body.substring(1, body.length() - 1);
        if (body.isBlank()) return out;
        for (String part : body.split(",")) {
            String s = part.trim();
            if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) s = s.substring(1, s.length() - 1);
            if (!s.isEmpty()) out.add(s);
        }
        return out;
    }
}
