package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.NurturePlan;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.NurturePlanMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B9 互聊养号 · 数据层（租户隔离）。
 *
 * <p>**人工门**：建计划后 status=pending，必须显式 {@link #confirm} 成 confirmed 才允许执行
 * （执行链入口会用 {@link #requireConfirmed} 再判一次，见 spec §5——门不只靠 UI 挡）。
 * 养号真发消息不是无害操作，不默认跑。
 *
 * <p>**可复现的关键在 create**（spec §3.1）：account_ids 入库前按**平台名 + id 升序**重排，
 * 不依赖调用方传入顺序——同一批账号两次建计划必须得到同一份 account_ids，否则「装箱结果稳定」
 * 这条前提在数据层就破了。
 */
@Service
public class NurturePlanService {

    private final NurturePlanMapper mapper;
    private final PlatformAccountMapper accountMapper;

    public NurturePlanService(NurturePlanMapper mapper, PlatformAccountMapper accountMapper) {
        this.mapper = mapper;
        this.accountMapper = accountMapper;
    }

    /** 建养号计划。accountIds 会按平台分组+稳定排序后入库。status=pending，等人工确认。 */
    @Transactional
    public NurturePlan create(Long tenantId, String name, String groupChatKey, boolean createGroup,
                              List<Long> accountIds, Integer perGroup, List<Long> materialIds, Long seed,
                              List<String> atPoints, Integer speakingRounds,
                              Integer intervalMinSec, Integer intervalMaxSec, Integer jitterPct) {
        if (accountIds == null || accountIds.isEmpty()) {
            throw new BizException(40000, "参与账号不能为空");
        }
        if (atPoints == null || atPoints.isEmpty()) {
            throw new BizException(40000, "时间点不能为空");
        }
        // 校验账号归属本租户，并按平台分组+稳定排序（装箱可复现前提）
        List<PlatformAccount> owned = accountMapper.selectList(
            new LambdaQueryWrapper<PlatformAccount>().eq(PlatformAccount::getTenantId, tenantId)
                .in(PlatformAccount::getId, accountIds));
        if (owned.size() != new java.util.HashSet<>(accountIds).size()) {
            throw new BizException(40404, "存在不属于本租户或已删除的账号");
        }
        // 平台枚举码按**数值**比较（String 比较会错："10" < "2"），同平台再按 id 升序
        owned.sort((a, b) -> {
            int pa = a.getPlatformType() == null ? 0 : a.getPlatformType();
            int pb = b.getPlatformType() == null ? 0 : b.getPlatformType();
            return pa != pb ? Integer.compare(pa, pb) : Long.compare(a.getId(), b.getId());
        });

        NurturePlan p = new NurturePlan();
        p.setTenantId(tenantId);
        p.setName(name == null || name.isBlank() ? "养号计划" : name.trim());
        p.setGroupChatKey(groupChatKey == null || groupChatKey.isBlank() ? null : groupChatKey.trim());
        p.setCreateGroup(createGroup ? 1 : 0);
        if (p.getGroupChatKey() == null && !createGroup) {
            throw new BizException(40000, "建群开关未开时必须给目标群 chatKey");
        }
        p.setAccountIds(toJson(owned.stream().map(PlatformAccount::getId).toList()));
        p.setPerGroup(perGroup == null ? 10 : Math.max(1, perGroup));
        p.setMaterialIds(materialIds == null || materialIds.isEmpty() ? null : toJson(materialIds));
        p.setSeed(seed == null ? 1L : seed);
        p.setAtPoints(toJson(atPoints));
        p.setSpeakingRounds(speakingRounds == null ? 1 : Math.max(0, speakingRounds));
        p.setIntervalMinSec(intervalMinSec == null ? 60 : Math.max(1, intervalMinSec));
        p.setIntervalMaxSec(intervalMaxSec == null ? 120 : Math.max(1, intervalMaxSec));
        p.setJitterPct(jitterPct == null ? 20 : Math.min(100, Math.max(0, jitterPct)));
        p.setStatus("pending"); // 人工门
        mapper.insert(p);
        return p;
    }

    public List<NurturePlan> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<NurturePlan>()
            .eq(NurturePlan::getTenantId, tenantId).orderByDesc(NurturePlan::getId));
    }

    public NurturePlan get(Long tenantId, Long id) {
        NurturePlan p = mapper.selectById(id);
        if (p == null || !tenantId.equals(p.getTenantId())) throw new BizException(40404, "养号计划不存在: " + id);
        return p;
    }

    /** 人工门：确认计划。pending → confirmed。 */
    @Transactional
    public NurturePlan confirm(Long tenantId, Long id) {
        NurturePlan p = get(tenantId, id);
        if (!"pending".equals(p.getStatus())) {
            throw new BizException(40000, "只有 pending 计划可确认，当前: " + p.getStatus());
        }
        p.setStatus("confirmed");
        mapper.updateById(p);
        return p;
    }

    /**
     * 执行链入口的**人工门校验**（spec §5）：非 confirmed 一律拒绝。
     * 做成 public static 让执行器直接调用同一份判定，避免"UI 挡一道、执行链忘了再挡一道"。
     *
     * <p>口径：门是「**通过过确认**」这一事实，不是某一瞬间的状态。所以 {@code confirmed} 与
     * {@code running} 都算过门——计划跑起来后状态会转 running，若只认 confirmed 就会在第二天
     * 的调度里把自己拒掉（门变成一次性开关，而不是"已获准"的持续状态）。
     */
    public static void requireConfirmed(NurturePlan p) {
        String s = p == null ? null : p.getStatus();
        boolean passed = "confirmed".equals(s) || "running".equals(s);
        if (!passed) {
            throw new BizException(40301, "养号计划未经人工确认，禁止执行（需 confirmed）");
        }
    }

    @Transactional
    public void cancel(Long tenantId, Long id) {
        NurturePlan p = get(tenantId, id);
        p.setStatus("cancelled");
        mapper.updateById(p);
    }

    // ============ 内部 ============

    /** 极简 JSON 数组序列化（数字或字符串数组）。不引 JSON 库——够用即可。 */
    static String toJson(List<?> values) {
        List<String> parts = new ArrayList<>();
        for (Object v : values == null ? List.of() : values) {
            if (v == null) continue;
            String s = String.valueOf(v);
            parts.add(v instanceof Number ? s : "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"");
        }
        return "[" + String.join(",", parts) + "]";
    }
}
