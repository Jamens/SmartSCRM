package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class StatusLadderTest {

    @Test
    void ladderHoldsTheOutboundStatesAndOnlyThose() {
        assertTrue(StatusLadder.isLadder("pending"));
        assertTrue(StatusLadder.isLadder("sent"));
        assertTrue(StatusLadder.isLadder("delivered"));
        assertTrue(StatusLadder.isLadder("read"));
        assertFalse(StatusLadder.isLadder("received"), "收到的行不在发出阶梯上");
        assertFalse(StatusLadder.isLadder("failed"), "failed 是终态，不参与只能往上走的比较");
        assertFalse(StatusLadder.isLadder(null));
    }

    @Test
    void writeTargetsAreTheLadderPlusFailed() {
        assertTrue(StatusLadder.isAllowedTarget("sent"));
        assertTrue(StatusLadder.isAllowedTarget("failed"));
        assertFalse(StatusLadder.isAllowedTarget("received"));
        assertFalse(StatusLadder.isAllowedTarget(""));
        assertFalse(StatusLadder.isAllowedTarget(null));
    }
}
