package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.Material;
import com.smartscrm.server.entity.QuickReply;
import com.smartscrm.server.entity.QuickReplyGroup;
import com.smartscrm.server.entity.QuickReplyItem;
import com.smartscrm.server.mapper.QuickReplyGroupMapper;
import com.smartscrm.server.mapper.QuickReplyItemMapper;
import com.smartscrm.server.mapper.QuickReplyMapper;
import com.smartscrm.server.web.dto.QuickReplyGroupRequest;
import com.smartscrm.server.web.dto.QuickReplyItemRequest;
import com.smartscrm.server.web.dto.QuickReplyRequest;
import com.smartscrm.server.web.vo.QuickReplyGroupVO;
import com.smartscrm.server.web.vo.QuickReplyItemVO;
import com.smartscrm.server.web.vo.QuickReplyVO;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class QuickReplyService {

    private final QuickReplyMapper replyMapper;
    private final QuickReplyGroupMapper groupMapper;
    private final QuickReplyItemMapper itemMapper;
    private final MaterialService materialService;

    public QuickReplyService(QuickReplyMapper replyMapper, QuickReplyGroupMapper groupMapper,
                             QuickReplyItemMapper itemMapper, MaterialService materialService) {
        this.replyMapper = replyMapper;
        this.groupMapper = groupMapper;
        this.itemMapper = itemMapper;
        this.materialService = materialService;
    }

    public List<QuickReplyGroupVO> listGroups(Long tenantId) {
        List<QuickReplyGroup> groups = groupMapper.selectList(new LambdaQueryWrapper<QuickReplyGroup>()
            .eq(QuickReplyGroup::getTenantId, tenantId)
            .orderByAsc(QuickReplyGroup::getSort)
            .orderByAsc(QuickReplyGroup::getId));
        List<QuickReply> replies = replyMapper.selectList(new LambdaQueryWrapper<QuickReply>()
            .eq(QuickReply::getTenantId, tenantId)
            .select(QuickReply::getId, QuickReply::getGroupId));
        Map<Long, Long> counts = replies.stream()
            .filter(r -> r.getGroupId() != null)
            .collect(Collectors.groupingBy(QuickReply::getGroupId, Collectors.counting()));
        return groups.stream()
            .map(g -> new QuickReplyGroupVO(g.getId(), g.getName(), g.getSort(), counts.getOrDefault(g.getId(), 0L)))
            .toList();
    }

    public QuickReplyGroup createGroup(Long tenantId, QuickReplyGroupRequest req) {
        if (existsGroupName(tenantId, req.name(), null)) {
            throw new BizException(40901, "分组名称已存在");
        }
        QuickReplyGroup group = new QuickReplyGroup();
        group.setTenantId(tenantId);
        group.setName(req.name().trim());
        group.setSort(req.sort() == null ? 0 : req.sort());
        groupMapper.insert(group);
        return groupMapper.selectById(group.getId());
    }

    public QuickReplyGroup updateGroup(Long tenantId, Long id, QuickReplyGroupRequest req) {
        QuickReplyGroup group = requireGroup(tenantId, id);
        if (existsGroupName(tenantId, req.name(), id)) {
            throw new BizException(40901, "分组名称已存在");
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

    public List<QuickReplyVO> list(Long tenantId, Long groupId, String keyword) {
        LambdaQueryWrapper<QuickReply> wrapper = new LambdaQueryWrapper<QuickReply>()
            .eq(QuickReply::getTenantId, tenantId);
        if (groupId != null) {
            wrapper.eq(QuickReply::getGroupId, groupId);
        }
        if (StringUtils.hasText(keyword)) {
            String kw = keyword.trim();
            wrapper.and(x -> x.like(QuickReply::getTitle, kw).or().like(QuickReply::getShortcut, kw));
        }
        wrapper.orderByAsc(QuickReply::getSort).orderByDesc(QuickReply::getId);
        List<QuickReply> replies = replyMapper.selectList(wrapper);
        Map<Long, List<QuickReplyItemVO>> items = itemsByReplyIds(replies.stream().map(QuickReply::getId).toList());
        return replies.stream()
            .map(r -> QuickReplyVO.of(r, items.getOrDefault(r.getId(), List.of())))
            .toList();
    }

    public QuickReplyVO detail(Long tenantId, Long id) {
        QuickReply reply = requireReply(tenantId, id);
        Map<Long, List<QuickReplyItemVO>> items = itemsByReplyIds(List.of(id));
        return QuickReplyVO.of(reply, items.getOrDefault(id, List.of()));
    }

    @Transactional
    public QuickReplyVO create(Long tenantId, QuickReplyRequest req) {
        QuickReply reply = new QuickReply();
        reply.setTenantId(tenantId);
        applyHeader(reply, tenantId, req);
        reply.setUseCount(0);
        replyMapper.insert(reply);
        saveItems(tenantId, reply.getId(), req.items());
        return detail(tenantId, reply.getId());
    }

    @Transactional
    public QuickReplyVO update(Long tenantId, Long id, QuickReplyRequest req) {
        QuickReply reply = requireReply(tenantId, id);
        applyHeader(reply, tenantId, req);
        replyMapper.updateById(reply);
        itemMapper.delete(new LambdaQueryWrapper<QuickReplyItem>().eq(QuickReplyItem::getReplyId, id));
        saveItems(tenantId, id, req.items());
        return detail(tenantId, id);
    }

    public void delete(Long tenantId, Long id) {
        requireReply(tenantId, id);
        replyMapper.deleteById(id);
    }

    public QuickReplyVO recordUse(Long tenantId, Long id) {
        requireReply(tenantId, id);
        replyMapper.update(null, new LambdaUpdateWrapper<QuickReply>()
            .eq(QuickReply::getId, id)
            .setSql("use_count = use_count + 1"));
        return detail(tenantId, id);
    }

    private void applyHeader(QuickReply reply, Long tenantId, QuickReplyRequest req) {
        if (req.groupId() == null) {
            throw new BizException(40000, "必须归属一个快捷回复分组");
        }
        requireGroup(tenantId, req.groupId());
        reply.setGroupId(req.groupId());
        reply.setTitle(req.title().trim());
        reply.setShortcut(StringUtils.hasText(req.shortcut()) ? req.shortcut().trim() : null);
        reply.setSort(req.sort() == null ? 0 : req.sort());
    }

    private void saveItems(Long tenantId, Long replyId, List<QuickReplyItemRequest> items) {
        int index = 0;
        for (QuickReplyItemRequest req : items) {
            QuickReplyItem item = new QuickReplyItem();
            item.setTenantId(tenantId);
            item.setReplyId(replyId);
            int type = req.type() == null ? 1 : req.type();
            item.setType(type);
            item.setSort(req.sort() == null ? index : req.sort());
            switch (type) {
                case 2 -> {
                    if (req.materialId() != null) {
                        Material material = materialService.requireOwned(tenantId, req.materialId());
                        item.setMaterialId(material.getId());
                        item.setMediaUrl(material.getUrl());
                    } else if (StringUtils.hasText(req.mediaUrl())) {
                        item.setMediaUrl(req.mediaUrl().trim());
                    } else {
                        throw new BizException(40000, "图片组件缺少素材");
                    }
                }
                case 3 -> {
                    if (!StringUtils.hasText(req.cardName())) {
                        throw new BizException(40000, "名片组件缺少名称");
                    }
                    item.setCardName(req.cardName().trim());
                    item.setCardPhone(StringUtils.hasText(req.cardPhone()) ? req.cardPhone().trim() : null);
                }
                default -> {
                    if (!StringUtils.hasText(req.content())) {
                        throw new BizException(40000, "文字组件内容为空");
                    }
                    item.setContent(req.content());
                }
            }
            itemMapper.insert(item);
            index++;
        }
    }

    private Map<Long, List<QuickReplyItemVO>> itemsByReplyIds(List<Long> replyIds) {
        if (replyIds.isEmpty()) {
            return Map.of();
        }
        List<QuickReplyItem> items = itemMapper.selectList(new LambdaQueryWrapper<QuickReplyItem>()
            .in(QuickReplyItem::getReplyId, replyIds)
            .orderByAsc(QuickReplyItem::getSort)
            .orderByAsc(QuickReplyItem::getId));
        Map<Long, List<QuickReplyItemVO>> map = new HashMap<>();
        for (QuickReplyItem item : items) {
            map.computeIfAbsent(item.getReplyId(), k -> new ArrayList<>()).add(QuickReplyItemVO.of(item));
        }
        return map;
    }

    private QuickReplyGroup requireGroup(Long tenantId, Long id) {
        QuickReplyGroup group = groupMapper.selectById(id);
        if (group == null || !Objects.equals(group.getTenantId(), tenantId)) {
            throw new BizException(40404, "快捷回复分组不存在");
        }
        return group;
    }

    private QuickReply requireReply(Long tenantId, Long id) {
        QuickReply reply = replyMapper.selectById(id);
        if (reply == null || !Objects.equals(reply.getTenantId(), tenantId)) {
            throw new BizException(40404, "快捷回复不存在");
        }
        return reply;
    }

    private boolean existsGroupName(Long tenantId, String name, Long excludeId) {
        return groupMapper.exists(new LambdaQueryWrapper<QuickReplyGroup>()
            .eq(QuickReplyGroup::getTenantId, tenantId)
            .eq(QuickReplyGroup::getName, name.trim())
            .ne(excludeId != null, QuickReplyGroup::getId, excludeId));
    }
}
