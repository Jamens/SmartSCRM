# 凭据管理说明

> 2026-10-18 建立。此前 `application.yml` 里的数据库口令与 JWT 签名密钥曾以明文提交进 git，
> 且仓库为公开仓库（`Jamens/SmartSCRM`）。本文记录当前口径与已发生的处置。

## 一条硬规矩

**仓库里不出现任何真实凭据。** 口令、密钥、token 一律走环境变量注入或本地私有文件。

这不是风格偏好。2026-09-18 起，`apps/server/src/main/resources/application.yml` 里的
DB 口令与 JWT 密钥以明文躺在公开仓库里，直到 2026-10-18 才移除。中间近一个月，任何人
都能看到并使用它们。

## 当前配置口径

`application.yml` 只声明变量名，不给兜底值：

```yaml
spring:
  datasource:
    password: ${SCRM_DB_PASSWORD:}
app:
  jwt:
    secret: ${SCRM_JWT_SECRET:}
```

`JwtService` 对密钥做显式校验：为空或短于 32 字节（HMAC-SHA 的硬性要求）即拒绝启动，
并抛出说明如何生成的人话错误。**刻意不给默认值**——一个可预测的弱密钥等于没有鉴权，
宁可启动失败也不要用。

## 本地开发

```bash
cp apps/server/src/main/resources/application-local.yml.example \
   apps/server/src/main/resources/application-local.yml
# 填入自己的口令与密钥

openssl rand -base64 48     # 生成合规的 JWT 密钥
```

`application-local.yml` 已被 `apps/server/.gitignore` 忽略。

**注意**：Spring Boot 只在 profile 为 `local` 时才读 `application-{profile}.yml`，
文件名带 `local` **不等于**自动加载。要么用 `--spring.profiles.active=local` 启动，
要么用 `scripts/dev-server.sh`（它从该文件读值注入环境变量）。

## 2026-10-18 已完成的轮换

| 项 | 处置 | 验证 |
|---|---|---|
| DB 口令 | 新生成 28 位随机串，`root@localhost` 与 `root@%` 两个账号都已改 | 旧口令 `Access denied`，新口令可连 |
| JWT 密钥 | 10-13 移除明文时已换新（旧值从未进入本地配置） | `SCRM_JWT_SECRET` 长度 48，HMAC-SHA 要求 ≥32 |

轮换已完成，**旧凭据全部失效**——这才是关键。git 历史里的明文保留着，但那些值已无法
用于访问任何系统。

## 历史里的明文（已知，不处理）

以下文件仍含已失效的旧口令：

- `docs/superpowers/plans/2026-09-*.md` 等 8 份历史实施计划
- `apps/server/src/test/java/.../JwtAuthFilterTest.java`（测试用固定密钥）

它们是**当时的方案记录**，改写会扭曲文档原貌；测试里的固定密钥是刻意的（单测需要
可预测的输入）。口令既已失效，保持原样即可。

若将来确实需要彻底抹除（438 个提交全量重写 + force push，所有人需重新 clone，
且 GitHub 的缓存与 fork 仍可能保留旧值），用 `git filter-repo` 处理：

```bash
git filter-repo --replace-text <(echo 'literal:旧值==>***REMOVED***')
```

## 排查口径

启动报 `SCRM_JWT_SECRET 未配置` 时，先确认变量已注入，再确认长度 ≥32 字节。
见 `scripts/dev-server.sh` 的前置校验。
