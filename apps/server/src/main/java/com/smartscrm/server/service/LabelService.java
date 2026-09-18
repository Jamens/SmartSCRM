package com.smartscrm.server.service;

import static com.smartscrm.server.service.CustomerService.toVO;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.CustomerLabel;
import com.smartscrm.server.entity.Label;
import com.smartscrm.server.entity.LabelGroup;
import com.smartscrm.server.mapper.CustomerLabelMapper;
import com.smartscrm.server.mapper.LabelGroupMapper;
import com.smartscrm.server.mapper.LabelMapper;
import com.smartscrm.server.web.dto.LabelGroupRequest;
import com.smartscrm.server.web.dto.LabelRequest;
import com.smartscrm.server.web.vo.LabelGroupVO;
import com.smartscrm.server.web.vo.LabelVO;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class LabelService {

    private final LabelGroupMapper groupMapper;
    private final LabelMapper labelMapper;
    private final CustomerLabelMapper customerLabelMapper;

    public LabelService(LabelGroupMapper groupMapper, LabelMapper labelMapper,
                        CustomerLabelMapper customerLabelMapper) {
        this.groupMapper = groupMapper;
        this.labelMapper = labelMapper;
        this.customerLabelMapper = customerLabelMapper;
    }

    public List<LabelGroupVO> tree(Long tenantId) {
        List<LabelGroup> groups = groupMapper.selectList(new LambdaQueryWrapper<LabelGroup>()
            .eq(LabelGroup::getTenantId, tenantId)
            .orderByAsc(LabelGroup::getSort)
            .orderByAsc(LabelGroup::getId));
        List<Label> labels = labelMapper.selectList(new LambdaQueryWrapper<Label>()
            .eq(Label::getTenantId, tenantId)
            .orderByAsc(Label::getSort)
            .orderByAsc(Label::getId));
        Map<Long, Long> counts = useCounts(labels.stream().map(Label::getId).toList());
        Map<Long, List<LabelVO>> byGroup = labels.stream()
            .collect(Collectors.groupingBy(Label::getGroupId,
                Collectors.mapping(l -> toVO(l, counts.getOrDefault(l.getId(), 0L)), Collectors.toList())));
        return groups.stream()
            .map(g -> new LabelGroupVO(g.getId(), g.getName(), g.getColor(), g.getSelectType(), g.getSort(),
                byGroup.getOrDefault(g.getId(), List.of())))
            .toList();
    }

    public LabelGroup createGroup(Long tenantId, LabelGroupRequest req) {
        if (existsGroupName(tenantId, req.name(), null)) {
            throw new BizException(40901, "标签组名称已存在");
        }
        LabelGroup group = new LabelGroup();
        group.setTenantId(tenantId);
        group.setName(req.name().trim());
        group.setColor(req.color());
        group.setSelectType(req.selectType() == null ? 0 : req.selectType());
        group.setSort(req.sort() == null ? 0 : req.sort());
        groupMapper.insert(group);
        return groupMapper.selectById(group.getId());
    }

    public LabelGroup updateGroup(Long tenantId, Long id, LabelGroupRequest req) {
        LabelGroup group = requireGroup(tenantId, id);
        if (existsGroupName(tenantId, req.name(), id)) {
            throw new BizException(40901, "标签组名称已存在");
        }
        group.setName(req.name().trim());
        group.setColor(req.color());
        if (req.selectType() != null) {
            group.setSelectType(req.selectType());
        }
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

    public LabelVO createLabel(Long tenantId, Long groupId, LabelRequest req) {
        requireGroup(tenantId, groupId);
        if (existsLabelName(groupId, req.name(), null)) {
            throw new BizException(40901, "标签名称已存在");
        }
        Label label = new Label();
        label.setTenantId(tenantId);
        label.setGroupId(groupId);
        label.setName(req.name().trim());
        label.setColor(req.color());
        label.setSort(req.sort() == null ? 0 : req.sort());
        labelMapper.insert(label);
        return toVO(labelMapper.selectById(label.getId()), 0L);
    }

    public LabelVO updateLabel(Long tenantId, Long id, LabelRequest req) {
        Label label = requireLabel(tenantId, id);
        if (existsLabelName(label.getGroupId(), req.name(), id)) {
            throw new BizException(40901, "标签名称已存在");
        }
        label.setName(req.name().trim());
        label.setColor(req.color());
        if (req.sort() != null) {
            label.setSort(req.sort());
        }
        labelMapper.updateById(label);
        Label fresh = labelMapper.selectById(id);
        return toVO(fresh, useCounts(List.of(id)).getOrDefault(id, 0L));
    }

    public void deleteLabel(Long tenantId, Long id) {
        requireLabel(tenantId, id);
        labelMapper.deleteById(id);
    }

    private Map<Long, Long> useCounts(List<Long> labelIds) {
        if (labelIds.isEmpty()) {
            return Map.of();
        }
        List<CustomerLabel> rows = customerLabelMapper.selectList(new LambdaQueryWrapper<CustomerLabel>()
            .in(CustomerLabel::getLabelId, labelIds));
        Map<Long, Long> counts = new HashMap<>();
        for (CustomerLabel row : rows) {
            counts.merge(row.getLabelId(), 1L, Long::sum);
        }
        return counts;
    }

    private LabelGroup requireGroup(Long tenantId, Long id) {
        LabelGroup group = groupMapper.selectById(id);
        if (group == null || !Objects.equals(group.getTenantId(), tenantId)) {
            throw new BizException(40404, "标签组不存在");
        }
        return group;
    }

    private Label requireLabel(Long tenantId, Long id) {
        Label label = labelMapper.selectById(id);
        if (label == null || !Objects.equals(label.getTenantId(), tenantId)) {
            throw new BizException(40404, "标签不存在");
        }
        return label;
    }

    private boolean existsGroupName(Long tenantId, String name, Long excludeId) {
        return groupMapper.exists(new LambdaQueryWrapper<LabelGroup>()
            .eq(LabelGroup::getTenantId, tenantId)
            .eq(LabelGroup::getName, name.trim())
            .ne(excludeId != null, LabelGroup::getId, excludeId));
    }

    private boolean existsLabelName(Long groupId, String name, Long excludeId) {
        return labelMapper.exists(new LambdaQueryWrapper<Label>()
            .eq(Label::getGroupId, groupId)
            .eq(Label::getName, name.trim())
            .ne(excludeId != null, Label::getId, excludeId));
    }
}
