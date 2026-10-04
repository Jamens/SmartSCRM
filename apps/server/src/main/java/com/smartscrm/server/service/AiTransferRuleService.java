package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AiTransferRule;
import com.smartscrm.server.mapper.AiTransferRuleMapper;
import com.smartscrm.server.web.dto.AiTransferRuleDTO;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * B28 P2 — AI transfer-to-human rule engine (tenant-scoped).
 *
 * <p>Management: {@code list / get / create / update / delete}, all tenant-isolated.
 * Evaluation: {@link #firstMatch} loads the enabled rules for a tenant (priority desc,
 * id asc) and returns the highest-priority rule whose keywords match an inbound body;
 * rule bodies are compared case-insensitively, keywords are split on comma / Chinese
 * comma / semicolon.
 */
@Service
public class AiTransferRuleService {

    private static final Set<String> MATCH_MODES = Set.of("any", "all");

    private final AiTransferRuleMapper mapper;

    public AiTransferRuleService(AiTransferRuleMapper mapper) {
        this.mapper = mapper;
    }

    // ============ management (tenant-scoped) ============

    public List<AiTransferRule> list(Long tenantId) {
        return mapper.selectList(new LambdaQueryWrapper<AiTransferRule>()
            .eq(AiTransferRule::getTenantId, tenantId)
            .orderByDesc(AiTransferRule::getPriority)
            .orderByAsc(AiTransferRule::getId));
    }

    public AiTransferRule get(Long tenantId, Long id) {
        AiTransferRule rule = mapper.selectById(id);
        if (rule == null || !tenantId.equals(rule.getTenantId())) {
            throw new BizException(40404, "规则不存在: " + id);
        }
        return rule;
    }

    @Transactional
    public AiTransferRule create(Long tenantId, AiTransferRuleDTO dto) {
        validate(dto.ruleName(), dto.matchMode(), dto.keywords());
        AiTransferRule rule = new AiTransferRule();
        rule.setTenantId(tenantId);
        rule.setRuleName(dto.ruleName());
        rule.setMatchMode(dto.matchMode());
        rule.setKeywords(dto.keywords());
        rule.setTransferReason(dto.transferReason());
        rule.setEnabled(normalizeEnabled(dto.enabled()));
        rule.setPriority(dto.priority() == null ? 0 : dto.priority());
        mapper.insert(rule);
        return rule;
    }

    @Transactional
    public AiTransferRule update(Long tenantId, Long id, AiTransferRuleDTO dto) {
        AiTransferRule existing = get(tenantId, id);
        validate(dto.ruleName(), dto.matchMode(), dto.keywords());
        existing.setRuleName(dto.ruleName());
        existing.setMatchMode(dto.matchMode());
        existing.setKeywords(dto.keywords());
        existing.setTransferReason(dto.transferReason());
        if (dto.enabled() != null) {
            existing.setEnabled(normalizeEnabled(dto.enabled()));
        }
        if (dto.priority() != null) {
            existing.setPriority(dto.priority());
        }
        mapper.updateById(existing);
        return existing;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        AiTransferRule existing = get(tenantId, id);
        mapper.deleteById(existing.getId());
    }

    // ============ evaluation (pure, tenant-scoped) ============

    /**
     * Returns the highest-priority enabled rule matching {@code body}, or null. A blank
     * body never matches. Rules are evaluated in priority-desc / id-asc order, so the
     * first match is the highest-priority one. Only {@code enabled = 1} rules participate.
     */
    public AiTransferRule firstMatch(Long tenantId, String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        List<AiTransferRule> rules = mapper.selectList(new LambdaQueryWrapper<AiTransferRule>()
            .eq(AiTransferRule::getTenantId, tenantId)
            .eq(AiTransferRule::getEnabled, 1)
            .orderByDesc(AiTransferRule::getPriority)
            .orderByAsc(AiTransferRule::getId));
        String norm = body.toLowerCase();
        for (AiTransferRule rule : rules) {
            if (matches(rule, norm)) {
                return rule;
            }
        }
        return null;
    }

    /** True when {@code normBody} satisfies the rule's match mode against its (split) keywords. */
    private static boolean matches(AiTransferRule rule, String normBody) {
        List<String> keywords = splitKeywords(rule.getKeywords());
        if (keywords.isEmpty()) {
            return false;
        }
        boolean all = "all".equals(rule.getMatchMode());
        for (String kw : keywords) {
            boolean hit = normBody.contains(kw);
            if (all && !hit) {
                return false; // all-mode: one miss disqualifies
            }
            if (!all && hit) {
                return true;  // any-mode: one hit qualifies
            }
        }
        return all; // all-mode: every keyword hit; any-mode: no keyword hit
    }

    /**
     * Split on comma / Chinese comma / semicolon; trim; drop blanks; lowercase. Kept
     * static and side-effect-free so it is trivially unit-testable without a DB or Spring.
     */
    static List<String> splitKeywords(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return Arrays.stream(raw.split("[,，;；]"))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .map(String::toLowerCase)
            .toList();
    }

    // ============ validation / normalization ============

    private static void validate(String ruleName, String matchMode, String keywords) {
        if (ruleName == null || ruleName.isBlank()) {
            throw new BizException(40000, "ruleName 不能为空");
        }
        if (matchMode == null || !MATCH_MODES.contains(matchMode)) {
            throw new BizException(40000, "matchMode 只能是 any 或 all");
        }
        if (splitKeywords(keywords).isEmpty()) {
            throw new BizException(40000, "keywords 不能为空");
        }
    }

    private static int normalizeEnabled(Integer enabled) {
        return enabled == null ? 1 : (enabled == 0 ? 0 : 1);
    }
}
