package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.Material;
import com.smartscrm.server.mapper.MaterialGroupMapper;
import com.smartscrm.server.mapper.MaterialMapper;
import com.smartscrm.server.service.MediaStorageService;
import com.smartscrm.server.web.dto.MaterialRequest;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B17 P1 — material ownership: what each caller may see, and what they may touch. */
class MaterialServiceTest {

    private MaterialMapper materialMapper;
    private MaterialGroupMapper groupMapper;
    private MediaStorageService mediaStorage;
    private MaterialService service;

    @BeforeEach
    void setUp() {
        // Pure unit test has no Spring context; register TableInfo so the lambda wrappers
        // can resolve column names.
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), Material.class);
        materialMapper = mock(MaterialMapper.class);
        groupMapper = mock(MaterialGroupMapper.class);
        mediaStorage = mock(MediaStorageService.class);
        service = new MaterialService(materialMapper, groupMapper, mediaStorage);
    }

    @SuppressWarnings("unchecked")
    private LambdaQueryWrapper<Material> capturedListWrapper() {
        ArgumentCaptor<LambdaQueryWrapper<Material>> cap =
            ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(materialMapper).selectList(cap.capture());
        return cap.getValue();
    }

    @Test
    void list_scopesToPublicOrOwnPersonal() {
        when(materialMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(java.util.List.of());

        service.list(7L, 42L, null, null, null, null, null);

        // 测试环境没开 MP 的下划线策略，列名渲染成 camelCase；生产是 snake_case。
        // 两端都接受，断言才不会依赖全局配置（TakeoverServiceTest 里踩过同一处）。
        String sql = capturedListWrapper().getTargetSql().toLowerCase(java.util.Locale.ROOT).replace("_", "");
        assertTrue(sql.contains("ownerscope"), "可见性过滤没进 WHERE: " + sql);
        assertTrue(sql.contains("or"), "可见集不是并集，而是单条件: " + sql);
    }

    /**
     * 联系人档不该无条件出现在列表里。分支数就是证据：可见集每多一档就多一个
     * `owner_scope = ?`，所以不给 customerId 时应是 2（公共 + 我的个人），给了才是 3。
     * 比"SQL 变长了"这类断言强——变长可能是别的原因。
     */
    @Test
    void list_omitsContactRowsUnlessACustomerIsNamed() {
        when(materialMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(java.util.List.of());
        service.list(7L, 42L, null, null, null, null, null);
        service.list(7L, 42L, null, null, null, null, 99L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<LambdaQueryWrapper<Material>> cap =
            ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(materialMapper, org.mockito.Mockito.times(2)).selectList(cap.capture());
        int withoutCustomer = countOwnerScope(cap.getAllValues().get(0).getTargetSql());
        int withCustomer = countOwnerScope(cap.getAllValues().get(1).getTargetSql());
        assertEquals(2, withoutCustomer, "没给客户时可见集应只有公共+我的个人两档");
        assertEquals(3, withCustomer, "给了客户后应多并入联系人档");
    }

    private static int countOwnerScope(String rawSql) {
        String sql = rawSql.toLowerCase(java.util.Locale.ROOT).replace("_", "");
        int n = 0;
        int i = 0;
        while ((i = sql.indexOf("ownerscope", i)) >= 0) {
            n++;
            i += "ownerscope".length();
        }
        return n;
    }

    @Test
    void list_rejectsUnknownScope() {
        BizException ex = assertThrows(BizException.class,
            () -> service.list(7L, 42L, null, null, null, "team", null));
        assertEquals(40000, ex.getCode());
    }

    @Test
    void create_stampsPersonalKeyFromTheCallerNotTheRequest() {
        when(materialMapper.insert(any(Material.class))).thenReturn(1);
        Material saved = new Material();
        saved.setId(1L);
        // mock 的 insert 不会回填自增 id，所以 selectById 收到的是 null：用 any() 接住。
        when(materialMapper.selectById(any())).thenReturn(saved);

        service.create(7L, 42L, new MaterialRequest(null, 1, "n", "http://x", null, null, null,
            null, "personal", "999"));

        ArgumentCaptor<Material> cap = ArgumentCaptor.forClass(Material.class);
        verify(materialMapper).insert(cap.capture());
        assertEquals("personal", cap.getValue().getOwnerScope());
        // 客户端传了 999，落库的必须是调用者自己的 42。
        assertEquals("42", cap.getValue().getOwnerKey());
    }

    /** 按钮素材：载荷入库、url 置空——它本来就没有 URL。 */
    @Test
    void create_buttonMaterial_storesPayloadAndClearsUrl() {
        when(materialMapper.insert(any(Material.class))).thenReturn(1);
        when(materialMapper.selectById(any())).thenReturn(new Material());

        service.create(7L, 42L, new MaterialRequest(null, MaterialButtons.TYPE_BUTTON, "b", null,
            "{\"body\":\"选\",\"buttons\":[{\"type\":\"reply\",\"text\":\"是\",\"id\":\"y\"}]}",
            null, null, null, null, null));

        ArgumentCaptor<Material> cap = ArgumentCaptor.forClass(Material.class);
        verify(materialMapper).insert(cap.capture());
        assertEquals(null, cap.getValue().getUrl());
        assertEquals(1, MaterialButtons.countOf(cap.getValue().getButtonPayload()));
    }

    @Test
    void create_buttonMaterial_rejectsInvalidPayload() {
        BizException ex = assertThrows(BizException.class, () -> service.create(7L, 42L,
            new MaterialRequest(null, MaterialButtons.TYPE_BUTTON, "b", null,
                "{\"buttons\":[]}", null, null, null, null, null)));
        assertEquals(40000, ex.getCode());
        verify(materialMapper, never()).insert(any(Material.class));
    }

    /** 媒体素材必须有 url：现在 url 列可空了，这道校验从 DB 约束上移到服务层。 */
    @Test
    void create_mediaMaterial_requiresUrl() {
        BizException ex = assertThrows(BizException.class, () -> service.create(7L, 42L,
            new MaterialRequest(null, 1, "n", null, null, null, null, null, null, null)));
        assertEquals(40000, ex.getCode());
        verify(materialMapper, never()).insert(any(Material.class));
    }

    /** 反过来：媒体素材不该留下按钮载荷，否则这行就变成"既有 url 又有按钮"的畸形素材。 */
    @Test
    void create_mediaMaterial_clearsButtonPayload() {
        when(materialMapper.insert(any(Material.class))).thenReturn(1);
        when(materialMapper.selectById(any())).thenReturn(new Material());

        service.create(7L, 42L, new MaterialRequest(null, 1, "n", "http://x",
            "{\"buttons\":[{\"type\":\"reply\",\"text\":\"是\",\"id\":\"y\"}]}",
            null, null, null, null, null));

        ArgumentCaptor<Material> cap = ArgumentCaptor.forClass(Material.class);
        verify(materialMapper).insert(cap.capture());
        assertEquals(null, cap.getValue().getButtonPayload());
    }

    @Test
    void create_defaultsToPublicWithNullKey() {
        when(materialMapper.insert(any(Material.class))).thenReturn(1);
        when(materialMapper.selectById(any())).thenReturn(new Material());

        service.create(7L, 42L, new MaterialRequest(null, 1, "n", "http://x", null, null, null,
            null, null, null));

        ArgumentCaptor<Material> cap = ArgumentCaptor.forClass(Material.class);
        verify(materialMapper).insert(cap.capture());
        assertEquals("public", cap.getValue().getOwnerScope());
        assertEquals(null, cap.getValue().getOwnerKey());
    }

    @Test
    void requireOwned_allowsOwnerOfPersonalMaterial() {
        when(materialMapper.selectById(1L)).thenReturn(material("personal", "42"));

        assertEquals(1L, service.requireOwned(7L, 42L, 1L).getId());
    }

    @Test
    void requireOwned_hidesOtherSeatsPersonalMaterial() {
        when(materialMapper.selectById(1L)).thenReturn(material("personal", "42"));

        BizException ex = assertThrows(BizException.class, () -> service.requireOwned(7L, 8L, 1L));
        // 40404 而不是 403：不给对方确认"这份素材存在"。
        assertEquals(40404, ex.getCode());
    }

    @Test
    void requireOwned_rejectsForeignTenantEvenForPublicMaterial() {
        Material foreign = material("public", null);
        foreign.setTenantId(9L);
        when(materialMapper.selectById(1L)).thenReturn(foreign);

        assertThrows(BizException.class, () -> service.requireOwned(7L, 42L, 1L));
    }

    @Test
    void delete_refusesOtherSeatsPersonalMaterial() {
        when(materialMapper.selectById(1L)).thenReturn(material("personal", "42"));

        assertThrows(BizException.class, () -> service.delete(7L, 8L, 1L));
        // deleteById 有 (Serializable) 与 (T) 两个重载，any() 会歧义；显式转 Serializable。
        verify(materialMapper, never()).deleteById((java.io.Serializable) any());
    }

    /** 删除素材时，若它指向本站上传的文件，落库前先让存储层把文件删掉。 */
    @Test
    void delete_removesBackingMediaFileWhenOwned() {
        Material owned = material("public", null);
        owned.setUrl(MediaStorageService.MEDIA_URL_PREFIX + "abc.jpg");
        when(materialMapper.selectById(1L)).thenReturn(owned);

        service.delete(7L, 42L, 1L);

        verify(mediaStorage).deleteIfMedia(MediaStorageService.MEDIA_URL_PREFIX + "abc.jpg");
        verify(materialMapper).deleteById((java.io.Serializable) any());
    }

    /** 更新把 url 从本站文件改成外链时，旧文件要清掉，否则磁盘留孤儿。 */
    @Test
    void update_clearsOldMediaFileWhenUrlChanges() {
        Material owned = material("public", null);
        owned.setUrl(MediaStorageService.MEDIA_URL_PREFIX + "old.jpg");
        // requireOwned 与最终的 VO 取数都走 selectById，且返回的是被 apply 原地改写的同一实例。
        when(materialMapper.selectById(1L)).thenReturn(owned);
        when(materialMapper.updateById(any(Material.class))).thenReturn(1);
        when(materialMapper.update(any(), any())).thenReturn(1);
        // mediaStorage 是 mock，isMediaUrl 默认回 false，会跳过清理；按真实语义桩成 true。
        when(mediaStorage.isMediaUrl(anyString())).thenReturn(true);

        service.update(7L, 42L, 1L, new MaterialRequest(null, 1, "n", "https://other.com/x.png",
            null, "image/png", 10L, null, null, null));

        // 旧 url 是本站 media，新 url 是外链 → 按文件名删旧文件（不是整段 URL）。
        verify(mediaStorage).delete("old.jpg");
    }

    /** 改了别的字段但 url 没变（仍是本站文件），不该重复删文件。 */
    @Test
    void update_keepsMediaFileWhenUrlUnchanged() {
        Material owned = material("public", null);
        owned.setUrl(MediaStorageService.MEDIA_URL_PREFIX + "keep.jpg");
        when(materialMapper.selectById(1L)).thenReturn(owned);
        when(materialMapper.updateById(any(Material.class))).thenReturn(1);
        when(materialMapper.update(any(), any())).thenReturn(1);
        when(mediaStorage.isMediaUrl(anyString())).thenReturn(true);

        service.update(7L, 42L, 1L, new MaterialRequest(null, 1, "renamed", MediaStorageService.MEDIA_URL_PREFIX + "keep.jpg",
            null, "image/jpeg", 10L, null, null, null));

        verify(mediaStorage, never()).delete(any());
    }

    private static Material material(String scope, String key) {
        Material m = new Material();
        m.setId(1L);
        m.setTenantId(7L);
        m.setOwnerScope(scope);
        m.setOwnerKey(key);
        return m;
    }
}
