package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiPersona;
import com.smartscrm.server.mapper.AiPersonaMapper;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B28 AI 人设（租户隔离）。CRUD + {@link #generateDraft} 人设助手。
 *
 * <p>助手**不调外部模型**（遵循「不外连商业云」红线）：按语气标签套内置模板产一份**草稿**，
 * 草稿只返回不落库（spec §5「失败不落库」的同一条保守取向）——由人工在界面确认后再 POST /ai-personas。
 */
@Service
public class AiPersonaService {

    /** 内置人设模板（与渲染层 `personaTemplateOf` 同一套口径：语气标签 → 模板）。 */
    private static final Map<String, PersonaTpl> TEMPLATES = Map.of(
        "friendly", new PersonaTpl("friendly", "亲切客服", "你是一名亲切耐心的客服，语气温暖、先安抚情绪再解决问题。"),
        "pro", new PersonaTpl("pro", "专业顾问", "你是一名专业顾问，答复准确、结构清晰，必要时给出步骤。"),
        "concise", new PersonaTpl("concise", "简洁客服", "你是一名简洁的客服，直接给出结论，不说多余的话。")
    );
    private static final PersonaTpl DEFAULT_TPL = TEMPLATES.get("pro");

    public record PersonaTpl(String id, String name, String prompt) {}
    /** 助手草稿（未落库）。 */
    public record PersonaDraft(String template, String name, String tone, String prompt) {}

    private final AiPersonaMapper mapper;

    public AiPersonaService(AiPersonaMapper mapper) {
        this.mapper = mapper;
    }

    public List<AiPersona> list(Long tenantId, Long roleId) {
        return mapper.selectList(new LambdaQueryWrapper<AiPersona>()
            .eq(AiPersona::getTenantId, tenantId)
            .eq(roleId != null, AiPersona::getRoleId, roleId)
            .orderByDesc(AiPersona::getId));
    }

    public AiPersona get(Long tenantId, Long id) {
        AiPersona p = mapper.selectById(id);
        if (p == null || !tenantId.equals(p.getTenantId())) {
            throw new BizException(40404, "人设不存在: " + id);
        }
        return p;
    }

    @Transactional
    public AiPersona create(Long tenantId, Long roleId, String name, String tone, String prompt, String template, Integer enabled) {
        AiPersona p = new AiPersona();
        p.setTenantId(tenantId);
        p.setRoleId(roleId);
        p.setName(requireName(name));
        p.setTone(tone);
        p.setPrompt(prompt);
        p.setTemplate(template);
        p.setEnabled(enabled == null ? 1 : (enabled == 0 ? 0 : 1));
        mapper.insert(p);
        return p;
    }

    @Transactional
    public AiPersona update(Long tenantId, Long id, Long roleId, String name, String tone, String prompt, String template, Integer enabled) {
        AiPersona p = get(tenantId, id);
        if (roleId != null) p.setRoleId(roleId);
        if (name != null && !name.isBlank()) p.setName(name.trim());
        if (tone != null) p.setTone(tone);
        if (prompt != null) p.setPrompt(prompt);
        if (template != null) p.setTemplate(template);
        if (enabled != null) p.setEnabled(enabled == 0 ? 0 : 1);
        mapper.updateById(p);
        return p;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        mapper.deleteById(get(tenantId, id).getId());
    }

    /**
     * 人设助手：按语气标签套模板产**草稿**（只返回不落库）。语气为空/未识别 → 默认 pro 模板。
     * 不调外部模型，故没有"生成失败"路径；草稿一律要人工确认后才落库。
     */
    public PersonaDraft generateDraft(String tone) {
        PersonaTpl tpl = TEMPLATES.getOrDefault(
            (tone == null ? "" : tone.trim().toLowerCase(java.util.Locale.ROOT)), DEFAULT_TPL);
        return new PersonaDraft(tpl.id(), tpl.name(), tpl.id(), tpl.prompt());
    }

    private static String requireName(String name) {
        if (name == null || name.isBlank()) {
            throw new BizException(40000, "name 不能为空");
        }
        return name.trim();
    }
}
