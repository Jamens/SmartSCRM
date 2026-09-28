package com.smartscrm.server.service.batch;

import java.util.Map;
import java.util.Set;

/**
 * 任务状态机的合法边 + 撤回资格。裁决只在这一处：控制器、服务、执行环都来这里问，
 * 于是"pending 能不能暂停"在系统里只有一个答案。
 */
public final class BatchStatus {

    private static final Map<String, Set<String>> TASK_EDGES = Map.of(
            "pending", Set.of("running", "cancelled"),
            "running", Set.of("paused", "done", "error", "cancelled"),
            "paused", Set.of("running", "cancelled"),
            // R11：这两条只服务重发（done/error → paused），由 Task 5 的 retryFailed 独占；
            // 「暂停」动作的来源态表在 BatchSendService.SOURCES_OF 里仍然只有 running，
            // 所以没有人能从一个跑完的任务点出「暂停」。
            "done", Set.of("paused"),
            "error", Set.of("paused")
    );

    /**
     * 引擎经 {@code POST /tasks/{id}/reports} 可以写进明细的状态（R37，spec §2 那条链）。
     * 少 {@code pending}：它是建单与重发写下的初始态，不是回执——让它进来会把一行已经结掉的条目
     * 倒回待跑，而 {@code openCount} 只认 pending+sending，那一行从此归不了零、任务到不了 done。
     * 词表只在这里写一次，服务层的闸门读它。
     */
    public static final Set<String> REPORTABLE_SEND_STATUS =
            Set.of("sending", "success", "failed", "unknown", "skipped");

    private BatchStatus() {
    }

    public static boolean canMove(String from, String to) {
        if (from == null || to == null) {
            return false;
        }
        return TASK_EDGES.getOrDefault(from, Set.of()).contains(to);
    }

    /** @return null 表示这三条都过了；否则是人能看懂的一句话（spec §2 的三条判据，按顺序判；第四条「recall_status 不是 none」在 Task 5 的服务层判）。 */
    public static String recallBlocker(Boolean dryRun, String sendStatus, String msgKey) {
        if (Boolean.TRUE.equals(dryRun)) {
            return "演练任务没有真发过，无物可撤";
        }
        if (!"success".equals(sendStatus)) {
            return "这一条不是成功状态（send_status=" + sendStatus + "），撤回无从谈起";
        }
        if (msgKey == null || msgKey.isBlank()) {
            return "这一条没有 msg_key，无法定位要撤哪条消息";
        }
        return null;
    }
}
