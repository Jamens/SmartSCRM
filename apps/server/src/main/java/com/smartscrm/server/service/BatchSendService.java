package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.entity.BatchSendDetail;
import com.smartscrm.server.entity.BatchSendTask;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.BatchSendDetailMapper;
import com.smartscrm.server.mapper.BatchSendTaskMapper;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.service.batch.BatchExpansion;
import com.smartscrm.server.service.batch.BatchJson;
import com.smartscrm.server.service.batch.BatchRender;
import com.smartscrm.server.service.batch.BatchRules;
import com.smartscrm.server.web.dto.BatchPreviewDTO;
import com.smartscrm.server.web.dto.BatchRecipientDTO;
import com.smartscrm.server.web.dto.BatchTaskCreateDTO;
import com.smartscrm.server.web.vo.BatchCreateVO;
import com.smartscrm.server.web.vo.BatchDetailVO;
import com.smartscrm.server.web.vo.BatchPreviewVO;
import com.smartscrm.server.web.vo.BatchRejectedVO;
import com.smartscrm.server.web.vo.BatchTaskVO;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BatchSendService {

    /** 预览只渲染前 5 个收件人：向导里要看的是"变量填得对不对"，不是"能不能刷屏"。 */
    private static final int PREVIEW_MAX_RECIPIENTS = 5;
    private static final int INSERT_CHUNK = 500;

    private final BatchSendTaskMapper taskMapper;
    private final BatchSendDetailMapper detailMapper;
    private final PlatformAccountMapper accountMapper;
    private final ChatConversationMapper conversationMapper;
    private final CustomerMapper customerMapper;

    public BatchSendService(BatchSendTaskMapper taskMapper, BatchSendDetailMapper detailMapper,
                            PlatformAccountMapper accountMapper, ChatConversationMapper conversationMapper,
                            CustomerMapper customerMapper) {
        this.taskMapper = taskMapper;
        this.detailMapper = detailMapper;
        this.accountMapper = accountMapper;
        this.conversationMapper = conversationMapper;
        this.customerMapper = customerMapper;
    }

    @Transactional
    public BatchCreateVO create(long tenantId, BatchTaskCreateDTO dto) {
        List<BatchRecipientDTO> recipients = dedupe(dto.getConversations());
        int expandedTotal = recipients.size() * dto.getContents().size();
        List<String> v = new ArrayList<>(BatchRules.violations(dto.getPlatform(), recipients.size(),
                dto.getContents(), expandedTotal));
        v.addAll(BatchRules.intervalViolations(dto.getMsgIntervalMin(), dto.getMsgIntervalMax(),
                dto.getChatIntervalMin(), dto.getChatIntervalMax(), Boolean.TRUE.equals(dto.getDryRun())));
        if (dto.getAccountIds() == null || dto.getAccountIds().isEmpty()) {
            // spec §3.2 的第一句「accountIds 非空」归任务头，不进 BatchRules（它的签名只管任务体）。
            // 必须打在 requireAccountsBound 之前：空表会让那条 IN 塌成 `IN ()`，回 500 而不是 40013。
            v.add("账号不能为空");
        }
        if (!v.isEmpty()) {
            throw new BizException(40013, String.join("；", v));
        }
        requireAccountsBound(tenantId, dto.getAccountIds());

        Map<String, ChatConversation> convIndex = loadConversations(tenantId, recipients);
        Set<Long> chosen = new HashSet<>(dto.getAccountIds());
        List<BatchExpansion.Recipient> ok = new ArrayList<>();
        List<BatchRejectedVO> rejected = new ArrayList<>();
        for (BatchRecipientDTO r : recipients) {
            ChatConversation c = convIndex.get(convKey(r.getAccountId(), r.getChatKey()));
            if (!chosen.contains(r.getAccountId())) {
                // spec §3.2 的后半句「account_id ∈ accountIds」。不拦在这里的代价是静默半跑：
                // Task 11 的 buildQueues 按 accountIds 分组，不属于任何一组的明细行永远留在 pending，
                // openCount 也就永远不归零、任务永远到不了 done。
                rejected.add(new BatchRejectedVO(r.getChatKey(), r.getAccountId(), "这条会话所属的账号不在本次勾选的账号里"));
            } else if (c == null) {
                rejected.add(new BatchRejectedVO(r.getChatKey(), r.getAccountId(), "当前账号下没有这条会话的采集记录"));
            } else {
                ok.add(new BatchExpansion.Recipient(r.getAccountId(), r.getChatKey(), c.getCustomerId()));
            }
        }
        if (ok.isEmpty()) {
            throw new BizException(40012, "所有收件人都不可寻址");
        }
        Map<String, BatchRender.Fields> fieldsByKey = resolveFields(tenantId, convIndex, ok);
        List<BatchExpansion.ExpandedRow> rows = BatchExpansion.expand(ok, dto.getContents(),
                r -> fieldsByKey.getOrDefault(convKey(r.accountId(), r.chatKey()), BatchRender.EMPTY_FIELDS));

        // 先落任务头拿自增 id，再分块落明细，最后用 countByTask 自检（spec §3.5）。
        BatchSendTask task = newTask(tenantId, dto, rows.size());
        taskMapper.insert(task);
        List<BatchSendDetail> details = toDetails(tenantId, task.getId(), rows);
        for (int i = 0; i < details.size(); i += INSERT_CHUNK) {
            detailMapper.insertBatch(details.subList(i, Math.min(i + INSERT_CHUNK, details.size())));
        }
        long counted = detailMapper.countByTask(tenantId, task.getId()).stream()
                .mapToLong(m -> ((Number) m.get("c")).longValue()).sum();
        if (counted != rows.size()) {
            // @Transactional 会回滚，所以这条抛出去就是"一行都不留"，不是"留一半"。
            throw new BizException(40014, "展开自检失败：期望 " + rows.size() + " 行，实落 " + counted + " 行");
        }
        return new BatchCreateVO(task.getId(), rejected, rows.size());
    }

    /**
     * 预览只走渲染器：不查库、不校验会话存在性（spec §4「渲染规则只有后端一份」）。
     * 变量取值与创建侧同一条兜底链（R9），但预览手上没有客户档，`{客户名}` 落到 chatKey 本地段、
     * `{号码}` 落到空串——这一格要给的是"变量填得对不对"的形状，不是真实收件人的号码。
     */
    public BatchPreviewVO preview(BatchPreviewDTO dto) {
        List<BatchRecipientDTO> recipients = dto.getConversations();
        List<String> contents = dto.getContents();
        int limit = Math.min(recipients.size(), PREVIEW_MAX_RECIPIENTS);
        List<BatchPreviewVO.Sample> rows = new ArrayList<>();
        for (int i = 0; i < limit; i++) {
            BatchRecipientDTO r = recipients.get(i);
            BatchRender.Fields fields = new BatchRender.Fields(null, localPart(r.getChatKey()), null);
            for (int ci = 0; ci < contents.size(); ci++) {
                rows.add(new BatchPreviewVO.Sample(r.getChatKey(), ci,
                        BatchRender.render(contents.get(ci), fields)));
            }
        }
        return new BatchPreviewVO(rows, recipients.size() > PREVIEW_MAX_RECIPIENTS);
    }

    public PageResult<BatchTaskVO> pageTasks(long tenantId, String status, int page, int size) {
        LambdaQueryWrapper<BatchSendTask> wrapper = new LambdaQueryWrapper<BatchSendTask>()
                .eq(BatchSendTask::getTenantId, tenantId)
                .eq(status != null && !status.isBlank(), BatchSendTask::getStatus, status)
                .orderByDesc(BatchSendTask::getId);
        Page<BatchSendTask> result = taskMapper.selectPage(new Page<>(page, size), wrapper);
        List<BatchTaskVO> records = result.getRecords().stream().map(this::toVO).toList();
        return PageResult.of(records, result.getTotal(), result.getCurrent(), result.getSize());
    }

    public BatchTaskVO task(long tenantId, long id) {
        return toVO(requireOwned(tenantId, id));
    }

    public PageResult<BatchDetailVO> pageDetails(long tenantId, long taskId, String sendStatus,
                                                 String recallStatus, int page, int size) {
        LambdaQueryWrapper<BatchSendDetail> wrapper = new LambdaQueryWrapper<BatchSendDetail>()
                .eq(BatchSendDetail::getTenantId, tenantId)
                .eq(BatchSendDetail::getTaskId, taskId)
                .eq(sendStatus != null && !sendStatus.isBlank(), BatchSendDetail::getSendStatus, sendStatus)
                .eq(recallStatus != null && !recallStatus.isBlank(), BatchSendDetail::getRecallStatus, recallStatus)
                .orderByAsc(BatchSendDetail::getSeq);
        Page<BatchSendDetail> result = detailMapper.selectPage(new Page<>(page, size), wrapper);
        List<BatchDetailVO> records = result.getRecords().stream().map(this::toVO).toList();
        return PageResult.of(records, result.getTotal(), result.getCurrent(), result.getSize());
    }

    /** 租户闸：Task 5 的十条运行端点全部复用它。 */
    public BatchSendTask requireOwned(long tenantId, long taskId) {
        BatchSendTask task = taskMapper.selectOne(new LambdaQueryWrapper<BatchSendTask>()
                .eq(BatchSendTask::getTenantId, tenantId)
                .eq(BatchSendTask::getId, taskId));
        if (task == null) {
            throw new BizException(40404, "任务不存在");
        }
        return task;
    }

    /** 两个 JSON 列 + 心跳：实体存串，VO 给结构。时间原样透传 LocalDateTime（Task 4 Step 2 的口径）。 */
    private BatchTaskVO toVO(BatchSendTask t) {
        return new BatchTaskVO(t.getId(), t.getName(), t.getPlatform(), Boolean.TRUE.equals(t.getDryRun()),
                t.getStatus(), BatchJson.readLongs(t.getAccountIds()), BatchJson.readStrings(t.getContents()),
                t.getMsgIntervalMin(), t.getMsgIntervalMax(), t.getChatIntervalMin(), t.getChatIntervalMax(),
                t.getTotalCount(), t.getSentCount(), t.getFailCount(), t.getHeartbeatAt(), t.getCreatedAt());
    }

    private BatchDetailVO toVO(BatchSendDetail d) {
        return new BatchDetailVO(d.getId(), d.getTaskId(), d.getSeq(), d.getAccountId(), d.getChatKey(),
                d.getCustomerId(), d.getContentIndex(), d.getBody(), d.getLocalId(), d.getSendStatus(),
                d.getErrorCode(), d.getErrorDetail(), d.getMsgKey(), d.getRecallStatus(), d.getRecallDetail(),
                d.getSentAt());
    }

    /** 保序去重：同一条会话在选人面板里可能被勾两次。key = accountId + ":" + chatKey。 */
    private List<BatchRecipientDTO> dedupe(List<BatchRecipientDTO> in) {
        Map<String, BatchRecipientDTO> m = new LinkedHashMap<>();
        for (BatchRecipientDTO r : in) {
            m.putIfAbsent(convKey(r.getAccountId(), r.getChatKey()), r);
        }
        return new ArrayList<>(m.values());
    }

    private String convKey(Long accountId, String chatKey) {
        return accountId + ":" + chatKey;
    }

    /** 缺任何一个 id、或它的 viewId 是空，都算账号不可用 —— 点名是哪几个。 */
    private void requireAccountsBound(long tenantId, List<Long> accountIds) {
        List<PlatformAccount> found = accountMapper.selectList(new LambdaQueryWrapper<PlatformAccount>()
                .eq(PlatformAccount::getTenantId, tenantId)
                .in(PlatformAccount::getId, accountIds));
        Map<Long, PlatformAccount> byId = new HashMap<>();
        found.forEach(a -> byId.put(a.getId(), a));
        List<String> bad = new ArrayList<>();
        for (Long id : accountIds) {
            PlatformAccount a = byId.get(id);
            if (a == null || a.getViewId() == null || a.getViewId().isBlank()) {
                bad.add(String.valueOf(id));
            }
        }
        if (!bad.isEmpty()) {
            throw new BizException(40011, "账号不可用: " + String.join(",", bad));
        }
    }

    /** 一次性把这些账号涉及会话捞进内存表，避免 N 个收件人打 N 次库。 */
    private Map<String, ChatConversation> loadConversations(long tenantId, List<BatchRecipientDTO> recipients) {
        Set<Long> accounts = new HashSet<>();
        Set<String> keys = new HashSet<>();
        recipients.forEach(r -> {
            accounts.add(r.getAccountId());
            keys.add(r.getChatKey());
        });
        List<ChatConversation> found = conversationMapper.selectList(new LambdaQueryWrapper<ChatConversation>()
                .eq(ChatConversation::getTenantId, tenantId)
                .in(ChatConversation::getAccountId, accounts)
                .in(ChatConversation::getChatKey, keys));
        Map<String, ChatConversation> index = new HashMap<>();
        found.forEach(c -> index.put(convKey(c.getAccountId(), c.getChatKey()), c));
        return index;
    }

    /**
     * 两个变量的取值来源（R9）：有客户用客户档案；没客户落到会话标题与 chat_key 本地段。
     * 一次性批量查客户，绝不在循环里 selectById —— 1000 个收件人会打出 1000 条 SQL。
     */
    private Map<String, BatchRender.Fields> resolveFields(long tenantId,
                                                          Map<String, ChatConversation> convIndex,
                                                          List<BatchExpansion.Recipient> ok) {
        Set<Long> customerIds = new HashSet<>();
        ok.forEach(r -> {
            if (r.customerId() != null) {
                customerIds.add(r.customerId());
            }
        });
        Map<Long, Customer> customers = new HashMap<>();
        if (!customerIds.isEmpty()) {
            // 租户闸：错链的那一行会把别人的昵称/号码渲染进 body，而 body 是要发出去的。
            customerMapper.selectList(new LambdaQueryWrapper<Customer>()
                            .eq(Customer::getTenantId, tenantId)
                            .in(Customer::getId, customerIds))
                    .forEach(c -> customers.put(c.getId(), c));
        }
        Map<String, BatchRender.Fields> out = new HashMap<>();
        for (BatchExpansion.Recipient r : ok) {
            ChatConversation c = convIndex.get(convKey(r.accountId(), r.chatKey()));
            Customer cu = r.customerId() == null ? null : customers.get(r.customerId());
            String nickname = cu != null && cu.getNickname() != null ? cu.getNickname() : (c == null ? null : c.getTitle());
            String openId = cu != null && cu.getOpenId() != null ? cu.getOpenId() : localPart(r.chatKey());
            out.put(convKey(r.accountId(), r.chatKey()),
                    new BatchRender.Fields(nickname, openId, cu == null ? null : cu.getPhone()));
        }
        return out;
    }

    /** `8613800000000@c.us` → `8613800000000`；群聊键 `1234-5678@c.us` 保持整串本地段。 */
    private String localPart(String chatKey) {
        int at = chatKey.indexOf('@');
        return at < 0 ? chatKey : chatKey.substring(0, at);
    }

    private BatchSendTask newTask(long tenantId, BatchTaskCreateDTO dto, int totalCount) {
        BatchSendTask t = new BatchSendTask();
        t.setTenantId(tenantId);
        t.setName(dto.getName().trim());
        t.setPlatform(dto.getPlatform());
        t.setDryRun(dto.getDryRun());
        t.setStatus("pending");
        t.setAccountIds(BatchJson.encodeLongs(dto.getAccountIds()));
        t.setContents(BatchJson.encodeStrings(dto.getContents()));
        t.setMsgIntervalMin(dto.getMsgIntervalMin());
        t.setMsgIntervalMax(dto.getMsgIntervalMax());
        t.setChatIntervalMin(dto.getChatIntervalMin());
        t.setChatIntervalMax(dto.getChatIntervalMax());
        t.setTotalCount(totalCount);
        t.setSentCount(0);
        t.setFailCount(0);
        return t;
    }

    private List<BatchSendDetail> toDetails(long tenantId, long taskId, List<BatchExpansion.ExpandedRow> rows) {
        List<BatchSendDetail> out = new ArrayList<>(rows.size());
        for (BatchExpansion.ExpandedRow r : rows) {
            BatchSendDetail d = new BatchSendDetail();
            d.setTenantId(tenantId);
            d.setTaskId(taskId);
            d.setSeq(r.seq());
            d.setAccountId(r.accountId());
            d.setChatKey(r.chatKey());
            d.setCustomerId(r.customerId());
            d.setContentIndex(r.contentIndex());
            d.setBody(r.body());
            d.setSendStatus("pending");
            d.setRecallStatus("none");
            out.add(d);
        }
        return out;
    }
}
