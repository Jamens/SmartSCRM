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
import com.smartscrm.server.entity.AiCategory;
import com.smartscrm.server.entity.AiRole;
import com.smartscrm.server.entity.KnowledgeQa;
import com.smartscrm.server.mapper.AiCategoryMapper;
import com.smartscrm.server.mapper.AiRoleMapper;
import com.smartscrm.server.mapper.KnowledgeChunkMapper;
import com.smartscrm.server.mapper.KnowledgeQaMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B28 第一段（三栏数据层）service 单测：必填/重名/租户隔离。 */
class AiKnowledgeServiceTest {

    private static final Long TENANT = 1L;

    private AiRoleMapper roleMapper;
    private AiCategoryMapper categoryMapper;
    private KnowledgeQaMapper qaMapper;
    private KnowledgeChunkMapper chunkMapper;
    private AiRoleService roleService;
    private AiCategoryService categoryService;
    private KnowledgeQaService qaService;

    @BeforeEach
    void setUp() {
        // 纯单测无 Spring 上下文：手工注册 TableInfo，wrapper 才能解析列名。
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        TableInfoHelper.initTableInfo(asst, AiRole.class);
        TableInfoHelper.initTableInfo(asst, AiCategory.class);
        TableInfoHelper.initTableInfo(asst, KnowledgeQa.class);
        roleMapper = mock(AiRoleMapper.class);
        categoryMapper = mock(AiCategoryMapper.class);
        qaMapper = mock(KnowledgeQaMapper.class);
        chunkMapper = mock(KnowledgeChunkMapper.class);
        roleService = new AiRoleService(roleMapper);
        categoryService = new AiCategoryService(categoryMapper);
        qaService = new KnowledgeQaService(qaMapper, chunkMapper, roleMapper, categoryMapper);
        // create 会校验 roleId/categoryId 归属本租户（防跨租户挂靠）。本类用例用 roleId=1/categoryId=2，
        // 这里给出归属成立的默认桩；归属校验自己的用例在下方单独覆盖。
        AiRole ownedRole = new AiRole();
        ownedRole.setId(1L);
        ownedRole.setTenantId(TENANT);
        when(roleMapper.selectById(1L)).thenReturn(ownedRole);
        AiCategory ownedCat = new AiCategory();
        ownedCat.setId(2L);
        ownedCat.setTenantId(TENANT);
        when(categoryMapper.selectById(2L)).thenReturn(ownedCat);
    }

    // ===== 角色 =====

    @Test
    void roleCreate_trimsName_defaultsEnabled() {
        when(roleMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(0L);
        roleService.create(TENANT, "  客服  ", "你是客服", null, null);
        ArgumentCaptor<AiRole> cap = ArgumentCaptor.forClass(AiRole.class);
        verify(roleMapper).insert(cap.capture());
        assertEquals("客服", cap.getValue().getName());
        assertEquals(1, cap.getValue().getEnabled());
    }

    @Test
    void roleCreate_rejectsBlankAndDuplicate() {
        assertThrows(BizException.class, () -> roleService.create(TENANT, "  ", null, null, null));
        when(roleMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(1L);
        assertThrows(BizException.class, () -> roleService.create(TENANT, "客服", null, null, null));
        verify(roleMapper, never()).insert(any(AiRole.class));
    }

    @Test
    void roleUpdateDelete_otherTenantIsNotFound() {
        AiRole r = new AiRole();
        r.setId(9L);
        r.setTenantId(999L);
        when(roleMapper.selectById(9L)).thenReturn(r);
        assertThrows(BizException.class, () -> roleService.delete(TENANT, 9L));
    }

    // ===== 分类 =====

    @Test
    void categoryCreate_rejectsDuplicateName() {
        when(categoryMapper.selectCount(any(LambdaQueryWrapper.class))).thenReturn(1L);
        assertThrows(BizException.class, () -> categoryService.create(TENANT, "售后", null));
        verify(categoryMapper, never()).insert(any(AiCategory.class));
    }

    // ===== QA =====

    /**
     * 归属校验：roleId / categoryId 给了就必须属于本租户。
     *
     * <p>这条与同文件 {@code createDerived} 校验分片归属是同一条纪律。不校验的话，
     * 一个租户能把 QA 挂到别人的角色上，检索按角色收窄时会串到别人的知识，
     * 而这种错挂从界面上完全看不出来。
     */
    @Test
    void qaCreate_rejectsRoleOrCategoryOfOtherTenant() {
        AiRole foreignRole = new AiRole();
        foreignRole.setId(9L);
        foreignRole.setTenantId(999L);
        when(roleMapper.selectById(9L)).thenReturn(foreignRole);
        assertThrows(BizException.class,
            () -> qaService.create(TENANT, 9L, null, "问", "答", null));

        AiCategory foreignCat = new AiCategory();
        foreignCat.setId(8L);
        foreignCat.setTenantId(999L);
        when(categoryMapper.selectById(8L)).thenReturn(foreignCat);
        assertThrows(BizException.class,
            () -> qaService.create(TENANT, null, 8L, "问", "答", null));

        verify(qaMapper, never()).insert(any(KnowledgeQa.class));
    }

    /** 归属不存在（对方把角色删了）与归属他人同等对待，都拒绝。 */
    @Test
    void qaCreate_rejectsNullRoleOrCategory() {
        when(roleMapper.selectById(77L)).thenReturn(null);
        assertThrows(BizException.class,
            () -> qaService.create(TENANT, 77L, null, "问", "答", null));
        verify(qaMapper, never()).insert(any(KnowledgeQa.class));
    }

    @Test
    void qaCreate_setsManualSourceAndEnabled() {
        qaService.create(TENANT, 1L, 2L, "怎么退款？", "找客服", null);
        ArgumentCaptor<KnowledgeQa> cap = ArgumentCaptor.forClass(KnowledgeQa.class);
        verify(qaMapper).insert(cap.capture());
        assertEquals("manual", cap.getValue().getSource());
        assertEquals(1, cap.getValue().getStatus());
        assertEquals("怎么退款？", cap.getValue().getQuestion());
    }

    @Test
    void qaCreate_rejectsBlankQuestionOrAnswer() {
        assertThrows(BizException.class, () -> qaService.create(TENANT, null, null, " ", "答", null));
        assertThrows(BizException.class, () -> qaService.create(TENANT, null, null, "问", null, null));
        verify(qaMapper, never()).insert(any(KnowledgeQa.class));
    }

    @Test
    void qaUpdate_otherTenantIsNotFound() {
        KnowledgeQa q = new KnowledgeQa();
        q.setId(5L);
        q.setTenantId(999L);
        when(qaMapper.selectById(5L)).thenReturn(q);
        assertThrows(BizException.class, () -> qaService.delete(TENANT, 5L));
    }
}
