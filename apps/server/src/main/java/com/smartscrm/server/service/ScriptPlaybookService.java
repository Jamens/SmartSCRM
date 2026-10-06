package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ScriptPlaybook;
import com.smartscrm.server.entity.ScriptPlaybookStep;
import com.smartscrm.server.mapper.ScriptPlaybookMapper;
import com.smartscrm.server.mapper.ScriptPlaybookStepMapper;
import com.smartscrm.server.mapper.ScriptRoleMapper;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** B8 剧本 + 剧本步骤 CRUD，租户隔离。步骤 seq 在剧本内唯一。 */
@Service
public class ScriptPlaybookService {

    /** 动作类型白名单：与前端 @shared/scriptActions.ts 的词表同名对齐（后端也校验一份，防越界动作入库）。 */
    private static final Set<String> ACTION_TYPES =
        Set.of("post_message", "dm_member", "react", "join_group", "kick_member");

    private final ScriptPlaybookMapper playbookMapper;
    private final ScriptPlaybookStepMapper stepMapper;
    private final ScriptRoleMapper roleMapper;

    public ScriptPlaybookService(ScriptPlaybookMapper playbookMapper, ScriptPlaybookStepMapper stepMapper,
                                 ScriptRoleMapper roleMapper) {
        this.playbookMapper = playbookMapper;
        this.stepMapper = stepMapper;
        this.roleMapper = roleMapper;
    }

    // ---------- 剧本 ----------

    public List<ScriptPlaybook> list(Long tenantId) {
        return playbookMapper.selectList(new LambdaQueryWrapper<ScriptPlaybook>()
            .eq(ScriptPlaybook::getTenantId, tenantId).orderByAsc(ScriptPlaybook::getId));
    }

    @Transactional
    public ScriptPlaybook create(Long tenantId, Long roleId, String name, Integer enabled,
                                 Integer loopIntervalSec, String accountIds) {
        requireRole(tenantId, roleId);
        ScriptPlaybook p = new ScriptPlaybook();
        p.setTenantId(tenantId);
        p.setRoleId(roleId);
        p.setName(require(name, "name"));
        p.setEnabled(enabled == null ? 1 : (enabled == 0 ? 0 : 1));
        p.setLoopIntervalSec(loopIntervalSec == null ? 3600 : Math.max(60, loopIntervalSec));
        p.setAccountIds(accountIds);
        playbookMapper.insert(p);
        return p;
    }

    @Transactional
    public ScriptPlaybook update(Long tenantId, Long id, String name, Integer enabled,
                                 Integer loopIntervalSec, String accountIds) {
        ScriptPlaybook p = get(tenantId, id);
        if (name != null && !name.isBlank()) p.setName(name.trim());
        if (enabled != null) p.setEnabled(enabled == 0 ? 0 : 1);
        if (loopIntervalSec != null) p.setLoopIntervalSec(Math.max(60, loopIntervalSec));
        if (accountIds != null) p.setAccountIds(accountIds);
        playbookMapper.updateById(p);
        return p;
    }

    @Transactional
    public void delete(Long tenantId, Long id) {
        playbookMapper.deleteById(get(tenantId, id).getId());
    }

    private ScriptPlaybook get(Long tenantId, Long id) {
        ScriptPlaybook p = playbookMapper.selectById(id);
        if (p == null || !tenantId.equals(p.getTenantId())) throw new BizException(40404, "剧本不存在: " + id);
        return p;
    }

    // ---------- 步骤 ----------

    public List<ScriptPlaybookStep> listSteps(Long tenantId, Long playbookId) {
        get(tenantId, playbookId); // 校验归属
        return stepMapper.selectList(new LambdaQueryWrapper<ScriptPlaybookStep>()
            .eq(ScriptPlaybookStep::getTenantId, tenantId)
            .eq(ScriptPlaybookStep::getPlaybookId, playbookId)
            .orderByAsc(ScriptPlaybookStep::getSeq));
    }

    @Transactional
    public ScriptPlaybookStep createStep(Long tenantId, Long playbookId, Integer seq, String actionType, String params) {
        get(tenantId, playbookId);
        String at = requireAction(actionType);
        if (seq == null || seq < 0) throw new BizException(40000, "seq 必须 ≥ 0");
        if (stepMapper.selectCount(new LambdaQueryWrapper<ScriptPlaybookStep>()
            .eq(ScriptPlaybookStep::getPlaybookId, playbookId).eq(ScriptPlaybookStep::getSeq, seq)) > 0) {
            throw new BizException(40000, "步骤 seq 重复: " + seq);
        }
        ScriptPlaybookStep s = new ScriptPlaybookStep();
        s.setTenantId(tenantId);
        s.setPlaybookId(playbookId);
        s.setSeq(seq);
        s.setActionType(at);
        s.setParams(params);
        stepMapper.insert(s);
        return s;
    }

    @Transactional
    public ScriptPlaybookStep updateStep(Long tenantId, Long id, String actionType, String params) {
        ScriptPlaybookStep s = getStep(tenantId, id);
        if (actionType != null && !actionType.isBlank()) s.setActionType(requireAction(actionType));
        if (params != null) s.setParams(params);
        stepMapper.updateById(s);
        return s;
    }

    @Transactional
    public void deleteStep(Long tenantId, Long id) {
        stepMapper.deleteById(getStep(tenantId, id).getId());
    }

    private ScriptPlaybookStep getStep(Long tenantId, Long id) {
        ScriptPlaybookStep s = stepMapper.selectById(id);
        if (s == null || !tenantId.equals(s.getTenantId())) throw new BizException(40404, "步骤不存在: " + id);
        return s;
    }

    private void requireRole(Long tenantId, Long roleId) {
        var r = roleMapper.selectById(roleId);
        if (r == null || !tenantId.equals(r.getTenantId())) throw new BizException(40404, "角色不存在: " + roleId);
    }

    private static String requireAction(String actionType) {
        String at = require(actionType, "actionType");
        if (!ACTION_TYPES.contains(at)) throw new BizException(40000, "未知动作类型: " + at);
        return at;
    }

    private static String require(String v, String field) {
        if (v == null || v.isBlank()) throw new BizException(40000, field + " 不能为空");
        return v.trim();
    }
}
