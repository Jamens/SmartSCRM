package com.smartscrm.server.service;

import com.smartscrm.server.entity.ScriptTask;
import com.smartscrm.server.entity.ScriptTaskStep;
import com.smartscrm.server.mapper.ScriptTaskMapper;
import java.time.LocalDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * B8 调度器的**心跳驱动器**（spec §4：调度在 Java，需要一个周期把 {@link ScriptSchedulerService}
 * 叫起来——B7 的泵在 Electron 主进程、由那边驱动，B8 这边自己定时驱动）。
 *
 * <p>周期 10s：扫到期 task 推进 + 回收心跳超时的 task。异常吞掉只记日志——一次调度失败不该
 * 让整个 Spring 容器停摆（这里挂掉 = 全部剧本停跑）。
 */
@Component
public class ScriptSchedulerDriver {

    private static final Logger log = LoggerFactory.getLogger(ScriptSchedulerDriver.class);

    private final ScriptSchedulerService scheduler;

    public ScriptSchedulerDriver(ScriptSchedulerService scheduler) {
        this.scheduler = scheduler;
    }

    /** 每 10s 推进一次。fixedDelay 而非 fixedRate：上一轮没跑完就别叠下一轮（防任务堆积）。 */
    @Scheduled(fixedDelay = 10_000, initialDelay = 15_000)
    public void tick() {
        try {
            LocalDateTime now = LocalDateTime.now();
            int stale = scheduler.reapStale(now);
            int advanced = scheduler.scheduleDue(now);
            if (stale > 0 || advanced > 0) {
                log.info("[script] tick: 推进 {} 个到期 task, 回收 {} 个心跳超时", advanced, stale);
            }
        } catch (RuntimeException e) {
            // 调度异常不能外抛：@Scheduled 抛异常会被容器记录但仍继续，这里再兜一层只记日志。
            log.warn("[script] tick 失败（不影响容器）: {}", e.getMessage());
        }
    }
}
