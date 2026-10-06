package com.smartscrm.server;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
// B8 调度器（ScriptSchedulerDriver）靠 @Scheduled 周期推进剧本任务，需开启调度。
@EnableScheduling
@MapperScan("com.smartscrm.server.mapper")
public class ScrmServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(ScrmServerApplication.class, args);
    }
}
