package com.smartscrm.server.web.vo;

import com.smartscrm.server.service.ai.KnowledgeSearchService;

/**
 * 一条检索命中：QA 原文 + 相似度分数。
 *
 * <p>{@code score} 是余弦相似度（0~1，越大越相近），随结果一起返回是为了让调用方能判断
 * 「这条够不够格拿去回答」——没有分数的话，运营只能凭感觉判断召回质量，也没法调阈值。
 */
public record KnowledgeSearchHitVO(Long id, Long roleId, Long categoryId, String question, String answer,
                                   String source, Float score) {
    public static KnowledgeSearchHitVO of(KnowledgeSearchService.Hit hit) {
        var q = hit.qa();
        return new KnowledgeSearchHitVO(q.getId(), q.getRoleId(), q.getCategoryId(), q.getQuestion(),
            q.getAnswer(), q.getSource(), hit.score());
    }
}
