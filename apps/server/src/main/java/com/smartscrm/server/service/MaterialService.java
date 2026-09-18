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

    public List<MaterialVO> list(Long tenantId, Long groupId, Integer type, String keyword) {
        LambdaQueryWrapper<Material> wrapper = new LambdaQueryWrapper<Material>()
            .eq(Material::getTenantId, tenantId);
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

    public MaterialVO create(Long tenantId, MaterialRequest req) {
        Material material = new Material();
        material.setTenantId(tenantId);
        apply(material, tenantId, req);
        materialMapper.insert(material);
        return MaterialVO.of(materialMapper.selectById(material.getId()));
    }

    public MaterialVO update(Long tenantId, Long id, MaterialRequest req) {
        Material material = requireMaterial(tenantId, id);
        apply(material, tenantId, req);
        materialMapper.updateById(material);
        // updateById skips null fields, so clear the optional columns explicitly.
        materialMapper.update(null, new LambdaUpdateWrapper<Material>()
            .eq(Material::getId, id)
            .set(Material::getGroupId, material.getGroupId())
            .set(Material::getMimeType, material.getMimeType())
            .set(Material::getSizeBytes, material.getSizeBytes())
            .set(Material::getRemark, material.getRemark()));
        return MaterialVO.of(materialMapper.selectById(id));
    }

    public void delete(Long tenantId, Long id) {
        requireMaterial(tenantId, id);
        materialMapper.deleteById(id);
    }

    private void apply(Material material, Long tenantId, MaterialRequest req) {
        if (req.groupId() != null) {
            requireGroup(tenantId, req.groupId());
        }
        material.setGroupId(req.groupId());
        material.setType(req.type());
        material.setName(req.name().trim());
        material.setUrl(req.url().trim());
        material.setMimeType(StringUtils.hasText(req.mimeType()) ? req.mimeType().trim() : null);
        material.setSizeBytes(req.sizeBytes());
        material.setRemark(StringUtils.hasText(req.remark()) ? req.remark().trim() : null);
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

    /** Exposed for other services (e.g. quick-reply) to snapshot an owned material. */
    public Material requireOwned(Long tenantId, Long id) {
        return requireMaterial(tenantId, id);
    }

    private boolean existsGroupName(Long tenantId, String name, Long excludeId) {
        return groupMapper.exists(new LambdaQueryWrapper<MaterialGroup>()
            .eq(MaterialGroup::getTenantId, tenantId)
            .eq(MaterialGroup::getName, name.trim())
            .ne(excludeId != null, MaterialGroup::getId, excludeId));
    }
}
