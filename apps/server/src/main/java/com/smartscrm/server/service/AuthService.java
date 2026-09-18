package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.AppUser;
import com.smartscrm.server.entity.Device;
import com.smartscrm.server.entity.Tenant;
import com.smartscrm.server.mapper.AppUserMapper;
import com.smartscrm.server.mapper.DeviceMapper;
import com.smartscrm.server.mapper.TenantMapper;
import com.smartscrm.server.security.JwtService;
import com.smartscrm.server.web.dto.LoginRequest;
import com.smartscrm.server.web.dto.LoginResponse;
import io.jsonwebtoken.Claims;
import java.time.LocalDateTime;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private final TenantMapper tenantMapper;
    private final AppUserMapper userMapper;
    private final DeviceMapper deviceMapper;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(TenantMapper tenantMapper, AppUserMapper userMapper, DeviceMapper deviceMapper,
                       PasswordEncoder passwordEncoder, JwtService jwtService) {
        this.tenantMapper = tenantMapper;
        this.userMapper = userMapper;
        this.deviceMapper = deviceMapper;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    public LoginResponse login(LoginRequest req) {
        Tenant tenant = tenantMapper.selectOne(new LambdaQueryWrapper<Tenant>()
            .eq(Tenant::getInviteCode, req.inviteCode()));
        if (tenant == null) {
            throw new BizException(40401, "邀请码不存在");
        }
        if (tenant.getStatus() != 1) {
            throw BizException.unauthorized("租户已被停用");
        }
        AppUser user = userMapper.selectOne(new LambdaQueryWrapper<AppUser>()
            .eq(AppUser::getTenantId, tenant.getId())
            .eq(AppUser::getUsername, req.username()));
        if (user == null || !passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            throw BizException.unauthorized("账号或密码错误");
        }
        if (user.getStatus() != 1) {
            throw BizException.unauthorized("账号已被禁用");
        }

        bindDevice(user.getId(), req);

        String access = jwtService.issueAccessToken(user.getId(), tenant.getId(), tenant.getInviteCode(), user.getRole());
        String refresh = jwtService.issueRefreshToken(user.getId(), tenant.getId(), tenant.getInviteCode(), user.getRole());
        return new LoginResponse(access, refresh, jwtService.getAccessTtlSeconds(), toUserInfo(user, tenant));
    }

    public LoginResponse refresh(String refreshToken) {
        Claims claims = jwtService.parse(refreshToken);
        if (claims == null || !"refresh".equals(claims.get("typ", String.class))) {
            throw BizException.unauthorized("刷新令牌无效或已过期");
        }
        Long userId = Long.valueOf(claims.getSubject());
        AppUser user = userMapper.selectById(userId);
        if (user == null || user.getStatus() != 1) {
            throw BizException.unauthorized("账号不可用");
        }
        Tenant tenant = tenantMapper.selectById(user.getTenantId());
        String access = jwtService.issueAccessToken(user.getId(), tenant.getId(), tenant.getInviteCode(), user.getRole());
        String refresh = jwtService.issueRefreshToken(user.getId(), tenant.getId(), tenant.getInviteCode(), user.getRole());
        return new LoginResponse(access, refresh, jwtService.getAccessTtlSeconds(), toUserInfo(user, tenant));
    }

    public LoginResponse.UserInfo me(Long userId) {
        AppUser user = userMapper.selectById(userId);
        if (user == null) {
            throw BizException.unauthorized("用户不存在");
        }
        return toUserInfo(user, tenantMapper.selectById(user.getTenantId()));
    }

    private LoginResponse.UserInfo toUserInfo(AppUser user, Tenant tenant) {
        return new LoginResponse.UserInfo(
            user.getId(), user.getUsername(), user.getNickname(), user.getAvatar(), user.getRole(),
            tenant.getId(), tenant.getInviteCode(), tenant.getName());
    }

    private void bindDevice(Long userId, LoginRequest req) {
        Device device = deviceMapper.selectOne(new LambdaQueryWrapper<Device>()
            .eq(Device::getAppUserId, userId)
            .eq(Device::getDeviceId, req.deviceId()));
        LocalDateTime now = LocalDateTime.now();
        if (device == null) {
            device = new Device();
            device.setAppUserId(userId);
            device.setDeviceId(req.deviceId());
            device.setDeviceName(req.deviceName());
            device.setOsVersion(req.osVersion());
            device.setLastLoginAt(now);
            deviceMapper.insert(device);
        } else {
            device.setLastLoginAt(now);
            device.setDeviceName(req.deviceName());
            device.setOsVersion(req.osVersion());
            deviceMapper.updateById(device);
        }
    }
}
