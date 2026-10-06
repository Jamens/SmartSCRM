package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ScriptPlaybook;
import com.smartscrm.server.entity.ScriptPlaybookStep;
import com.smartscrm.server.entity.ScriptTask;
import com.smartscrm.server.entity.ScriptTaskStep;
import com.smartscrm.server.mapper.ScriptPlaybookMapper;
import com.smartscrm.server.mapper.ScriptPlaybookStepMapper;
import com.smartscrm.server.mapper.ScriptTaskMapper;
import com.smartscrm.server.mapper.ScriptTaskStepMapper;
import java.util.List;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** B8 任务实例单测：起任务幂等 / 预建 step / 初始账号取 failover 首个。 */
class ScriptTaskServiceTest {

    private static final Long TENANT = 1L, PB = 3L;

    private ScriptTaskMapper taskMapper;
    private ScriptTaskStepMapper stepMapper;
    private ScriptPlaybookMapper pbMapper;
    private ScriptPlaybookStepMapper pbStepMapper;
    private ScriptTaskService svc;

    @BeforeEach
    void setUp() {
        MapperBuilderAssistant asst = new MapperBuilderAssistant(new Configuration(), "");
        for (Class<?> e : new Class<?>[] { ScriptTask.class, ScriptTaskStep.class, ScriptPlaybook.class,
            ScriptPlaybookStep.class }) {
            TableInfoHelper.initTableInfo(asst, e);
        }
        taskMapper = mock(ScriptTaskMapper.class);
        stepMapper = mock(ScriptTaskStepMapper.class);
        pbMapper = mock(ScriptPlaybookMapper.class);
        pbStepMapper = mock(ScriptPlaybookStepMapper.class);
        svc = new ScriptTaskService(taskMapper, stepMapper, pbMapper, pbStepMapper,
            new ScriptSchedulerService(taskMapper, stepMapper, pbMapper, pbStepMapper));
    }

    private static ScriptPlaybook pb(String accountIds) {
        ScriptPlaybook p = new ScriptPlaybook();
        p.setId(PB);
        p.setTenantId(TENANT);
        p.setAccountIds(accountIds);
        return p;
    }

    @Test
    void start_seedsTaskAndPrebuildsSteps() {
        when(pbMapper.selectById(PB)).thenReturn(pb("[7,2]"));
        when(taskMapper.selectOne(any())).thenReturn(null); // 不存在 → 新建
        when(pbStepMapper.selectList(any())).thenReturn(List.of(def(0, "post_message"), def(1, "react")));

        ScriptTask t = svc.start(TENANT, PB, "chat-1@g.us", "grp1");

        assertEquals("pending", t.getStatus());
        assertEquals(0, t.getCurrentStep());
        assertEquals(7L, t.getAccountId(), "初始账号 = failover 列表首个");
        assertNotNull(t.getNextRunAt(), "next_run_at 置 now → 立即到期");
        verify(taskMapper).insert(any(ScriptTask.class));
        verify(stepMapper, times(2)).insert(any(ScriptTaskStep.class)); // 预建两步
    }

    @Test
    void start_isIdempotent_sameChatReturnsExisting() {
        when(pbMapper.selectById(PB)).thenReturn(pb("[7]"));
        ScriptTask exist = new ScriptTask();
        exist.setId(99L);
        when(taskMapper.selectOne(any())).thenReturn(exist); // 已存在

        ScriptTask t = svc.start(TENANT, PB, "chat-1@g.us", null);

        assertSame(exist, t, "同群同剧本重复起任务 → 返回已存在的，不重建");
        verify(taskMapper, never()).insert(any(ScriptTask.class));
    }

    @Test
    void start_rejectsOtherTenantPlaybook() {
        ScriptPlaybook p = pb("[7]");
        p.setTenantId(999L);
        when(pbMapper.selectById(PB)).thenReturn(p);
        assertThrows(BizException.class, () -> svc.start(TENANT, PB, "chat-1", null));
    }

    @Test
    void start_rejectsBlankChatKey() {
        assertThrows(BizException.class, () -> svc.start(TENANT, PB, "  ", null));
    }

    @Test
    void start_noAccountList_leavesAccountNull() {
        when(pbMapper.selectById(PB)).thenReturn(pb(null));
        when(taskMapper.selectOne(any())).thenReturn(null);
        when(pbStepMapper.selectList(any())).thenReturn(List.of());
        ScriptTask t = svc.start(TENANT, PB, "chat-1", null);
        assertEquals(null, t.getAccountId());
    }

    private static ScriptPlaybookStep def(int seq, String type) {
        ScriptPlaybookStep d = new ScriptPlaybookStep();
        d.setSeq(seq);
        d.setActionType(type);
        return d;
    }
}
