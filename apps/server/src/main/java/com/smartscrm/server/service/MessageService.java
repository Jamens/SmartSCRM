package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.ChatMessage;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.service.msg.ChatKeys;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.service.msg.StatusLadder;
import com.smartscrm.server.web.dto.MessageBatchDTO;
import com.smartscrm.server.web.dto.MessageItemDTO;
import com.smartscrm.server.web.dto.MessageStatusDTO;
import com.smartscrm.server.web.dto.StatusUpdateDTO;
import com.smartscrm.server.web.vo.BatchAcceptVO;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MessageService {

    private static final Set<String> DIRECTIONS = Set.of("in", "out");
    private static final Set<String> SOURCES =
        Set.of("live", "backfill", "app_send", "native_send");
    /** 通知类系统行不进聊天记录，它们既不可回复也没有正文。 */
    private static final Set<String> SKIPPED_TYPES = Set.of("gp2", "e2e_notification", "revoked");
    /** media_type 是 VARCHAR(16)，取值就是列注释那九个；清单外的一律降级，不让原样字符串碰 SQL。 */
    private static final Set<String> MEDIA_TYPES = Set.of(
        "text", "image", "audio", "video", "document", "sticker", "contact", "location", "unknown");

    private final ChatMessageMapper messageMapper;
    private final ChatConversationMapper conversationMapper;
    private final CustomerMapper customerMapper;
    private final PlatformAccountMapper accountMapper;

    public MessageService(ChatMessageMapper messageMapper, ChatConversationMapper conversationMapper,
                          CustomerMapper customerMapper, PlatformAccountMapper accountMapper) {
        this.messageMapper = messageMapper;
        this.conversationMapper = conversationMapper;
        this.customerMapper = customerMapper;
        this.accountMapper = accountMapper;
    }

    public record ResolvedAccount(Long accountId, String platform, Integer platformType) {}

    /** 账号必须属于本租户，且平台在 P6 支持面内；否则整批拒绝。 */
    public ResolvedAccount resolveAccount(Long tenantId, Long accountId) {
        PlatformAccount account = accountMapper.selectById(accountId);
        if (account == null || !tenantId.equals(account.getTenantId())) {
            throw new BizException(40404, "账号不存在: " + accountId);
        }
        String platform = ChatKeys.platformOfAccountType(account.getPlatformType());
        if (platform == null) {
            throw new BizException(40000, "该平台暂不支持消息采集: " + account.getPlatformType());
        }
        return new ResolvedAccount(accountId, platform, account.getPlatformType());
    }

    @Transactional
    public BatchAcceptVO accept(Long tenantId, MessageBatchDTO dto) {
        ResolvedAccount account = resolveAccount(tenantId, dto.accountId());
        LocalDateTime receivedAt = LocalDateTime.now(MsgTimes.CHAT_ZONE).truncatedTo(ChronoUnit.MILLIS);
        List<MessageItemDTO> items = dto.messages();
        List<ChatMessage> rows = new ArrayList<>(items.size());
        Set<String> seenInBatch = new HashSet<>();
        List<String> reasons = new ArrayList<>();
        int rejected = 0;
        // 一批里同一会话的归属只算一次：绝大多数批次只有两三个 chatKey，
        // 而手机号兜底那条分支是"读全租户客户再比"，每条都跑一遍就是把补底变成扫库。
        // containsKey 那一步不能省成 computeIfAbsent：匹配不到客户时值是 null，而
        // computeIfAbsent 把"映射到 null"当成"没有映射"，未命中的会话每条还是会重算一次。
        Map<String, Long> customerByChat = new HashMap<>();

        for (MessageItemDTO item : items) {
            if (!DIRECTIONS.contains(item.direction()) || !SOURCES.contains(item.source())) {
                rejected++;
                reasons.add(item.msgKey() + ": direction/source 非法");
                continue;
            }
            if (SKIPPED_TYPES.contains(item.mediaType())) {
                rejected++;
                continue;
            }
            if (!ChatKeys.matchesPlatform(account.platform(), item.chatKey())) {
                rejected++;
                reasons.add(item.msgKey() + ": chat_key 与平台不匹配");
                continue;
            }
            String dedupeKey = item.chatKey() + "|" + item.msgKey();
            if (!seenInBatch.add(dedupeKey)) {
                rejected++;
                reasons.add(item.msgKey() + ": 同批重复");
                continue;
            }
            ChatMessage row = new ChatMessage();
            row.setTenantId(tenantId);
            row.setAccountId(account.accountId());
            row.setPlatform(account.platform());
            row.setChatKey(item.chatKey());
            row.setMsgKey(item.msgKey());
            row.setDirection(item.direction());
            String ck = item.chatKey();
            if (!customerByChat.containsKey(ck)) {
                customerByChat.put(ck, matchCustomer(tenantId, account.platformType(), ck));
            }
            row.setCustomerId(customerByChat.get(ck));
            row.setSenderKey(item.senderKey());
            row.setSenderName(item.senderName());
            row.setBody(item.body() == null || item.body().isBlank() ? null : item.body());
            row.setMediaType(normalizeMediaType(item.mediaType()));
            row.setMediaSummary(item.mediaSummary());
            row.setMsgTime(MsgTimes.toDbTime(item.msgTimeEpochSec(), receivedAt));
            row.setStatus(normalizeStatus(item.status(), item.direction()));
            row.setSource(item.source());
            row.setSendLocalId(item.sendLocalId());
            rows.add(row);
        }

        int accepted = 0;
        int duplicated = 0;
        for (ChatMessage row : rows) {
            // "是否新行"交给 SQL 的 affected rows：1 = 插入，0 = 被 uk_msg 忽略。
            // 会话头只由新行推动，重复行不能再加一次未读。
            // 2026-09-20 一次性 @SpringBootTest 探针实测（跑完已删）：单行新增 1、单行重复 0、
            // 两行里一条重复 1、两行全重复 0 —— 逐行调用与整批调用都成立，
            // 所以将来若改回"整批一次 insert"，duplicated 只能按 `提交条数 - affected rows` 算。
            if (messageMapper.insertIgnoreBatch(List.of(row)) != 1) {
                duplicated++;
                continue;
            }
            accepted++;
            ChatConversation head = new ChatConversation();
            head.setTenantId(tenantId);
            head.setAccountId(row.getAccountId());
            head.setPlatform(row.getPlatform());
            head.setChatKey(row.getChatKey());
            head.setTitle(titleOf(items, row.getChatKey()));
            head.setIsGroup(ChatKeys.isGroup(row.getChatKey()) ? 1 : 0);
            head.setCustomerId(row.getCustomerId());
            head.setLastMsgTime(row.getMsgTime());
            head.setLastMsgBody(row.getBody() != null ? row.getBody() : row.getMediaSummary());
            head.setUnreadDelta(unreadDelta(row, dto.activeChatKey()));
            conversationMapper.upsertHead(head);
        }
        return new BatchAcceptVO(accepted, duplicated, rejected, reasons.stream().limit(20).toList());
    }

    /**
     * 状态推进不查当前行：阶梯守卫整条放在 SQL 里（advanceStatus），affected rows 就是
     * 真正推进的条数。被挡住的乱序 ack 计不进 updated，也不报错——它是常态。
     *
     * 这里刻意不做入库那条 `chat_key 与平台不匹配` 的校验：本方法的 UPDATE 已经把
     * `platform + account_id + chat_key + msg_key` 四列一起钉在 WHERE 上，一个错配的
     * accountId 只会让 WHERE 一行也匹配不上（`updated:0`），写不进别人的行；
     * 而批量入库那条是 INSERT，错配会真的造出一行脏数据，所以它必须先拒。
     * 两处的不对称是后果决定的，不是漏了。
     */
    @Transactional
    public int applyStatus(Long tenantId, MessageStatusDTO dto) {
        ResolvedAccount account = resolveAccount(tenantId, dto.accountId());
        int updated = 0;
        for (StatusUpdateDTO u : dto.updates()) {
            String to = u.status();
            if (!StatusLadder.isAllowedTarget(to)) {
                throw new BizException(40000, "status 只能是 pending|sent|delivered|read|failed");
            }
            updated += messageMapper.advanceStatus(tenantId, account.platform(), account.accountId(),
                dto.chatKey(), u.msgKey(), to);
        }
        return updated;
    }

    /** 一个批次可能跨多个会话，所以标题按 chatKey 取，不能取"批内第一个非空"。 */
    private String titleOf(List<MessageItemDTO> items, String chatKey) {
        return items.stream()
            .filter(i -> chatKey.equals(i.chatKey()))
            .map(MessageItemDTO::chatTitle)
            .filter(t -> t != null && !t.isBlank())
            .findFirst()
            .orElse(null);
    }

    /** 只有"别人发的 + 单聊 + 不是当前正打开的会话 + 实时来源"才 +1：补采历史不制造未读。 */
    private int unreadDelta(ChatMessage row, String activeChatKey) {
        boolean inbound = "in".equals(row.getDirection());
        boolean oneToOne = !ChatKeys.isGroup(row.getChatKey());
        boolean notActive = !row.getChatKey().equals(activeChatKey == null ? "" : activeChatKey);
        return inbound && oneToOne && notActive && "live".equals(row.getSource()) ? 1 : 0;
    }

    /** in 一律 received；out 只接受阶梯上的值，其它一律退回 pending。 */
    private String normalizeStatus(String status, String direction) {
        if ("in".equals(direction)) {
            return "received";
        }
        if ("failed".equals(status) || StatusLadder.isLadder(status)) {
            return status;
        }
        return "pending";
    }

    /**
     * 媒体类型是展示元数据，不是身份：认不出来的值降级成 unknown，让这条消息照样入库
     * （正文可能仍然有价值），而不是整行丢掉。但不能原样透传 —— 该列只有 16 个字符，
     * 而 INSERT IGNORE 会把超长值静默截成前 16 个字符：既没有报错也没有日志，
     * 事后从库里读出一个谁也对不上的半截类型名。降级至少是可解释的。
     */
    private String normalizeMediaType(String raw) {
        if (raw == null || raw.isBlank()) {
            return "text";
        }
        return MEDIA_TYPES.contains(raw) ? raw : "unknown";
    }

    /** open_id 与 chat_key 同形（种子里就是 8613800001001@c.us），手机号只做兜底。 */
    private Long matchCustomer(Long tenantId, Integer platformType, String chatKey) {
        Customer byOpenId = customerMapper.selectOne(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId)
            .eq(Customer::getPlatformType, platformType)
            .eq(Customer::getOpenId, chatKey)
            .last("LIMIT 1"));
        if (byOpenId != null) {
            return byOpenId.getId();
        }
        String phone = ChatKeys.peerPhoneOf(chatKey);
        if (phone == null) {
            return null;
        }
        return customerMapper.selectList(new LambdaQueryWrapper<Customer>()
                .eq(Customer::getTenantId, tenantId)
                .eq(Customer::getPlatformType, platformType))
            .stream()
            .filter(c -> phone.equals(ChatKeys.normalizePhone(c.getPhone())))
            .map(Customer::getId)
            .findFirst()
            .orElse(null);
    }
}
