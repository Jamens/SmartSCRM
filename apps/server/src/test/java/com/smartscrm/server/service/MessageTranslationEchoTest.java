package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.smartscrm.server.entity.ChatMessage;
import com.smartscrm.server.entity.TranslationCache;
import com.smartscrm.server.entity.TranslationSetting;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.mapper.TranslationCacheMapper;
import com.smartscrm.server.mapper.TranslationCredentialMapper;
import com.smartscrm.server.mapper.TranslationNodeMapper;
import com.smartscrm.server.mapper.TranslationSettingMapper;
import com.smartscrm.server.web.dto.TranslateDTO;
import com.smartscrm.server.web.vo.TranslateVO;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 消息级译文回显那三条不变量（spec §0 红线 + §3/§4），全部走真实的 {@code translate()}：
 * <ol>
 *   <li>库里已存过同一语种的成功译文 → 直接回显，且**不再回写**（一次命中不该产生一次写）；</li>
 *   <li>本次算成功（厂商或模拟引擎） → 按定位到的那一行回写一次，参数是那行的 id；</li>
 *   <li>降级（在线线路没配密钥、厂商异常兜到模拟引擎） → **既不回写也不落内容缓存**。</li>
 * </ol>
 * 为什么这一份要在 commit 里，而不只靠验收时那份 {@code tmp/} 契约驱动：三条不变量里第 3 条是
 * 整枝唯一的"绝不写脏"闸门，第 1 条是"点通了才入库"的另一半。它们坏掉时页面上看不出来
 * （气泡照样有译文），只会把降级回显存成"这条消息的译文"、从此每次回显那句原样回显。
 * <p>
 * 这一份**不**证明的事：
 * <ul>
 *   <li>不证明两条定位 SQL 真能按 msg_key 尾部认出收/发两种形状 —— 那是字符串模式匹配，mock 掉的
 *       mapper 不参与。那一格由后端 HTTP 契约驱动（种行 → 按 msgId 回显）与真库量，见验收文档。</li>
 *   <li>不证明 {@code saveTranslation} 的 {@code COALESCE} 懒填只补空 —— 那是 SQL 侧行为，同上。</li>
 *   <li>不证明厂商通道真会抛 {@code ProviderException}：这里把降级喂成"未配密钥"那一格，
 *       两条出口在服务层汇到同一个降级 {@code return}（{@code TranslationService} 的 R7 之后那段）。</li>
 * </ul>
 */
class MessageTranslationEchoTest {

    private static final Long TENANT = 1L;
    private static final Long ACCOUNT = 7L;
    private static final String CHAT = "261963795943523@lid";
    private static final String MSG_ID = "0FEA11D8A2B3C4D5E6F7A8B9C0D1E2F3";
    private static final String TEXT = "你好";
    private static final Long ROW_ID = 42L;

    private final TranslationSettingMapper settingMapper = mock(TranslationSettingMapper.class);
    private final TranslationCacheMapper cacheMapper = mock(TranslationCacheMapper.class);
    private final TranslationCredentialMapper credentialMapper = mock(TranslationCredentialMapper.class);
    private final ChatMessageMapper messageMapper = mock(ChatMessageMapper.class);
    private final SimulatedTranslationEngine engine = mock(SimulatedTranslationEngine.class);

    /**
     * 会话档直接由 settingMapper 给一行（{@code resolveSetting} 命中会话档即止，不再问客户档/全局档），
     * 所以除 settingMapper 之外的档位协作者在这里都是"未被咨询"的形状。
     * channel 由参数给：{@code "9"} 不在 {@code CHANNEL_TO_PROVIDER} 里（走模拟引擎且落缓存/回写），
     * {@code "5"}（百度）在，配 credentialMapper 返回 null 就是"未配密钥"的降级出口。
     */
    private TranslationService service(String channel, String fromLang, String toLang) {
        TranslationSetting conversation = new TranslationSetting();
        conversation.setTenantId(TENANT);
        conversation.setScope("conversation");
        conversation.setChannel(channel);
        conversation.setReceiveFromLang(fromLang);
        conversation.setReceiveToLang(toLang);
        conversation.setSendFromLang(fromLang);
        conversation.setSendToLang(toLang);
        when(settingMapper.selectOne(any())).thenReturn(conversation);
        when(cacheMapper.selectOne(any())).thenReturn(null);
        return new TranslationService(settingMapper, mock(TranslationNodeMapper.class), cacheMapper,
            credentialMapper, mock(CustomerMapper.class), mock(ChatConversationMapper.class),
            mock(PlatformAccountMapper.class), messageMapper, engine, List.of());
    }

    private static TranslateDTO request(Boolean noCache) {
        return new TranslateDTO(TEXT, "receive", null, noCache, null, CHAT, ACCOUNT, MSG_ID);
    }

    /** 定位到的那一行：body 必须与本次文本归一化一致，否则服务层按"没定位到"处理。 */
    private static ChatMessage row(String translatedBody, String translatedLang) {
        ChatMessage row = new ChatMessage();
        row.setId(ROW_ID);
        row.setBody(TEXT);
        row.setMsgId(MSG_ID);
        row.setTranslatedBody(translatedBody);
        row.setTranslatedLang(translatedLang);
        return row;
    }

    @Test
    void 库里存过同语种译文就直接回显且不再回写() {
        TranslationService svc = service("9", "zh", "en");
        when(messageMapper.findForTranslationByMsgId(TENANT, ACCOUNT, CHAT, MSG_ID))
            .thenReturn(row("hello", "en"));

        TranslateVO vo = svc.translate(TENANT, request(null));

        assertEquals("hello", vo.translation());
        assertTrue(vo.cached(), "从库里回显的那一趟不该再问引擎: " + vo.cached());
        verify(messageMapper, never()).saveTranslation(anyLong(), anyString(), anyString(), anyString());
        // 命中消息级回显时在内容缓存之前就返回了，所以那一层也不该被咨询
        verify(cacheMapper, never()).insert(any(TranslationCache.class));
    }

    @Test
    void 语种不符时不回显但成功后按那一行回写() {
        when(messageMapper.findForTranslationByMsgId(TENANT, ACCOUNT, CHAT, MSG_ID))
            .thenReturn(row("bonjour", "fr"));
        when(engine.translate(anyString(), any(), any(), any()))
            .thenReturn(new SimulatedTranslationEngine.EngineResult("hello", false, "zh"));

        TranslateVO vo = service("9", "zh", "en").translate(TENANT, request(null));

        assertEquals("hello", vo.translation());
        assertFalse(vo.degraded(), "channel 9 没有厂商映射，走的是模拟引擎的成功出口: " + vo.degraded());
        verify(messageMapper).saveTranslation(eq(ROW_ID), eq(MSG_ID), eq("hello"), eq("en"));
    }

    @Test
    void 手动重试那趟照样定位行并回写() {
        when(messageMapper.findForTranslationByMsgId(TENANT, ACCOUNT, CHAT, MSG_ID))
            .thenReturn(row("hello", "en"));
        when(engine.translate(anyString(), any(), any(), any()))
            .thenReturn(new SimulatedTranslationEngine.EngineResult("hi there", false, "zh"));

        TranslateVO vo = service("9", "zh", "en").translate(TENANT, request(true));

        // noCache 只拦"直接回显旧译文"那一个提前返回，不拦入库：重试算出来的新译文照样落那一行
        assertEquals("hi there", vo.translation());
        verify(messageMapper).saveTranslation(eq(ROW_ID), eq(MSG_ID), eq("hi there"), eq("en"));
    }

    @Test
    void 降级那次既不回写也不落内容缓存() {
        when(messageMapper.findForTranslationByMsgId(TENANT, ACCOUNT, CHAT, MSG_ID))
            .thenReturn(row(null, null));
        when(engine.translate(anyString(), any(), any(), any()))
            .thenReturn(new SimulatedTranslationEngine.EngineResult(TEXT, true, "zh"));
        // channel 5 = 百度，在 CHANNEL_TO_PROVIDER 里；credentialMapper 没桩 → selectOne 返回 null
        // → loadCredentials 给 null → "未配置密钥，此结果来自本地模拟引擎"那一格降级出口
        TranslationService svc = service("5", "zh", "en");

        TranslateVO vo = svc.translate(TENANT, request(null));

        assertTrue(vo.degraded(), "这一格的前提就是降级: " + vo.degraded());
        verify(messageMapper, never()).saveTranslation(anyLong(), anyString(), anyString(), anyString());
        verify(cacheMapper, never()).insert(any(TranslationCache.class));
    }

    @Test
    void 定位到的那行正文对不上就当没定位到() {
        ChatMessage other = row(null, null);
        other.setBody("别的话");
        when(messageMapper.findForTranslationByMsgId(TENANT, ACCOUNT, CHAT, MSG_ID)).thenReturn(other);
        when(engine.translate(anyString(), any(), any(), any()))
            .thenReturn(new SimulatedTranslationEngine.EngineResult("hello", false, "zh"));

        service("9", "zh", "en").translate(TENANT, request(null));

        // 第二趟（尾部模式）只有在第一趟没返回行时才发；这里第一趟给了行、只是正文不匹配，
        // 服务层把它判成"没定位到"，于是既不回显也不回写，也不许再往下猜另一行。
        verify(messageMapper, never()).findForTranslationByMsgKeyTail(anyLong(), anyLong(), anyString(), anyString());
        verify(messageMapper, never()).saveTranslation(anyLong(), anyString(), anyString(), anyString());
    }

    @Test
    void 规范列没命中时才发第二趟尾部模式查询() {
        when(messageMapper.findForTranslationByMsgId(TENANT, ACCOUNT, CHAT, MSG_ID)).thenReturn(null);
        when(messageMapper.findForTranslationByMsgKeyTail(TENANT, ACCOUNT, CHAT, MSG_ID))
            .thenReturn(row(null, null));
        when(engine.translate(anyString(), any(), any(), any()))
            .thenReturn(new SimulatedTranslationEngine.EngineResult("hello", false, "zh"));

        service("9", "zh", "en").translate(TENANT, request(null));

        verify(messageMapper).findForTranslationByMsgKeyTail(TENANT, ACCOUNT, CHAT, MSG_ID);
        verify(messageMapper).saveTranslation(eq(ROW_ID), eq(MSG_ID), eq("hello"), eq("en"));
    }

    @Test
    void 没有消息级键的请求根本不咨询定位() {
        when(engine.translate(anyString(), any(), any(), any()))
            .thenReturn(new SimulatedTranslationEngine.EngineResult("hello", false, "zh"));

        service("9", "zh", "en").translate(TENANT,
            new TranslateDTO(TEXT, "receive", null, null, null, CHAT, ACCOUNT, null));

        verify(messageMapper, never()).findForTranslationByMsgId(anyLong(), anyLong(), anyString(), anyString());
        verify(messageMapper, never()).findForTranslationByMsgKeyTail(anyLong(), anyLong(), anyString(), anyString());
        verify(messageMapper, never()).saveTranslation(anyLong(), anyString(), anyString(), anyString());
    }
}
