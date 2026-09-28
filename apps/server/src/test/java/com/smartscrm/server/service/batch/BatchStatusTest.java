package com.smartscrm.server.service.batch;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class BatchStatusTest {

    @Test
    void taskEdgesAreTheSpecifiedOnes() {
        assertTrue(BatchStatus.canMove("pending", "running"));
        assertTrue(BatchStatus.canMove("pending", "cancelled"));
        assertTrue(BatchStatus.canMove("running", "paused"));
        assertTrue(BatchStatus.canMove("running", "done"));
        assertTrue(BatchStatus.canMove("running", "error"));
        assertTrue(BatchStatus.canMove("running", "cancelled"));
        assertTrue(BatchStatus.canMove("paused", "running"));
        assertTrue(BatchStatus.canMove("paused", "cancelled"));
        // R11：重发是唯一能把终态唤醒的动作，而且只唤醒到 paused（要再跑必须由人点「继续」）。
        assertTrue(BatchStatus.canMove("done", "paused"));
        assertTrue(BatchStatus.canMove("error", "paused"));
    }

    @Test
    void terminalStatesCannotRestart() {
        assertFalse(BatchStatus.canMove("done", "running"));
        assertFalse(BatchStatus.canMove("error", "running"));
        assertFalse(BatchStatus.canMove("cancelled", "running"));
        assertFalse(BatchStatus.canMove("cancelled", "paused"), "取消是人明确按下的停，重发不唤醒它");
        assertFalse(BatchStatus.canMove("done", "cancelled"), "已经跑完的任务没有可取消的东西");
        assertFalse(BatchStatus.canMove("done", "error"), "终态之间不互搬");
        assertFalse(BatchStatus.canMove("pending", "paused"), "没跑过没有什么可暂停");
        assertFalse(BatchStatus.canMove(null, "running"));
    }

    @Test
    void dryRunIsTheFirstRecallBlocker() {
        assertEquals("演练任务没有真发过，无物可撤",
                BatchStatus.recallBlocker(true, "success", "true_x@c.us_Y_out"));
    }

    @Test
    void sendStateThenMsgKeyDecideTheRest() {
        assertEquals("这一条不是成功状态（send_status=unknown），撤回无从谈起",
                BatchStatus.recallBlocker(false, "unknown", "true_x@c.us_Y_out"));
        assertEquals("这一条没有 msg_key，无法定位要撤哪条消息",
                BatchStatus.recallBlocker(false, "success", null));
        assertNull(BatchStatus.recallBlocker(false, "success", "true_x@c.us_Y_out"));
    }
}
