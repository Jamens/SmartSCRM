package com.smartscrm.server.service;

import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.TenantMapper;
import com.smartscrm.server.web.vo.TenantInfoVO;
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
}
