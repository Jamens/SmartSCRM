package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.AiNurtureSetting;

public record AiNurtureSettingVO(Integer dailyLimit, Integer activeRatio, String quietHours, String recommend) {
    public static AiNurtureSettingVO of(AiNurtureSetting s) {
        return new AiNurtureSettingVO(s.getDailyLimit(), s.getActiveRatio(), s.getQuietHours(), s.getRecommend());
    }
}
