package com.smartscrm.server.config;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.entity.AppUser;
import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.AppUserMapper;
import com.smartscrm.server.mapper.TenantMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;

/** Seeds demo accounts so the client can log in without any online service. */
@Configuration
public class DataSeeder {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    @Bean
    public ApplicationRunner seedUsers(TenantMapper tenantMapper, AppUserMapper userMapper, PasswordEncoder encoder) {
        return args -> {
            if (userMapper.selectCount(null) > 0) {
                return;
            }
            Tenant tenant = tenantMapper.selectOne(new LambdaQueryWrapper<Tenant>()
                .eq(Tenant::getInviteCode, "DEMO0001"));
            userMapper.insert(buildUser(tenant.getId(), "admin", "admin123", "Admin", "owner", encoder));
            userMapper.insert(buildUser(tenant.getId(), "agent01", "agent123", "客服小蓝", "agent", encoder));
            log.info("Seeded demo users under inviteCode DEMO0001 (admin/agent01)");
        };
    }

    /** A second tenant so cross-tenant isolation is observable through the HTTP API. */
    @Bean
    public ApplicationRunner seedIsolationTenant(TenantMapper tenantMapper, AppUserMapper userMapper,
                                                 PasswordEncoder encoder) {
        return args -> {
            if (tenantMapper.selectCount(new LambdaQueryWrapper<Tenant>()
                .eq(Tenant::getInviteCode, "QA0002")) > 0) {
                return;
            }
            Tenant qa = new Tenant();
            qa.setInviteCode("QA0002");
            qa.setName("QA Isolation Tenant");
            qa.setStatus(1);
            tenantMapper.insert(qa);
            userMapper.insert(buildUser(qa.getId(), "qa", "qa12345", "QA", "owner", encoder));
            log.info("Seeded QA0002 tenant for cross-tenant isolation checks");
        };
    }

    private AppUser buildUser(Long tenantId, String username, String rawPassword, String nickname, String role,
                              PasswordEncoder encoder) {
        AppUser user = new AppUser();
        user.setTenantId(tenantId);
        user.setUsername(username);
        user.setPasswordHash(encoder.encode(rawPassword));
        user.setNickname(nickname);
        user.setRole(role);
        user.setStatus(1);
        return user;
    }
}
