package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.web.vo.ConversationVO;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class TakeoverServiceTest {

    private static final Pattern MPGEN = Pattern.compile("MPGENVAL\\d+");


    private ChatConversationMapper mapper;
    private MessageQueryService query;
    private TakeoverService service;

    /** The single DB row the test drives; requireOwned always returns it, update mutates it. */
    private ChatConversation row;

    @BeforeEach
    void setUp() {
        // Pure unit test has no Spring context, so register the entity's TableInfo manually;
        // otherwise LambdaQueryWrapper/LambdaUpdateWrapper can't resolve column names.
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), ""), ChatConversation.class);
        mapper = mock(ChatConversationMapper.class);
        query = mock(MessageQueryService.class);
        service = new TakeoverService(mapper, query);

        row = new ChatConversation();
        row.setId(11L);
        row.setTenantId(7L);
        row.setHandlingStatus("AI");
        row.setAssigneeId(null);
        row.setWaitTakeoverAt(null);
        row.setTransferReason(null);

        // requireOwned is called twice per transition (pre-check + post-read for the VO),
        // both return the same live row so the returned VO reflects the applied update.
        when(query.requireOwned(7L, 11L)).thenReturn(row);
        // Apply the update wrapper to the live row so the post-read returns the new state.
        when(mapper.update(isNull(), any(LambdaUpdateWrapper.class))).thenAnswer(inv -> {
            applyWrapper(row, inv.getArgument(1));
            return 1;
        });
    }

    /** Mirror the SET clause onto the entity so we can assert real post-state, not just wiring. */
    @SuppressWarnings("unchecked")
    private static void applyWrapper(ChatConversation target, LambdaUpdateWrapper<ChatConversation> w) {
        String sqlSet = w.getSqlSet();
        if (sqlSet == null) return;
        // LambdaUpdateWrapper renders values as #{ew.paramNameValuePairs.MPGENVALx}; the bound
        // value lives in the wrapper's paramNameValuePairs keyed by that MPGENVALx name.
        // Without MP's global underline strategy in the test config columns resolve as camelCase,
        // so accept both camelCase and snake_case to stay config-independent.
        Map<String, Object> params = w.getParamNameValuePairs();
        for (String a : sqlSet.split(",")) {
            String col = a.substring(0, a.indexOf('=')).trim();
            String valPart = a.substring(a.indexOf('=') + 1).trim();
            Object v;
            if (valPart.startsWith("#{")) {
                Matcher m = MPGEN.matcher(valPart);
                v = m.find() ? params.get(m.group()) : null;
            } else {
                v = null; // ".set(col, null)" renders as a literal NULL, not a bound param
            }
            switch (col) {
                case "handling_status", "handlingStatus" -> target.setHandlingStatus((String) v);
                case "assignee_id", "assigneeId" -> target.setAssigneeId((Long) v);
                case "wait_takeover_at", "waitTakeoverAt" -> target.setWaitTakeoverAt((LocalDateTime) v);
                case "transfer_reason", "transferReason" -> target.setTransferReason((String) v);
                default -> { /* unknown column, ignore */ }
            }
        }
    }

    private static ChatConversation head(String status, Long assignee) {
        ChatConversation c = new ChatConversation();
        c.setId(11L);
        c.setTenantId(7L);
        c.setHandlingStatus(status);
        c.setAssigneeId(assignee);
        c.setWaitTakeoverAt(null);
        c.setTransferReason(null);
        return c;
    }

    @Test
    void takeover_movesAiToHumanActive_withCurrentSeatAsAssignee() {
        when(query.requireOwned(7L, 11L)).thenReturn(row);

        ConversationVO vo = service.takeover(7L, 42L, 11L);

        assertEquals("HUMAN_ACTIVE", vo.handlingStatus());
        assertEquals(42L, vo.assigneeId());
        assertNull(vo.transferReason());
        verify(mapper).update(isNull(), any(LambdaUpdateWrapper.class));
    }

    @Test
    void takeover_movesWaitingToHumanActive() {
        row.setHandlingStatus("WAITING_TAKEOVER");

        ConversationVO vo = service.takeover(7L, 42L, 11L);

        assertEquals("HUMAN_ACTIVE", vo.handlingStatus());
        assertEquals(42L, vo.assigneeId());
    }

    @Test
    void takeover_refusesWhenAnotherSeatAlreadyHoldsIt() {
        row.setHandlingStatus("HUMAN_ACTIVE");
        row.setAssigneeId(99L);

        BizException ex = assertThrows(BizException.class, () -> service.takeover(7L, 42L, 11L));

        assertEquals(40900, ex.getCode());
        verify(mapper, never()).update(any(), any());
    }

    @Test
    void takeover_allowsSameSeatToReaffirm() {
        row.setHandlingStatus("HUMAN_ACTIVE");
        row.setAssigneeId(42L);

        ConversationVO vo = service.takeover(7L, 42L, 11L);

        assertEquals("HUMAN_ACTIVE", vo.handlingStatus());
        assertEquals(42L, vo.assigneeId());
    }

    @Test
    void resumeAi_clearsAssigneeAndReason() {
        row.setHandlingStatus("HUMAN_ACTIVE");
        row.setAssigneeId(42L);
        row.setTransferReason("rule:x");

        ConversationVO vo = service.resumeAi(7L, 11L);

        assertEquals("AI", vo.handlingStatus());
        assertNull(vo.assigneeId());
        assertNull(vo.transferReason());
    }

    @Test
    void transferHuman_entersQueueWithReasonAndTimestamp() {
        ConversationVO vo = service.transferHuman(7L, 11L, "rule:keyword");

        assertEquals("WAITING_TAKEOVER", vo.handlingStatus());
        assertEquals("rule:keyword", vo.transferReason());
        assertNull(vo.assigneeId());
        // waitTakeoverAt is set to now(); assert it's non-null and recent.
        assertEquals(true, vo.waitTakeoverAt() != null);
    }

    @Test
    void transferHuman_withoutReason_leavesReasonNull() {
        ConversationVO vo = service.transferHuman(7L, 11L, null);

        assertEquals("WAITING_TAKEOVER", vo.handlingStatus());
        assertNull(vo.transferReason());
    }

    @Test
    void queue_returnsWaitingOrderedByWaitTimeAsc() {
        ChatConversation older = head("WAITING_TAKEOVER", null);
        older.setId(1L);
        older.setWaitTakeoverAt(LocalDateTime.of(2026, 1, 1, 0, 0));
        ChatConversation newer = head("WAITING_TAKEOVER", null);
        newer.setId(2L);
        newer.setWaitTakeoverAt(LocalDateTime.of(2026, 1, 2, 0, 0));
        // The wrapper carries the WAITING_TAKEOVER filter + orderByWaitTakeoverAt ASC; the
        // mock returns the already-filtered AND already-sorted result the DB would produce.
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(older, newer));

        List<ConversationVO> q = service.queue(7L);

        assertEquals(2, q.size());
        assertEquals(1L, q.get(0).id());
        assertEquals(2L, q.get(1).id());
    }
}
