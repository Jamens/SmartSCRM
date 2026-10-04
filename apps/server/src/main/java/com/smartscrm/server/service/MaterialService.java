package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.Material;
import com.smartscrm.server.entity.MaterialGroup;
import com.smartscrm.server.mapper.MaterialGroupMapper;
import com.smartscrm.server.mapper.MaterialMapper;
import com.smartscrm.server.web.dto.MaterialGroupRequest;
import com.smartscrm.server.web.dto.MaterialRequest;
import com.smartscrm.server.web.vo.MaterialGroupVO;
import com.smartscrm.server.web.vo.MaterialVO;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class MaterialService {

    private final MaterialMapper materialMapper;
    private final MaterialGroupMapper groupMapper;

    public MaterialService(MaterialMapper materialMapper, MaterialGroupMapper groupMapper) {
        this.materialMapper = materialMapper;
        this.groupMapper = groupMapper;
    }

    public List<MaterialGroupVO> listGroups(Long tenantId) {
        List<MaterialGroup> groups = groupMapper.selectList(new LambdaQueryWrapper<MaterialGroup>()
            .eq(MaterialGroup::getTenantId, tenantId)
            .orderByAsc(MaterialGroup::getSort)
            .orderByAsc(MaterialGroup::getId));
        List<Material> all = materialMapper.selectList(new LambdaQueryWrapper<Material>()
            .eq(Material::getTenantId, tenantId)
            .select(Material::getId, Material::getGroupId));
        Map<Long, Long> counts = all.stream()
            .filter(m -> m.getGroupId() != null)
            .collect(Collectors.groupingBy(Material::getGroupId, Collectors.counting()));
        return groups.stream()
            .map(g -> new MaterialGroupVO(g.getId(), g.getName(), g.getSort(), counts.getOrDefault(g.getId(), 0L)))
            .toList();
    }

    public MaterialGroup createGroup(Long tenantId, MaterialGroupRequest req) {
        if (existsGroupName(tenantId, req.name(), null)) {
            throw new BizException(40901, "素材分组名称已存在");
        }
        MaterialGroup group = new MaterialGroup();
        group.setTenantId(tenantId);
        group.setName(req.name().trim());
        group.setSort(req.sort() == null ? 0 : req.sort());
        groupMapper.insert(group);
        return groupMapper.selectById(group.getId());
    }

    public MaterialGroup updateGroup(Long tenantId, Long id, MaterialGroupRequest req) {
        MaterialGroup group = requireGroup(tenantId, id);
        if (existsGroupName(tenantId, req.name(), id)) {
            throw new BizException(40901, "素材分组名称已存在");
        }
        group.setName(req.name().trim());
        if (req.sort() != null) {
            group.setSort(req.sort());
        }
        groupMapper.updateById(group);
        return groupMapper.selectById(id);
    }

    public void deleteGroup(Long tenantId, Long id) {
        requireGroup(tenantId, id);
        groupMapper.deleteById(id);
    }

    /**
     * B17 P1 — 按归属可见性列出素材。
     *
     * <p>可见集是「公共 + 我自己的个人 +（指定客户时）该客户的联系人素材」三者之并，
     * 且这个并集是**硬边界**：`ownerScope` 过滤只能在可见集之内再收窄（"只看我的个人素材"），
     * 永远不能用来看到别人的个人素材。所以过滤是 AND 上去的，不是替换掉可见集。
     *
     * <p>联系人档默认不在列表里：它绑定的是某一位客户，没有客户上下文时列出来既是噪声
     * 又容易被误当成公共素材用掉。要取就显式传 `customerId`。
     */
    public List<MaterialVO> list(Long tenantId, Long userId, Long groupId, Integer type, String keyword,
                                 String ownerScope, Long customerId) {
        String uid = String.valueOf(userId);
        LambdaQueryWrapper<Material> wrapper = new LambdaQueryWrapper<Material>()
            .eq(Material::getTenantId, tenantId)
            .and(x -> {
                x.eq(Material::getOwnerScope, MaterialScope.PUBLIC)
                    .or(y -> y.eq(Material::getOwnerScope, MaterialScope.PERSONAL)
                        .eq(Material::getOwnerKey, uid));
                if (customerId != null) {
                    x.or(y -> y.eq(Material::getOwnerScope, MaterialScope.CONTACT)
                        .eq(Material::getOwnerKey, String.valueOf(customerId)));
                }
            });
        if (ownerScope != null && !ownerScope.isBlank()) {
            MaterialScope.requireValid(ownerScope);
            wrapper.eq(Material::getOwnerScope, MaterialScope.normalize(ownerScope));
        }
        if (groupId != null) {
            wrapper.eq(Material::getGroupId, groupId);
        }
        if (type != null) {
            wrapper.eq(Material::getType, type);
        }
        if (StringUtils.hasText(keyword)) {
            String kw = keyword.trim();
            wrapper.and(x -> x.like(Material::getName, kw).or().like(Material::getRemark, kw));
        }
        wrapper.orderByDesc(Material::getId);
        return materialMapper.selectList(wrapper).stream().map(MaterialVO::of).toList();
    }

    public MaterialVO create(Long tenantId, Long userId, MaterialRequest req) {
        Material material = new Material();
        material.setTenantId(tenantId);
        apply(material, tenantId, userId, req);
        materialMapper.insert(material);
        return MaterialVO.of(materialMapper.selectById(material.getId()));
    }

    public MaterialVO update(Long tenantId, Long userId, Long id, MaterialRequest req) {
        Material material = requireOwned(tenantId, userId, id);
        apply(material, tenantId, userId, req);
        materialMapper.updateById(material);
        // updateById skips null fields, so clear the optional columns explicitly.
        // url 与 buttonPayload 必须一起清：改类型（图片→按钮、按钮→图片）时留下另一档的
        // 旧值，落库后这行就是"既有 url 又有按钮载荷"的畸形素材。
        materialMapper.update(null, new LambdaUpdateWrapper<Material>()
            .eq(Material::getId, id)
            .set(Material::getUrl, material.getUrl())
            .set(Material::getButtonPayload, material.getButtonPayload())
            .set(Material::getGroupId, material.getGroupId())
            .set(Material::getMimeType, material.getMimeType())
            .set(Material::getSizeBytes, material.getSizeBytes())
            .set(Material::getRemark, material.getRemark()));
        return MaterialVO.of(materialMapper.selectById(id));
    }

    public void delete(Long tenantId, Long userId, Long id) {
        requireOwned(tenantId, userId, id);
        materialMapper.deleteById(id);
    }

    private void apply(Material material, Long tenantId, Long userId, MaterialRequest req) {
        if (req.groupId() != null) {
            requireGroup(tenantId, req.groupId());
        }
        material.setGroupId(req.groupId());
        material.setType(req.type());
        material.setName(req.name().trim());
        // 媒体素材必须有 url，按钮素材（type=5）没有 url——两档互斥，按 type 判定而不是
        // 让两个字段都可选（都可选就会出现"两个都空"的素材，落库后谁也不知道它是什么）。
        if (isButton(req.type())) {
            MaterialButtons.requireValid(req.buttonPayload());
            material.setUrl(null);
            material.setButtonPayload(req.buttonPayload().trim());
        } else {
            if (req.url() == null || req.url().isBlank()) {
                throw new BizException(40000, "素材 url 不能为空");
            }
            material.setUrl(req.url().trim());
            material.setButtonPayload(null);
        }
        material.setMimeType(StringUtils.hasText(req.mimeType()) ? req.mimeType().trim() : null);
        material.setSizeBytes(req.sizeBytes());
        material.setRemark(StringUtils.hasText(req.remark()) ? req.remark().trim() : null);
        // 归属键由 MaterialScope 成形：personal 强制写调用者自己的 userId，客户传什么都不算。
        String scope = MaterialScope.normalize(req.ownerScope());
        MaterialScope.requireValid(scope);
        material.setOwnerScope(scope);
        material.setOwnerKey(MaterialScope.keyFor(scope, userId, req.ownerKey()));
    }

    private static boolean isButton(Integer type) {
        return type != null && type == MaterialButtons.TYPE_BUTTON;
    }

    private MaterialGroup requireGroup(Long tenantId, Long id) {
        MaterialGroup group = groupMapper.selectById(id);
        if (group == null || !Objects.equals(group.getTenantId(), tenantId)) {
            throw new BizException(40404, "素材分组不存在");
        }
        return group;
    }

    private Material requireMaterial(Long tenantId, Long id) {
        Material material = materialMapper.selectById(id);
        if (material == null || !Objects.equals(material.getTenantId(), tenantId)) {
            throw new BizException(40404, "素材不存在");
        }
        return material;
    }

    /**
     * Exposed for other services (e.g. quick-reply) to snapshot a material the caller may use.
     *
     * <p>别人的 personal 素材回 40404 而不是 403：403 会替对方确认"这份素材存在"，
     * 而存在的正是别人名字下的东西。不存在是无害的回答。
     */
    public Material requireOwned(Long tenantId, Long userId, Long id) {
        Material material = requireMaterial(tenantId, id);
        if (!MaterialScope.usableBy(material.getOwnerScope(), material.getOwnerKey(), userId)) {
            throw new BizException(40404, "素材不存在");
        }
        return material;
    }

    private boolean existsGroupName(Long tenantId, String name, Long excludeId) {
        return groupMapper.exists(new LambdaQueryWrapper<MaterialGroup>()
            .eq(MaterialGroup::getTenantId, tenantId)
            .eq(MaterialGroup::getName, name.trim())
            .ne(excludeId != null, MaterialGroup::getId, excludeId));
    }
}
