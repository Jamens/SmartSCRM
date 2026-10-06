package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiNurtureSetting;
import com.smartscrm.server.entity.AiPersona;
import com.smartscrm.server.mapper.AiNurtureSettingMapper;
import com.smartscrm.server.mapper.AiPersonaMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** B28 第三段（人设 + 养号）service 单测。 */
class AiPersonaNurtureServiceTest {

    private static final Long TENANT = 1L;

    private AiPersonaMapper personaMapper;
    private AiNurtureSettingMapper nurtureMapper;
    private AiPersonaService personaService;
    private AiNurtureSettingService nurtureService;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        TableInfoHelper.initTableInfo(asst, AiPersona.class);
        TableInfoHelper.initTableInfo(asst, AiNurtureSetting.class);
        personaMapper = mock(AiPersonaMapper.class);
        nurtureMapper = mock(AiNurtureSettingMapper.class);
        personaService = new AiPersonaService(personaMapper);
        nurtureService = new AiNurtureSettingService(nurtureMapper);
    }

    // ===== 人设助手（模板草稿，不落库） =====

    @Test
    void generateDraft_picksTemplateByTone() {
        assertEquals("friendly", personaService.generateDraft("friendly").template());
        assertEquals("concise", personaService.generateDraft("Concise").template()); // 大小写不敏感
    }

    @Test
    void generateDraft_blankOrUnknownToneFallsBackToPro() {
        assertEquals("pro", personaService.generateDraft(null).template());
        assertEquals("pro", personaService.generateDraft("").template());
        assertEquals("pro", personaService.generateDraft("不存在的语气").template());
    }

    @Test
    void generateDraft_returnsNonEmptyPrompt() {
        var d = personaService.generateDraft("pro");
        assertTrue(d.prompt() != null && !d.prompt().isBlank());
        assertTrue(d.name() != null && !d.name().isBlank());
    }

    // ===== 养号设置 =====

    @Test
    void getOrCreate_absentSeedsDefault() {
        when(nurtureMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);
        var s = nurtureService.getOrCreate(TENANT);
        assertEquals(0, s.getDailyLimit());
        assertEquals(50, s.getActiveRatio());
        assertEquals("balanced", s.getRecommend());
    }

    @Test
    void update_clampsRatioAndLimit() {
        when(nurtureMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);
        var s = nurtureService.update(TENANT, -5, 999, null, null);
        assertEquals(0, s.getDailyLimit());   // 负数夹到 0
        assertEquals(100, s.getActiveRatio()); // >100 夹到 100
    }

    @Test
    void update_rejectsUnknownRecommend() {
        when(nurtureMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);
        assertThrows(BizException.class, () -> nurtureService.update(TENANT, null, null, null, "不存在的口径"));
    }
}
