package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.smartscrm.server.common.BizException;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatGroupMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.GroupMemberEventMapper;
import com.smartscrm.server.mapper.GroupMemberStateMapper;
import com.smartscrm.server.web.vo.AccountImpactVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * 删除账号前的影响预检（体检 §12 第 1 条）。计数本身按账号收窄，这一层由 HTTP 契约腿对着
 * 另一个读口对齐；本测试守的是**装配**：五个数各来自自己那张表、租户闸在数之前、无数据回 0。
 */
class AccountImpactServiceTest {

    private static final Long TENANT = 1L;
    private static final Long ACCOUNT = 7L;

    private PlatformAccountService accountService;
    private ChatConversationMapper conversationMapper;
    private ChatMessageMapper messageMapper;
    private ChatGroupMapper groupMapper;
    private GroupMemberStateMapper stateMapper;
    private GroupMemberEventMapper eventMapper;
    private AccountImpactService service;

    @BeforeEach
    void setUp() {
        accountService = mock(PlatformAccountService.class);
        conversationMapper = mock(ChatConversationMapper.class);
        messageMapper = mock(ChatMessageMapper.class);
        groupMapper = mock(ChatGroupMapper.class);
        stateMapper = mock(GroupMemberStateMapper.class);
        eventMapper = mock(GroupMemberEventMapper.class);
        service = new AccountImpactService(accountService, conversationMapper, messageMapper,
            groupMapper, stateMapper, eventMapper);
    }

    @Test
    void impact_readsEachCountFromItsOwnTable() {
        when(conversationMapper.selectCount(any())).thenReturn(12L);
        when(messageMapper.selectCount(any())).thenReturn(340L);
        when(groupMapper.selectCount(any())).thenReturn(5L);
        when(stateMapper.selectCount(any())).thenReturn(210L);
        when(eventMapper.selectCount(any())).thenReturn(88L);

        AccountImpactVO vo = service.impact(TENANT, ACCOUNT);

        // 五个槽位串了位，界面就会把「340 条消息」报成「340 个群」——这是这条断言的全部目的。
        assertEquals(new AccountImpactVO(12L, 340L, 5L, 210L, 88L), vo);
    }

    @Test
    void impact_otherTenantAccount_failsBeforeCounting() {
        when(accountService.requireOwned(TENANT, ACCOUNT))
            .thenThrow(new BizException(40404, "账号不存在"));

        BizException error = assertThrows(BizException.class, () -> service.impact(TENANT, ACCOUNT));

        assertEquals(40404, error.getCode());
        // 越权的那次请求一行都不该数：五个 count 全没被调用。
        verifyNoInteractions(conversationMapper, messageMapper, groupMapper, stateMapper, eventMapper);
    }

    @Test
    void impact_noArchivedRows_reportsZerosNotNothing() {
        when(conversationMapper.selectCount(any())).thenReturn(0L);
        when(messageMapper.selectCount(any())).thenReturn(0L);
        when(groupMapper.selectCount(any())).thenReturn(0L);
        when(stateMapper.selectCount(any())).thenReturn(0L);
        when(eventMapper.selectCount(any())).thenReturn(0L);

        AccountImpactVO vo = service.impact(TENANT, ACCOUNT);

        // 0 是「这张表不会被带走任何行」这句实话；返回 null 会让界面把它读成「没统计到」。
        assertEquals(new AccountImpactVO(0L, 0L, 0L, 0L, 0L), vo);
    }
}
