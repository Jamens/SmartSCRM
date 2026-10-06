package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ScriptActionTpl;
import com.smartscrm.server.entity.ScriptRole;
import com.smartscrm.server.entity.ScriptRoleCategory;
import com.smartscrm.server.mapper.ScriptActionTplMapper;
import com.smartscrm.server.mapper.ScriptRoleCategoryMapper;
import com.smartscrm.server.mapper.ScriptRoleMapper;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** B8 剧本角色库（三级：品类→角色→动作模板）CRUD，租户隔离。 */
@Service
public class ScriptRoleService {

    private final ScriptRoleCategoryMapper categoryMapper;
    private final ScriptRoleMapper roleMapper;
    private final ScriptActionTplMapper tplMapper;

    public ScriptRoleService(ScriptRoleCategoryMapper categoryMapper, ScriptRoleMapper roleMapper,
                             ScriptActionTplMapper tplMapper) {
        this.categoryMapper = categoryMapper;
        this.roleMapper = roleMapper;
        this.tplMapper = tplMapper;
    }

    // ---------- 品类 ----------

    public List<ScriptRoleCategory> listCategories(Long tenantId) {
        return categoryMapper.selectList(new LambdaQueryWrapper<ScriptRoleCategory>()
            .eq(ScriptRoleCategory::getTenantId, tenantId)
            .orderByAsc(ScriptRoleCategory::getSort).orderByAsc(ScriptRoleCategory::getId));
    }

    @Transactional
    public ScriptRoleCategory createCategory(Long tenantId, String name, Integer sort) {
        String n = require(name, "name");
        if (countCategories(tenantId, n, null) > 0) throw new BizException(40000, "品类已存在: " + n);
        ScriptRoleCategory c = new ScriptRoleCategory();
        c.setTenantId(tenantId);
        c.setName(n);
        c.setSort(sort == null ? 0 : sort);
        categoryMapper.insert(c);
        return c;
    }

    @Transactional
    public ScriptRoleCategory updateCategory(Long tenantId, Long id, String name, Integer sort) {
        ScriptRoleCategory c = getCategory(tenantId, id);
        if (name != null && !name.isBlank()) {
            String n = name.trim();
            if (countCategories(tenantId, n, id) > 0) throw new BizException(40000, "品类已存在: " + n);
            c.setName(n);
        }
        if (sort != null) c.setSort(sort);
        categoryMapper.updateById(c);
        return c;
    }

    @Transactional
    public void deleteCategory(Long tenantId, Long id) {
        categoryMapper.deleteById(getCategory(tenantId, id).getId());
    }

    private ScriptRoleCategory getCategory(Long tenantId, Long id) {
        ScriptRoleCategory c = categoryMapper.selectById(id);
        if (c == null || !tenantId.equals(c.getTenantId())) throw new BizException(40404, "品类不存在: " + id);
        return c;
    }

    private long countCategories(Long tenantId, String name, Long excludeId) {
        return categoryMapper.selectCount(new LambdaQueryWrapper<ScriptRoleCategory>()
            .eq(ScriptRoleCategory::getTenantId, tenantId).eq(ScriptRoleCategory::getName, name)
            .ne(excludeId != null, ScriptRoleCategory::getId, excludeId));
    }

    // ---------- 角色 ----------

    public List<ScriptRole> listRoles(Long tenantId, Long categoryId) {
        return roleMapper.selectList(new LambdaQueryWrapper<ScriptRole>()
            .eq(ScriptRole::getTenantId, tenantId)
            .eq(categoryId != null, ScriptRole::getCategoryId, categoryId)
            .orderByAsc(ScriptRole::getSort).orderByAsc(ScriptRole::getId));
    }

    @Transactional
    public ScriptRole createRole(Long tenantId, Long categoryId, String name, String prompt, Integer enabled, Integer sort) {
        getCategory(tenantId, categoryId); // 校验品类归属
        String n = require(name, "name");
        if (countRoles(tenantId, categoryId, n, null) > 0) throw new BizException(40000, "角色已存在: " + n);
        ScriptRole r = new ScriptRole();
        r.setTenantId(tenantId);
        r.setCategoryId(categoryId);
        r.setName(n);
        r.setPrompt(prompt);
        r.setEnabled(enabled == null ? 1 : (enabled == 0 ? 0 : 1));
        r.setSort(sort == null ? 0 : sort);
        roleMapper.insert(r);
        return r;
    }

    @Transactional
    public ScriptRole updateRole(Long tenantId, Long id, String name, String prompt, Integer enabled, Integer sort) {
        ScriptRole r = getRole(tenantId, id);
        if (name != null && !name.isBlank()) {
            String n = name.trim();
            if (countRoles(tenantId, r.getCategoryId(), n, id) > 0) throw new BizException(40000, "角色已存在: " + n);
            r.setName(n);
        }
        if (prompt != null) r.setPrompt(prompt);
        if (enabled != null) r.setEnabled(enabled == 0 ? 0 : 1);
        if (sort != null) r.setSort(sort);
        roleMapper.updateById(r);
        return r;
    }

    @Transactional
    public void deleteRole(Long tenantId, Long id) {
        roleMapper.deleteById(getRole(tenantId, id).getId());
    }

    private ScriptRole getRole(Long tenantId, Long id) {
        ScriptRole r = roleMapper.selectById(id);
        if (r == null || !tenantId.equals(r.getTenantId())) throw new BizException(40404, "角色不存在: " + id);
        return r;
    }

    private long countRoles(Long tenantId, Long categoryId, String name, Long excludeId) {
        return roleMapper.selectCount(new LambdaQueryWrapper<ScriptRole>()
            .eq(ScriptRole::getTenantId, tenantId).eq(ScriptRole::getCategoryId, categoryId)
            .eq(ScriptRole::getName, name).ne(excludeId != null, ScriptRole::getId, excludeId));
    }

    // ---------- 动作模板 ----------

    public List<ScriptActionTpl> listTpls(Long tenantId, Long roleId) {
        return tplMapper.selectList(new LambdaQueryWrapper<ScriptActionTpl>()
            .eq(ScriptActionTpl::getTenantId, tenantId)
            .eq(roleId != null, ScriptActionTpl::getRoleId, roleId)
            .orderByAsc(ScriptActionTpl::getId));
    }

    @Transactional
    public ScriptActionTpl createTpl(Long tenantId, Long roleId, String actionType, String name, String params, Integer enabled) {
        getRole(tenantId, roleId); // 校验角色归属
        ScriptActionTpl t = new ScriptActionTpl();
        t.setTenantId(tenantId);
        t.setRoleId(roleId);
        t.setActionType(require(actionType, "actionType"));
        t.setName(require(name, "name"));
        t.setParams(params);
        t.setEnabled(enabled == null ? 1 : (enabled == 0 ? 0 : 1));
        tplMapper.insert(t);
        return t;
    }

    @Transactional
    public ScriptActionTpl updateTpl(Long tenantId, Long id, String actionType, String name, String params, Integer enabled) {
        ScriptActionTpl t = getTpl(tenantId, id);
        if (actionType != null && !actionType.isBlank()) t.setActionType(actionType.trim());
        if (name != null && !name.isBlank()) t.setName(name.trim());
        if (params != null) t.setParams(params);
        if (enabled != null) t.setEnabled(enabled == 0 ? 0 : 1);
        tplMapper.updateById(t);
        return t;
    }

    @Transactional
    public void deleteTpl(Long tenantId, Long id) {
        tplMapper.deleteById(getTpl(tenantId, id).getId());
    }

    private ScriptActionTpl getTpl(Long tenantId, Long id) {
        ScriptActionTpl t = tplMapper.selectById(id);
        if (t == null || !tenantId.equals(t.getTenantId())) throw new BizException(40404, "动作模板不存在: " + id);
        return t;
    }

    private static String require(String v, String field) {
        if (v == null || v.isBlank()) throw new BizException(40000, field + " 不能为空");
        return v.trim();
    }
}
