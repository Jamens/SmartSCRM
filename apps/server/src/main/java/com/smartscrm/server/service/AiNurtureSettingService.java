package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.entity.AiNurtureSetting;
import com.smartscrm.server.mapper.AiNurtureSettingMapper;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B28 养号设置：按租户**一份**（uk(tenant_id)）。读时不存在就给一份默认（不报错，界面总有值）；
 * 写时 upsert。
 */
@Service
public class AiNurtureSettingService {

    private static final Set<String> RECOMMENDS = Set.of("conservative", "balanced", "aggressive");

    private final AiNurtureSettingMapper mapper;

    public AiNurtureSettingService(AiNurtureSettingMapper mapper) {
        this.mapper = mapper;
    }

    /** 读设置；没有则落一份默认再返回（保证界面永远拿得到一份）。 */
    @Transactional
    public AiNurtureSetting getOrCreate(Long tenantId) {
        AiNurtureSetting s = mapper.selectOne(new LambdaQueryWrapper<AiNurtureSetting>()
            .eq(AiNurtureSetting::getTenantId, tenantId).last("LIMIT 1"));
        if (s != null) {
            return s;
        }
        s = new AiNurtureSetting();
        s.setTenantId(tenantId);
        s.setDailyLimit(0);
        s.setActiveRatio(50);
        s.setQuietHours(null);
        s.setRecommend("balanced");
        mapper.insert(s);
        return s;
    }

    /** 更新设置（部分字段，null 不改）。 */
    @Transactional
    public AiNurtureSetting update(Long tenantId, Integer dailyLimit, Integer activeRatio, String quietHours, String recommend) {
        AiNurtureSetting s = getOrCreate(tenantId);
        if (dailyLimit != null) s.setDailyLimit(Math.max(0, dailyLimit));
        if (activeRatio != null) s.setActiveRatio(Math.min(100, Math.max(0, activeRatio)));
        if (quietHours != null) s.setQuietHours(quietHours.isBlank() ? null : quietHours.trim());
        if (recommend != null) {
            if (!RECOMMENDS.contains(recommend)) {
                throw new com.smartscrm.server.common.BizException(40000,
                    "recommend 只能是 conservative/balanced/aggressive");
            }
            s.setRecommend(recommend);
        }
        mapper.updateById(s);
        return s;
    }
}
