package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.toolkit.support.SFunction;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.ChatGroup;
import com.smartscrm.server.entity.ChatMessage;
import com.smartscrm.server.entity.GroupMemberEvent;
import com.smartscrm.server.entity.GroupMemberState;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatGroupMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.GroupMemberEventMapper;
import com.smartscrm.server.mapper.GroupMemberStateMapper;
import com.smartscrm.server.web.vo.AccountImpactVO;
import org.springframework.stereotype.Service;

/**
 * 删除账号的影响预检（体检 §12 第 1 条 / R-13 / R-52）。
 *
 * <p>{@code platform_account} 名下有五张表挂了 {@code ON DELETE CASCADE}，删一次就是一次不可逆
 * 的归档清理，所以确认界面上要能说"会带走多少行"。计数只有这一个来源：五张表各数自己那一份，
 * 都按 {@code account_id} 收窄——账号归属先过 {@link PlatformAccountService#requireOwned}，
 * 与删除走同一道租户闸，避免出现"预检报的是别人的行数、删的是自己的账号"这种两套判定。
 *
 * <p>只数会被 CASCADE 带走的五张表。{@code batch_send_detail}、{@code group_join_task}、
 * {@code nurture_run}、{@code script_task} 也存 {@code account_id}，但它们没有外键，删账号不会
 * 连带它们（只会留下指向已删账号的残值）——那是另一件事，不混进这一句提示里。
 */
@Service
public class AccountImpactService {

    private final PlatformAccountService accountService;
    private final ChatConversationMapper conversationMapper;
    private final ChatMessageMapper messageMapper;
    private final ChatGroupMapper groupMapper;
    private final GroupMemberStateMapper stateMapper;
    private final GroupMemberEventMapper eventMapper;

    public AccountImpactService(PlatformAccountService accountService,
                                ChatConversationMapper conversationMapper,
                                ChatMessageMapper messageMapper,
                                ChatGroupMapper groupMapper,
                                GroupMemberStateMapper stateMapper,
                                GroupMemberEventMapper eventMapper) {
        this.accountService = accountService;
        this.conversationMapper = conversationMapper;
        this.messageMapper = messageMapper;
        this.groupMapper = groupMapper;
        this.stateMapper = stateMapper;
        this.eventMapper = eventMapper;
    }

    public AccountImpactVO impact(Long tenantId, Long accountId) {
        accountService.requireOwned(tenantId, accountId);
        return new AccountImpactVO(
            byAccount(conversationMapper, ChatConversation::getAccountId, accountId),
            byAccount(messageMapper, ChatMessage::getAccountId, accountId),
            byAccount(groupMapper, ChatGroup::getAccountId, accountId),
            byAccount(stateMapper, GroupMemberState::getAccountId, accountId),
            byAccount(eventMapper, GroupMemberEvent::getAccountId, accountId));
    }

    private static <T> long byAccount(BaseMapper<T> mapper, SFunction<T, Long> field, Long accountId) {
        return mapper.selectCount(new LambdaQueryWrapper<T>().eq(field, accountId));
    }
}
