package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.TranslationSetting;
import com.smartscrm.server.mapper.TranslationSettingMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DeadlockLoserDataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;

/**
 * 首存撞键那几条出口的**形状**（码、HTTP 档、文案里带不带档位名词）。{@code TranslationService#insertOrAdopt}
 * 的三条出口在真库上没法稳定凑出来（要 ≥3 发同一毫秒、且 InnoDB 恰好选谁当牺牲者），而它的坏法恰好是
 * "该回 40901 的那一格冒成了 {@code 50000}"——那是错误码词表（C12）上的事，不是并发时序上的事，
 * 所以用 mapper 桩把异常形状喂进去，钉住"哪一种 DAO 异常从哪一处抛出，都会变成同一个业务码"。
 * <p>
 * 这一份**不**证明的事，逐条写清楚，免得被当成证明了：
 * <ul>
 *   <li>不证明 MySQL 真会抛这些异常、也不证明"≥3 发会死锁"——那是 InnoDB 的行为，本项目的证据是
 *       {@code docs/notes/2026-09-25-conversation-settings-verification.md} 里"两发不死锁"的实测与
 *       已知限制里那条**读码**的兜底说明。</li>
 *   <li>不证明撞键那一支发的真是 {@code LIMIT 1 FOR UPDATE}：尾串要 MP 的 lambda 列缓存才解析得动，
 *       离线环境里没有。那一格的真凭据是服务端日志里的 {@code ... LIMIT 1 FOR UPDATE} 原文
 *       （契约驱动 {@code X10} / {@code X10c} 的第二通道）。</li>
 *   <li>不证明两发真的并发了，也不证明库里只有一行——同样是契约驱动那两行的事。</li>
 * </ul>
 */
class TranslationServiceRaceTest {

    private static final Long TENANT = 1L;

    /** 只喂 settingMapper：insertOrAdopt 全程只碰这一只 mapper，其余协作者给 null 就是"未被咨询"的写法。 */
    private static TranslationService serviceWith(TranslationSettingMapper mapper) {
        return new TranslationService(mapper, null, null, null, null, null, null, null, List.of());
    }

    private static TranslationSetting draft() {
        TranslationSetting row = new TranslationSetting();
        row.setTenantId(TENANT);
        row.setScope("conversation");
        row.setScopeKey("7:race@c.us");
        return row;
    }

    @Test
    void 建成那一支返回手里那一行且不再多读一次() {
        TranslationSettingMapper mapper = mock(TranslationSettingMapper.class);
        TranslationSetting mine = draft();
        when(mapper.insert(any(TranslationSetting.class))).thenReturn(1);

        assertSame(mine, serviceWith(mapper).insertOrAdopt(mine, TENANT, "conversation", "该会话", "k"));
        verify(mapper, never()).selectOne(any());
    }

    @Test
    void 撞键那一支采纳对手那一行而不是报错() {
        TranslationSettingMapper mapper = mock(TranslationSettingMapper.class);
        TranslationSetting winner = draft();
        winner.setId(999L);
        when(mapper.insert(any(TranslationSetting.class))).thenThrow(new DuplicateKeyException("Duplicate entry for key uk_tset_tenant_scope"));
        when(mapper.selectOne(any())).thenReturn(winner);

        assertSame(winner, serviceWith(mapper).insertOrAdopt(draft(), TENANT, "conversation", "该会话", "k"));
    }

    @Test
    void 撞键但那一行又被删了回40901且文案带档位名词() {
        TranslationSettingMapper mapper = mock(TranslationSettingMapper.class);
        when(mapper.insert(any(TranslationSetting.class))).thenThrow(new DuplicateKeyException("Duplicate entry"));
        when(mapper.selectOne(any())).thenReturn(null);

        BizException bx = assertThrows(BizException.class,
            () -> serviceWith(mapper).insertOrAdopt(draft(), TENANT, "customer", "该客户", "43"));

        assertEquals(40901, bx.getCode());
        assertEquals(HttpStatus.BAD_REQUEST, bx.getStatus());
        assertTrue(bx.getMessage().contains("该客户"), "文案要指得回是哪一档: " + bx.getMessage());
        assertTrue(bx.getMessage().contains("又被删除"), "这一格的成因是删, 不是建: " + bx.getMessage());
    }

    /**
     * 承重的一条：死锁发生在**撞键之后那次当前读**上（各支持着重复键记录的 S 锁再互相要 X 锁），
     * 所以它抛的位置在 {@code catch (DuplicateKeyException)} 的体内。兄弟 catch 罩不住自己兄弟的体内
     * 抛出的异常——这一格坏掉时它冒到 GlobalExceptionHandler 成 50000，正是这段代码要消掉的那个坏法。
     */
    @Test
    void 撞键之后的当前读被选为死锁牺牲者仍然回40901() {
        TranslationSettingMapper mapper = mock(TranslationSettingMapper.class);
        when(mapper.insert(any(TranslationSetting.class))).thenThrow(new DuplicateKeyException("Duplicate entry"));
        when(mapper.selectOne(any())).thenThrow(new DeadlockLoserDataAccessException("Deadlock found when trying to get lock", null));

        BizException bx = assertThrows(BizException.class,
            () -> serviceWith(mapper).insertOrAdopt(draft(), TENANT, "conversation", "该会话", "k"));

        assertEquals(40901, bx.getCode());
        assertTrue(bx.getMessage().contains("该会话"), "文案要指得回是哪一档: " + bx.getMessage());
    }

    /** insert 那一发自己等锁超时（对手迟迟不提交）：同一条出口，另一处抛出位置。 */
    @Test
    void 首发insert自己等锁超时回40901() {
        TranslationSettingMapper mapper = mock(TranslationSettingMapper.class);
        when(mapper.insert(any(TranslationSetting.class))).thenThrow(new CannotAcquireLockException("Lock wait timeout exceeded", null));

        BizException bx = assertThrows(BizException.class,
            () -> serviceWith(mapper).insertOrAdopt(draft(), TENANT, "customer", "该客户", "43"));

        assertEquals(40901, bx.getCode());
        assertTrue(bx.getMessage().contains("该客户"), "文案要指得回是哪一档: " + bx.getMessage());
    }
}
