package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ScriptPlaybook;
import com.smartscrm.server.entity.ScriptPlaybookStep;
import com.smartscrm.server.entity.ScriptRole;
import com.smartscrm.server.entity.ScriptRoleCategory;
import com.smartscrm.server.mapper.ScriptActionTplMapper;
import com.smartscrm.server.mapper.ScriptPlaybookMapper;
import com.smartscrm.server.mapper.ScriptPlaybookStepMapper;
import com.smartscrm.server.mapper.ScriptRoleCategoryMapper;
import com.smartscrm.server.mapper.ScriptRoleMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** B8 P9-1 CRUD 校验单测：重名/租户隔离/动作白名单/seq 重复。 */
class ScriptCrudServiceTest {

    private static final Long TENANT = 1L;

    private ScriptRoleCategoryMapper categoryMapper;
    private ScriptRoleMapper roleMapper;
    private ScriptActionTplMapper tplMapper;
    private ScriptPlaybookMapper playbookMapper;
    private ScriptPlaybookStepMapper stepMapper;
    private ScriptRoleService roleService;
    private ScriptPlaybookService playbookService;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        for (Class<?> e : new Class<?>[] { ScriptRoleCategory.class, ScriptRole.class, ScriptPlaybook.class,
            ScriptPlaybookStep.class }) {
            TableInfoHelper.initTableInfo(asst, e);
        }
        categoryMapper = mock(ScriptRoleCategoryMapper.class);
        roleMapper = mock(ScriptRoleMapper.class);
        tplMapper = mock(ScriptActionTplMapper.class);
        playbookMapper = mock(ScriptPlaybookMapper.class);
        stepMapper = mock(ScriptPlaybookStepMapper.class);
        roleService = new ScriptRoleService(categoryMapper, roleMapper, tplMapper);
        playbookService = new ScriptPlaybookService(playbookMapper, stepMapper, roleMapper);
    }

    @Test
    void category_rejectsBlankAndDuplicate() {
        assertThrows(BizException.class, () -> roleService.createCategory(TENANT, "  ", null));
        when(categoryMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(1L);
        assertThrows(BizException.class, () -> roleService.createCategory(TENANT, "种草", null));
        verify(categoryMapper, never()).insert(any(ScriptRoleCategory.class));
    }

    @Test
    void category_otherTenantIsNotFound() {
        ScriptRoleCategory c = new ScriptRoleCategory();
        c.setId(1L);
        c.setTenantId(999L);
        when(categoryMapper.selectById(1L)).thenReturn(c);
        assertThrows(BizException.class, () -> roleService.deleteCategory(TENANT, 1L));
    }

    @Test
    void role_createValidatesCategoryOwnership() {
        // category 不属于本租户 → 404，不建角色
        ScriptRoleCategory c = new ScriptRoleCategory();
        c.setTenantId(999L);
        when(categoryMapper.selectById(5L)).thenReturn(c);
        assertThrows(BizException.class, () -> roleService.createRole(TENANT, 5L, "素人", null, null, null));
        verify(roleMapper, never()).insert(any(ScriptRole.class));
    }

    @Test
    void playbook_createRequiresRole() {
        assertThrows(BizException.class, () -> playbookService.create(TENANT, null, "剧本", null, null, null));
    }

    @Test
    void playbook_createDefaultsLoopInterval() {
        ScriptRole r = new ScriptRole();
        r.setTenantId(TENANT);
        when(roleMapper.selectById(5L)).thenReturn(r);
        var p = playbookService.create(TENANT, 5L, "每日种草", null, null, null);
        assertEquals(3600, p.getLoopIntervalSec(), "loop 间隔缺省 3600");
        assertEquals(1, p.getEnabled());
    }

    @Test
    void step_rejectsUnknownActionType() {
        ScriptPlaybook pb = new ScriptPlaybook();
        pb.setId(3L);
        pb.setTenantId(TENANT);
        when(playbookMapper.selectById(3L)).thenReturn(pb);
        assertThrows(BizException.class, () -> playbookService.createStep(TENANT, 3L, 0, "不存在的动作", null));
    }

    @Test
    void step_rejectsDuplicateSeq() {
        ScriptPlaybook pb = new ScriptPlaybook();
        pb.setId(3L);
        pb.setTenantId(TENANT);
        when(playbookMapper.selectById(3L)).thenReturn(pb);
        when(stepMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(1L);
        assertThrows(BizException.class, () -> playbookService.createStep(TENANT, 3L, 0, "post_message", null));
        verify(stepMapper, never()).insert(any(ScriptPlaybookStep.class));
    }

    // ===== account_ids 规范化（MySQL JSON 列拒收 "7,2" → 曾 500） =====

    @Test
    void normalizeAccountIds_convertsCommaStringToJsonArray() {
        assertEquals("[7,2]", ScriptPlaybookService.normalizeAccountIds("7,2"));
        assertEquals("[7,2]", ScriptPlaybookService.normalizeAccountIds(" 7 , 2 "));
        assertEquals("[7]", ScriptPlaybookService.normalizeAccountIds("7"));
        assertEquals("[7,2]", ScriptPlaybookService.normalizeAccountIds("[7,2]"), "已是 JSON 数组则原样保留");
        assertEquals(null, ScriptPlaybookService.normalizeAccountIds(null));
        assertEquals(null, ScriptPlaybookService.normalizeAccountIds("  "));
    }

    @Test
    void normalizeAccountIds_rejectsNonNumeric() {
        assertThrows(BizException.class, () -> ScriptPlaybookService.normalizeAccountIds("7,abc"));
    }

    @Test
    void create_normalizesAccountIds() {
        ScriptRole r = new ScriptRole();
        r.setTenantId(TENANT);
        when(roleMapper.selectById(5L)).thenReturn(r);
        var p = playbookService.create(TENANT, 5L, "剧本", null, null, "7,2");
        assertEquals("[7,2]", p.getAccountIds(), "服务层应把 7,2 规范成合法 JSON");
    }
}
