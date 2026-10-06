package com.smartscrm.server.service;

import java.time.LocalDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * B9 养号调度器的心跳驱动器（spec §4/§5：调度在 Java）。
 *
 * <p>每 30s 扫一次到点的时间点，为该发言的账号生成 run 行（幂等，uk 兜着）。
 * 真正发消息由桌面端驱动来领（`/api/nurture-runs/pending`）——Java 不碰 wa-js。
 */
@Component
public class NurtureSchedulerDriver {

    private static final Logger log = LoggerFactory.getLogger(NurtureSchedulerDriver.class);

    private final NurtureExecutorService executor;

    public NurtureSchedulerDriver(NurtureExecutorService executor) {
        this.executor = executor;
    }

    @Scheduled(fixedDelay = 30_000, initialDelay = 20_000)
    public void tick() {
        try {
            int made = executor.scheduleDue(LocalDateTime.now());
            if (made > 0) {
                log.info("[nurture] tick: 生成 {} 条待发发言", made);
            }
        } catch (RuntimeException e) {
            // 调度异常不外抛（挂掉=全部养号计划停跑），只记日志
            log.warn("[nurture] tick 失败（不影响容器）: {}", e.getMessage());
        }
    }
}
