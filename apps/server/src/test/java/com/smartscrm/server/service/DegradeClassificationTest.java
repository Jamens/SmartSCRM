package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.smartscrm.server.entity.TranslationCredential;
import com.smartscrm.server.entity.TranslationSetting;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.mapper.TranslationCacheMapper;
import com.smartscrm.server.mapper.TranslationCredentialMapper;
import com.smartscrm.server.mapper.TranslationNodeMapper;
import com.smartscrm.server.mapper.TranslationSettingMapper;
import com.smartscrm.server.service.provider.Credentials;
import com.smartscrm.server.service.provider.ProviderException;
import com.smartscrm.server.service.provider.ProviderResult;
import com.smartscrm.server.service.provider.TranslationProvider;
import com.smartscrm.server.web.dto.TranslateDTO;
import com.smartscrm.server.web.vo.TranslateVO;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 降级要分两种形状：<b>厂商瞬时故障</b>（重试有意义）与<b>配置性死路</b>（重试必然撞同一面墙）。
 * 分岔发生在抛出点（{@code ProviderException} 自带 {@code retryable}），这一份证的是服务层把那
 * 一个布尔一路带到 {@code TranslateVO.degradeRetryable}，以及"压根没配凭据"那条出口自己判成死路。
 * <p>
 * 为什么要在 commit 里：注入层那颗按钮的形态只看这一个布尔，而它在页面上看不出错——
 * 死路标成可重试，气泡上就是一颗永远点不亮的「点此重试」（本次要治的那一格）；反向标错，
 * 瞬时抖动那格会丢掉重试入口。两种都只坏在字段上，代码里读不出来。
 * <p>
 * 这一份**不**证明：各抛出点分岔得对不对（未配置密钥 / 语种不支持 → 死路，HTTP / error_code /
 * 传输失败 → 可重试），那是 {@code BaiduProviderTest} 与 {@code TencentProviderTest} 的格子。
 */
class DegradeClassificationTest {

    private static final Long TENANT = 1L;
    private static final Long ACCOUNT = 7L;
    private static final String CHAT = "260000000000000@lid";
    private static final String MSG_ID = "0FEA11D8A2B3C4D5E6F7A8B9C0D1E2F3";
    private static final String TEXT = "你好";

    private final TranslationSettingMapper settingMapper = mock(TranslationSettingMapper.class);
    private final TranslationCacheMapper cacheMapper = mock(TranslationCacheMapper.class);
    private final TranslationCredentialMapper credentialMapper = mock(TranslationCredentialMapper.class);
    private final ChatMessageMapper messageMapper = mock(ChatMessageMapper.class);
    private final SimulatedTranslationEngine engine = mock(SimulatedTranslationEngine.class);

    /** 被调用即失败：用来证"没配凭据时压根没问过厂商"。 */
    private final TranslationProvider mustNotBeCalled = new TranslationProvider() {
        @Override
        public String providerId() {
            return "baidu";
        }

        @Override
        public boolean supports(String fromLang, String toLang) {
            return true;
        }

        @Override
        public ProviderResult translate(Credentials creds, String text, String fromLang, String toLang) {
            throw new AssertionError("这一格的前提是不该问厂商");
        }
    };

    /**
     * 会话档一行给到 channel "5"（在 {@code CHANNEL_TO_PROVIDER} 里 = baidu），其余档位协作者
     * 都是"未被咨询"的形状。{@code withCredentials=false} 时 {@code loadCredentials} 给 null，
     * 走的是"未配置密钥，此结果来自本地模拟引擎"那条降级出口。
     */
    private TranslationService service(TranslationProvider provider, boolean withCredentials) {
        return service(provider, withCredentials, "5");
    }

    /** channel "9" 不在 {@code CHANNEL_TO_PROVIDER} 里：模拟引擎的成功出口，用来对照两个降级字段。 */
    private TranslationService service(TranslationProvider provider, boolean withCredentials, String channel) {
        TranslationSetting conversation = new TranslationSetting();
        conversation.setTenantId(TENANT);
        conversation.setScope("conversation");
        conversation.setChannel(channel);
        conversation.setReceiveFromLang("zh-CN");
        conversation.setReceiveToLang("en");
        conversation.setSendFromLang("zh-CN");
        conversation.setSendToLang("en");
        when(settingMapper.selectOne(any())).thenReturn(conversation);
        when(cacheMapper.selectOne(any())).thenReturn(null);
        when(messageMapper.findForTranslationByMsgId(anyLong(), anyLong(), anyString(), anyString()))
            .thenReturn(null);
        if (withCredentials) {
            TranslationCredential row = new TranslationCredential();
            row.setAppId("2020202001");
            row.setSecretKey("test_secret");
            when(credentialMapper.selectOne(any())).thenReturn(row);
        }
        // 兜底的模拟引擎：词典外原样回显，partial=true —— 降级那几格的译文都来自这里
        when(engine.translate(anyString(), any(), any(), any()))
            .thenReturn(new SimulatedTranslationEngine.EngineResult(TEXT, true, "zh-CN"));
        return new TranslationService(settingMapper, mock(TranslationNodeMapper.class), cacheMapper,
            credentialMapper, mock(CustomerMapper.class), mock(ChatConversationMapper.class),
            mock(PlatformAccountMapper.class), messageMapper, engine, List.of(provider), List.of(), null);
    }

    private static TranslationProvider throwing(ProviderException failure) {
        return new TranslationProvider() {
            @Override
            public String providerId() {
                return "baidu";
            }

            @Override
            public boolean supports(String fromLang, String toLang) {
                return true;
            }

            @Override
            public ProviderResult translate(Credentials creds, String text, String fromLang, String toLang) {
                throw failure;
            }
        };
    }

    private static TranslateDTO request() {
        return new TranslateDTO(TEXT, "receive", null, null, null, CHAT, ACCOUNT, MSG_ID);
    }

    @Test
    void 厂商瞬时故障仍标成可重试() {
        TranslateVO vo = service(throwing(new ProviderException("百度 HTTP 500")), true)
            .translate(TENANT, request());

        assertTrue(vo.degraded(), "这一格的前提就是降级: " + vo.degraded());
        assertTrue(vo.degradeRetryable(), "HTTP 状态码是瞬时故障，重试有意义: " + vo.degradeReason());
        assertEquals("百度 HTTP 500", vo.degradeReason());
    }

    @Test
    void 抛出点判死的故障到了VO上仍是不可重试() {
        TranslateVO vo = service(throwing(new ProviderException("百度 语种不支持: sw->en", false)), true)
            .translate(TENANT, request());

        assertTrue(vo.degraded(), "这一格的前提就是降级: " + vo.degraded());
        assertFalse(vo.degradeRetryable(), "语种不支持重试必然撞同一面墙: " + vo.degradeReason());
        assertEquals("百度 语种不支持: sw->en", vo.degradeReason());
    }

    @Test
    void 压根没配凭据那条出口就是死路() {
        TranslateVO vo = service(mustNotBeCalled, false).translate(TENANT, request());

        assertTrue(vo.degraded(), "这一格的前提就是降级: " + vo.degraded());
        assertFalse(vo.degradeRetryable(), "没有凭据时重试一万次也不会好: " + vo.degradeReason());
        assertTrue(vo.degradeReason().contains("未配置密钥"), vo.degradeReason());
    }

    @Test
    void 成功出口不带降级原因() {
        TranslateVO vo = service(mustNotBeCalled, false, "9").translate(TENANT, request());

        assertFalse(vo.degraded(), "channel 9 走模拟引擎的成功出口: " + vo.degradeReason());
        assertTrue(vo.degradeReason() == null, "非降级时不该编出一个原因: " + vo.degradeReason());
    }
}
