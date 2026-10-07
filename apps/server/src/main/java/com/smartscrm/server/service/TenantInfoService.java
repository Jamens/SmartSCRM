package com.smartscrm.server.service;

import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.TenantMapper;
import com.smartscrm.server.web.vo.PlanDefVO;
import com.smartscrm.server.web.vo.TenantInfoVO;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * 桌面端读取当前租户套餐/用量快照（B24 首页卡片）。席位已用数不在这里算，
 * 由前端用仪表盘总览的账号数合并，避免重复聚合。
 */
@Service
public class TenantInfoService {

    private final TenantMapper tenantMapper;

    public TenantInfoService(TenantMapper tenantMapper) {
        this.tenantMapper = tenantMapper;
    }

    public TenantInfoVO info(long tenantId) {
        Tenant t = tenantMapper.selectById(tenantId);
        if (t == null) {
            return new TenantInfoVO(null, null, null, null, 0, null, 0);
        }
        return new TenantInfoVO(
                t.getName(),
                t.getPlanName(),
                t.getSeatLimit(),
                t.getAiTokenLimit(),
                t.getAiTokenUsed() == null ? 0 : t.getAiTokenUsed(),
                t.getTranslationCharLimit(),
                t.getTranslationCharUsed() == null ? 0 : t.getTranslationCharUsed()
        );
    }

    /**
     * B12 模拟支付门控：返回预设套餐目录（前端用于渲染选择列表）。
     */
    public List<PlanDefVO> listPlans() {
        return PlanCatalog.all();
    }

    /**
     * B12 模拟支付门控：把指定套餐的限额写入当前租户，并把已用量清零（视为新购套餐）。
     * 真实场景中这一步应由支付回调驱动，这里仅作演示，由已认证的调用方直接触发，
     * 调用方只能改到自己所属的租户（tenantId 取自 AuthPrincipal），不会越权。
     */
    public TenantInfoVO activatePlan(long tenantId, String planCode) {
        PlanDefVO def = PlanCatalog.getByCode(planCode);
        if (def == null) {
            throw new IllegalArgumentException("unknown plan code: " + planCode);
        }
        Tenant t = tenantMapper.selectById(tenantId);
        if (t == null) {
            throw new IllegalStateException("tenant not found: " + tenantId);
        }
        t.setPlanName(def.code());
        t.setSeatLimit(def.seatLimit());
        t.setAiTokenLimit(def.aiTokenLimit());
        t.setAiTokenUsed(0);
        t.setTranslationCharLimit(def.translationCharLimit());
        t.setTranslationCharUsed(0);
        tenantMapper.updateById(t);
        return info(tenantId);
    }
}
