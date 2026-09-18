package com.smartscrm.server;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.smartscrm.server.mapper")
public class ScrmServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(ScrmServerApplication.class, args);
    }
}
