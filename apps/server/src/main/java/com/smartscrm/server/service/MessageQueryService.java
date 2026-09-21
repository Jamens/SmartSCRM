package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.ChatMessage;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.service.msg.Cursors;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.service.msg.SearchPattern;
import com.smartscrm.server.web.vo.ConversationPageVO;
import com.smartscrm.server.web.vo.ConversationVO;
import com.smartscrm.server.web.vo.DayCountVO;
import com.smartscrm.server.web.vo.MessagePageVO;
import com.smartscrm.server.web.vo.MessageSearchVO;
import com.smartscrm.server.web.vo.MessageStatsVO;
import com.smartscrm.server.web.vo.MessageVO;
import com.smartscrm.server.web.vo.SearchHitVO;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MessageQueryService {

    private static final int DEFAULT_SIZE = 30;
    private static final int MAX_SIZE = 200;
    private static final Set<String> SEARCH_DIRECTIONS = Set.of("in", "out");
    private static final Set<String> ALLOWED_PLATFORMS = Set.of("whatsapp", "telegram");

    private final ChatMessageMapper messageMapper;
    private final ChatConversationMapper conversationMapper;
    private final CustomerMapper customerMapper;
    private final MessageService messageService;

    public MessageQueryService(ChatMessageMapper messageMapper, ChatConversationMapper conversationMapper,
                               CustomerMapper customerMapper, MessageService messageService) {
        this.messageMapper = messageMapper;
        this.conversationMapper = conversationMapper;
        this.customerMapper = customerMapper;
        this.messageService = messageService;
    }

    // ============ 会话列表 ============

    public ConversationPageVO conversations(Long tenantId, Long accountId, String platform, String q,
                                           String cursor, Integer size) {
        int limit = sizeOf(size);
        requirePlatformAllowed(platform);
        LambdaQueryWrapper<ChatConversation> w = new LambdaQueryWrapper<ChatConversation>()
            .eq(ChatConversation::getTenantId, tenantId);
        if (accountId != null) {
            messageService.resolveAccount(tenantId, accountId);
            w.eq(ChatConversation::getAccountId, accountId);
        }
        if (platform != null && !platform.isBlank()) {
            w.eq(ChatConversation::getPlatform, platform);
        }
        // q 命中三种可能：标题、chat_key、已绑客户名。像"搜联系人"那样用一个词就够。
        String like = SearchPattern.like(q);
        if (like == null && q != null && !q.isBlank()) {
            return new ConversationPageVO(List.of(), null, false);
        }
        if (like != null) {
            List<Long> customerIds = customerMapper.selectList(new LambdaQueryWrapper<Customer>()
                    .eq(Customer::getTenantId, tenantId)
                    .apply("nickname LIKE {0}", like))
                .stream().map(Customer::getId).toList();
            w.and(x -> {
                x.apply("title LIKE {0}", like).or().apply("chat_key LIKE {0}", like);
                if (!customerIds.isEmpty()) {
                    x.or().in(ChatConversation::getCustomerId, customerIds);
                }
            });
        }
        // last_msg_time 可空（V8__chat_history.sql:21）：会话头只由带消息的那次 upsert 推动，
        // 这一列为空即"这条会话当前没有可展示的最近消息"，它不进分页序列。
        // 这条同时让 (last_msg_time, id) 的排序成为全序——否则 MySQL 把 NULL 排在 DESC 末尾，
        // 而游标的 lt 谓词又永远匹配不上 NULL，游标翻页会静默漏行（一页取全看得见、逐页翻到底翻不到），
        // 末尾页还可能把 NULL 送进 Cursors.encode。排除在序列之外才是修复：
        // 只守住 encode 那一处，留下的是"永远看不见的那一半"。
        w.isNotNull(ChatConversation::getLastMsgTime);
        Cursors.Pos pos = Cursors.decode(cursor);
        if (pos != null) {
            w.and(x -> x.lt(ChatConversation::getLastMsgTime, pos.time())
                .or(y -> y.eq(ChatConversation::getLastMsgTime, pos.time()).lt(ChatConversation::getId, pos.id())));
        }
        w.orderByDesc(ChatConversation::getLastMsgTime).orderByDesc(ChatConversation::getId);
        List<ChatConversation> rows = conversationMapper.selectList(w.last("LIMIT " + (limit + 1)));
        boolean hasMore = rows.size() > limit;
        List<ChatConversation> page = hasMore ? rows.subList(0, limit) : rows;
        String next = page.isEmpty() || !hasMore
            ? null
            : Cursors.encode(page.get(page.size() - 1).getLastMsgTime(), page.get(page.size() - 1).getId());
        return new ConversationPageVO(page.stream().map(ConversationVO::of).toList(), next, hasMore);
    }

    // ============ 会话内消息 ============

    public MessagePageVO messages(Long tenantId, Long accountId, String chatKey, String before, Long around,
                                 Integer size) {
        if (chatKey == null || chatKey.isBlank()) {
            throw new BizException(40000, "chatKey 不能为空");
        }
        MessageService.ResolvedAccount account = messageService.resolveAccount(tenantId, accountId);
        int limit = sizeOf(size);
        LambdaQueryWrapper<ChatMessage> w = new LambdaQueryWrapper<ChatMessage>()
            .eq(ChatMessage::getTenantId, tenantId)
            .eq(ChatMessage::getAccountId, account.accountId())
            .eq(ChatMessage::getPlatform, account.platform())
            .eq(ChatMessage::getChatKey, chatKey);
        Cursors.Pos decoded = Cursors.decode(before);
        // `around` 覆盖 `before`：两者同时出现只可能是"从搜索结果跳进会话又往上翻了"的中间态，
        // 以锚点为准更安全。pos 必须是 final：下面那个 wrapper 的 lambda 要捕获它，
        // 直接给 `pos` 二次赋值会连编译都过不去（effective finality）。
        final Cursors.Pos pos = around != null ? aroundPos(tenantId, account, chatKey, around) : decoded;
        if (pos != null) {
            w.and(x -> x.lt(ChatMessage::getMsgTime, pos.time())
                .or(y -> y.eq(ChatMessage::getMsgTime, pos.time()).lt(ChatMessage::getId, pos.id())));
        }
        // 倒序取"更早的一页"，正序返回：记录页是往上翻页的，前端拿到就能直接接在列表头上。
        w.orderByDesc(ChatMessage::getMsgTime).orderByDesc(ChatMessage::getId)
            .last("LIMIT " + (limit + 1));
        List<ChatMessage> rows = messageMapper.selectList(w);
        boolean hasMore = rows.size() > limit;
        List<ChatMessage> page = new ArrayList<>(hasMore ? rows.subList(0, limit) : rows);
        String next = hasMore && !page.isEmpty()
            ? Cursors.encode(page.get(page.size() - 1).getMsgTime(), page.get(page.size() - 1).getId())
            : null;
        page.sort((a, b) -> a.getMsgTime().isEqual(b.getMsgTime())
            ? Long.compare(a.getId(), b.getId())
            : a.getMsgTime().compareTo(b.getMsgTime()));
        return new MessagePageVO(page.stream().map(MessageVO::of).toList(), next, hasMore);
    }

    /**
     * 把"定位到某条消息"翻译成窗口位置。为什么不发一个 `<epochMillis>:<id>` 让前端自己拼：
     * 那串毫秒是按 `MsgTimes.CHAT_ZONE`（写死的 Asia/Shanghai）解释的，而前端手上的 `msgTime`
     * 是墙钟串、经浏览器时区换算成 epoch——同机部署看不出来，测试机时区一换就偏几个小时。
     * 偏了的后果不是报错，是"点了搜索结果却翻到空白页"，最难查。行 id 是两端唯一共享的稳定键，
     * 所以窗口由后端算，前端只传 id。
     * <p>
     * `plusNanos(1ms)` 是因为下面的窗口条件是**严格早于**：不加这一个毫秒，锚点那条自己会被排除，
     * 而它正是要高亮的那一条。id 用 0（自增 id 恒 ≥ 1），所以同一毫秒内的兄弟行也都留在窗口里。
     */
    private Cursors.Pos aroundPos(Long tenantId, MessageService.ResolvedAccount account, String chatKey,
                                 Long around) {
        ChatMessage anchorRow = messageMapper.selectOne(new LambdaQueryWrapper<ChatMessage>()
            .eq(ChatMessage::getTenantId, tenantId)
            .eq(ChatMessage::getAccountId, account.accountId())
            .eq(ChatMessage::getPlatform, account.platform())
            .eq(ChatMessage::getChatKey, chatKey)
            .eq(ChatMessage::getId, around));
        if (anchorRow == null) {
            // 40404 而不是退回默认窗口：静默退回去会让前端把"锚定失败"当成"消息不存在"，
            // 而真实原因多半是 chatKey 与 accountId 传串了（跨账号搜索结果点了错误的锚点）。
            throw new BizException(40404, "around 指向的消息不在该会话内");
        }
        return new Cursors.Pos(anchorRow.getMsgTime().plusNanos(1_000_000L), 0L);
    }

    // ============ 全局搜索 ============

    public MessageSearchVO search(Long tenantId, String q, Long accountId, String platform, String direction,
                                 String from, String to, Long customerId, String cursor, Integer size) {
        requirePlatformAllowed(platform);
        String like = SearchPattern.like(q);
        if (like == null) {
            return new MessageSearchVO(List.of(), null, false);
        }
        if (direction != null && !direction.isBlank() && !SEARCH_DIRECTIONS.contains(direction)) {
            throw new BizException(40000, "direction 只能是 in 或 out");
        }
        int limit = sizeOf(size);
        LambdaQueryWrapper<ChatMessage> w = new LambdaQueryWrapper<ChatMessage>()
            .eq(ChatMessage::getTenantId, tenantId)
            .apply("body LIKE {0}", like)
            .isNotNull(ChatMessage::getBody);
        if (accountId != null) {
            MessageService.ResolvedAccount account = messageService.resolveAccount(tenantId, accountId);
            w.eq(ChatMessage::getAccountId, account.accountId());
        }
        if (platform != null && !platform.isBlank()) {
            w.eq(ChatMessage::getPlatform, platform);
        }
        if (direction != null && !direction.isBlank()) {
            w.eq(ChatMessage::getDirection, direction);
        }
        if (customerId != null) {
            w.eq(ChatMessage::getCustomerId, customerId);
        }
        LocalDateTime fromTime = parseDay(from, false);
        if (fromTime != null) {
            w.ge(ChatMessage::getMsgTime, fromTime);
        }
        LocalDateTime toTime = parseDay(to, true);
        if (toTime != null) {
            w.le(ChatMessage::getMsgTime, toTime);
        }
        Cursors.Pos pos = Cursors.decode(cursor);
        if (pos != null) {
            w.and(x -> x.lt(ChatMessage::getMsgTime, pos.time())
                .or(y -> y.eq(ChatMessage::getMsgTime, pos.time()).lt(ChatMessage::getId, pos.id())));
        }
        w.orderByDesc(ChatMessage::getMsgTime).orderByDesc(ChatMessage::getId)
            .last("LIMIT " + (limit + 1));
        List<ChatMessage> rows = messageMapper.selectList(w);
        boolean hasMore = rows.size() > limit;
        List<ChatMessage> page = hasMore ? rows.subList(0, limit) : rows;
        Map<String, ChatConversation> heads = headsOf(tenantId, page);
        List<SearchHitVO> hits = page.stream()
            .map(m -> {
                ChatConversation head = heads.get(m.getAccountId() + "|" + m.getChatKey());
                return new SearchHitVO(MessageVO.of(m), head == null ? null : head.getId(),
                    head == null ? null : head.getTitle());
            })
            .toList();
        String next = hasMore && !page.isEmpty()
            ? Cursors.encode(page.get(page.size() - 1).getMsgTime(), page.get(page.size() - 1).getId())
            : null;
        return new MessageSearchVO(hits, next, hasMore);
    }

    /** 一页命中的会话头一次取回，不在循环里查库。 */
    private Map<String, ChatConversation> headsOf(Long tenantId, List<ChatMessage> rows) {
        Set<Long> accounts = new HashSet<>();
        Set<String> keys = new HashSet<>();
        for (ChatMessage m : rows) {
            accounts.add(m.getAccountId());
            keys.add(m.getChatKey());
        }
        if (accounts.isEmpty()) {
            return Map.of();
        }
        Map<String, ChatConversation> out = new HashMap<>();
        conversationMapper.selectList(new LambdaQueryWrapper<ChatConversation>()
                .eq(ChatConversation::getTenantId, tenantId)
                .in(ChatConversation::getAccountId, accounts)
                .in(ChatConversation::getChatKey, keys))
            .forEach(c -> out.put(c.getAccountId() + "|" + c.getChatKey(), c));
        return out;
    }

    // ============ 统计 ============

    public MessageStatsVO stats(Long tenantId, Long accountId, Integer days) {
        MessageService.ResolvedAccount account = messageService.resolveAccount(tenantId, accountId);
        int window = days == null || days <= 0 ? 7 : Math.min(days, 90);
        // 时钟只读一次：窗口起点与逐序列的末日必须是同一个"今天"。分两次 now() 的话，
        // 跨零点的那对相邻调用会让 from 比序列首日早一天，total 就把序列里根本不显示的那一天
        // 算进来（total == Σ perDay 当场不成立），"days=7 与 days=30 的末 7 天相同"也在午夜附近失效。
        LocalDate today = LocalDate.now(MsgTimes.CHAT_ZONE);
        LocalDateTime from = today.minusDays(window - 1L).atStartOfDay();
        Map<String, Object> totals = messageMapper.statsTotals(tenantId, account.accountId(), from);
        Map<String, Map<String, Object>> perDay = new HashMap<>();
        for (Map<String, Object> row : messageMapper.statsPerDay(tenantId, account.accountId(), from)) {
            perDay.put(String.valueOf(row.get("day")), row);
        }
        List<DayCountVO> series = new ArrayList<>(window);
        for (int i = window - 1; i >= 0; i--) {
            String day = today.minusDays(i).toString();
            Map<String, Object> row = perDay.get(day);
            series.add(row == null
                ? new DayCountVO(day, 0, 0)
                : new DayCountVO(day, num(row, "inCount"), num(row, "outCount")));
        }
        return new MessageStatsVO(num(totals, "total"), num(totals, "inCount"), num(totals, "outCount"),
            num(totals, "activeConversations"), series);
    }

    /**
     * COUNT 给 Long、SUM 给 BigDecimal，统一按 Number 取。
     * <p>
     * statsTotals 与 statsPerDay 是两条独立语句（同一事务内也不加锁读），并发采集时
     * 夹在两条之间的行会让 total 与 Σ perDay 差一条：尽力值口径，与未读数同一条。
     */
    private static long num(Map<String, Object> row, String key) {
        Object v = row == null ? null : row.get(key);
        return v instanceof Number n ? n.longValue() : 0L;
    }

    // ============ 未读与会话头修复 ============

    @Transactional
    public int markRead(Long tenantId, Long conversationId) {
        return conversationMapper.clearUnread(tenantId, conversationId);
    }

    @Transactional
    public ConversationVO replayHead(Long tenantId, Long conversationId) {
        ChatConversation head = requireOwned(tenantId, conversationId);
        conversationMapper.replayHead(tenantId, conversationId);
        return ConversationVO.of(conversationMapper.selectById(head.getId()));
    }

    public ChatConversation requireOwned(Long tenantId, Long conversationId) {
        ChatConversation head = conversationMapper.selectOne(new LambdaQueryWrapper<ChatConversation>()
            .eq(ChatConversation::getTenantId, tenantId)
            .eq(ChatConversation::getId, conversationId)
            .last("LIMIT 1"));
        if (head == null) {
            throw new BizException(40404, "会话不存在: " + conversationId);
        }
        return head;
    }

    /**
     * platform 白名单：会话列表与全局搜索共用同一个守卫。同一个词在一个端点回 40000、
     * 在另一个端点回空页，前端就只能靠试错猜参数拼错了没有——空页看起来"像没有结果"，最难查。
     */
    private static void requirePlatformAllowed(String platform) {
        if (platform != null && !platform.isBlank() && !ALLOWED_PLATFORMS.contains(platform)) {
            throw new BizException(40000, "platform 只能是 whatsapp 或 telegram");
        }
    }

    private static int sizeOf(Integer size) {
        if (size == null || size <= 0) {
            return DEFAULT_SIZE;
        }
        return Math.min(size, MAX_SIZE);
    }

    /** from/to 是 `yyyy-MM-dd`；`to` 取当天最后一刻，否则当天的消息会被漏掉。 */
    private static LocalDateTime parseDay(String raw, boolean endOfDay) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            LocalDate d = LocalDate.parse(raw);
            return endOfDay ? d.atTime(23, 59, 59, 999_000_000) : d.atStartOfDay();
        } catch (DateTimeParseException bad) {
            throw new BizException(40000, "日期格式应为 yyyy-MM-dd: " + raw);
        }
    }
}
