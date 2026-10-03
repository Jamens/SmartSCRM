# 管理端（Admin Console）设计文档

- 日期：2026-10-04
- 状态：设计已确认，待实施
- 关联清单项：A16（RBAC）、B22（团队/子账号）、B11（报表）、B12（套餐门控）、A8（风控）、B13（代理池）

## 1. 背景与目标

SmartSCRM 现为单一形态产品：Electron 桌面客户端（`apps/desktop`），面向**操作者执行视角**——聊天、客户、翻译、群发。系统从设计之初就是多租户的（`tenant` 表 + 13 个 Service 内的租户隔离），但**缺少平台经营视角**：没有租户管理界面、没有角色权限、没有跨租户可见性、没有套餐门控。

本次新增 `apps/admin`（React + TypeScript Web 管理端），补齐平台经营侧能力，并与桌面端**共享同一后端与数据层**。

### 1.1 一期范围

- 平台管理员登录与身份识别
- 租户管理（列表、详情、启停、到期、配额）
- 租户管理员登录
- 完整 RBAC（角色、菜单、按钮级权限）
- 团队与子账号管理

### 1.2 明确不在一期范围

- 套餐定义与激活码兑换（B12 后续期）
- 跨租户报表（B11 后续期）
- 敏感词与内部风控（A8 后续期）
- 代理池管理（B13 后续期）
- 工单 / 线索 / 官网注册（清单外新域）

## 2. 架构决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| 1 | 身份模型 | 平台 + 租户双层 | `scope` 区分 PLATFORM/TENANT；平台管理员无 `tenantId` |
| 2 | 跨租户实现 | 平台侧 `admin/` 包完全独立 | 现有 400+ 处手写隔离一行不改，零回归风险 |
| 3 | 权限模型 | 菜单即权限 + BUTTON 隐藏节点 | 见§3.2 |
| 4 | 权限存储 | 每次请求查库 | 零新依赖，撤权即时生效 |
| 5 | 组件选型 | Ant Design 5 | Table/Form/Tree 开箱即用 |
| 6 | `scrm_user.role` | 改名 `legacy_role` + 新增关联表 | 保留兜底，可回滚 |

### 2.1 为什么平台侧要完全独立

现有租户隔离是**手写散落**的：`tenantId` 出现在 13 个 Service 共 400+ 处（`TranslationService` 72 / `BatchSendService` 65 / `QuickReplyService` 41 / `MessageQueryService` 39 / `GroupMemberService` 33 等），每处自行 `eq(tenantId)`，**没有统一拦截点可供豁免**。

管理端需要跨租户读数，若复用现有 Service，要么逐处加豁免开关（400+ 次改动，高回归风险），要么先做租户隔离重构（大工程）。因此平台侧另写 `admin/` 包：独立 Controller + 独立查询 SQL（不带 `tenantId` 条件），直接复用 `tenant` / `scrm_user` 等既有表。

代价是跨租户聚合统计 SQL 需重写——但这些统计的维度本就与租户侧不同（全局 vs 单租户），重写不可避免。

**未来演进**：若多租户隔离本身需要重构（性能或统一治理），可再考虑 MyBatis-Plus `TenantLineInnerInterceptor` 或统一 Repository 基类，届时 `admin/` 包的独立实现也是迁移的天然边界。

## 3. 权限模型

### 3.1 数据模型

全部新建表，**不动 `tenant` / `scrm_user`**，因此无需数据迁移，不影响桌面端现有查询。

| 表 | 关键字段 | 说明 |
|---|---|---|
| `sys_menu` | `id`, `parent_id`, `name`, `code`, `type`, `path`, `icon`, `sort`, `visible` | `type` ∈ DIR / MENU / BUTTON；`code` 全局唯一 |
| `sys_role` | `id`, `tenant_id`, `name`, `code`, `scope`, `builtin` | `scope` ∈ PLATFORM / TENANT；`builtin=1` 禁止删除 |
| `sys_role_menu` | `role_id`, `menu_id` | 联合主键 |
| `sys_team` | `id`, `tenant_id`, `name`, `parent_id`, `leader_user_id` | 树形，支持嵌套 |
| `sys_user_role` | `user_id`, `role_id` | 联合主键 |
| `sys_user_team` | `user_id`, `team_id` | 联合主键 |

`scrm_user.role` → 重命名 `legacy_role` 保留兜底；桌面端登录态改读 `sys_user_role`，行为等价，出问题可立刻回滚。

已核验：桌面端仅在 8 个 i18n 文件的 `identityLine` 消费 role，**无任何权限判定逻辑**，回归面可控。

### 3.2 菜单即权限的必需补丁

纯菜单树打勾存在致命缺口：**后端无从校验**。前端隐藏菜单后，用户改 URL 直打接口即可绕过。

补丁：菜单节点携带稳定 `code`，树中允许 `type=BUTTON` 的**隐藏节点**（不渲染进侧边栏），专供后端 `@PreAuthorize` 引用。

```
菜单节点 · code = customer:export  (type = BUTTON，不进侧边栏)
   ├── 前端：按钮级守卫 — code 不在集合内则不渲染
   └── 后端：@PreAuthorize — 改 URL 直打则 403
```

同一 `code` 两个消费方，从设计上杜绝"前端藏了后端没拦"的权限双写。形态仍是树形打勾，但同一页面内的查看 / 导出 / 删除可分开授权。

**权限判定链路**：
- 前端：登录响应返回 `menuCodes` 集合 + 菜单树 → `guard.tsx` 控制路由与按钮渲染
- 后端：拦截器查库填充 `AuthPrincipal.menuCodes` → `@PreAuthorize("hasAuthority('tenant:view')")`

## 4. 认证链路改造

这是唯一触及现有代码的部分。**原则：桌面端行为逐字节不变。**

### 4.1 JWT payload

```
{ sub: userId, tid: tenantId?, ic: inviteCode, role: string, typ: "access" }
                    ↑ 可选（平台管理员无此 claim）
```

`menuCodes` **不进入 JWT**（见 §4.3）。

### 4.2 核验发现的 3 个必修点

1. **`JwtAuthFilter.java:34` 会 NPE** — `claims.get("tid", Number.class).longValue()` 在 claim 缺失时抛空指针。平台管理员必然无 `tid`，必须改为可空取值。
2. **`SecurityConfig` 未开 `@EnableMethodSecurity`** — 设计的 `@PreAuthorize` 当前不生效，必须先补该注解。已核验现有代码零命中，添加无语义副作用。
3. **refresh 路径必须重新查库** — 否则管理员撤销权限后，用户持旧 refresh token 换新 token 时**权限复活**。这是真实安全缺陷。

### 4.3 TTL 变更及其连锁影响

`application.yml` 调整：

| 配置 | 原值 | 新值 | 说明 |
|---|---|---|---|
| `access-ttl-seconds` | 7200（2h） | 604800（7d） | 用户明确要求 |
| `refresh-ttl-seconds` | 2592000（30d） | 5184000（60d） | refresh 必须长于 access |

**连锁影响**：access TTL 改为 7 天后，权限若放入 JWT，撤权将延迟 7 天生效——不可接受。因此**权限改为每次请求查库**（§3.2），换来零新依赖 + 撤权即时生效。

`refresh` 必须长于 `access`：否则用户第 8 天会被强制登出，原本 refresh token 静默续期的体验退化。

### 4.4 鉴权落点

权限查询逻辑**不放进 `JwtAuthFilter`**，保持其"无状态凭据解析器"职责：

```
请求 → JwtAuthFilter（仅解析 token，不查库）
     → AdminPermissionInterceptor（查库，填充 menuCodes；/api/admin/** 前缀短路）
     → Controller（@PreAuthorize 校验）
```

桌面端请求不触碰管理端菜单表，性能与行为零影响。

权限查询用**一条 join SQL** 完成（`PermissionMapper.selectMenuCodesByUserId`），而非朴素的两步关联查询。

## 5. 前端结构

### 5.1 技术栈

平移 `apps/desktop` 现有依赖，不引入第二套：react-query、zustand、react-router-dom、Tailwind v4、lucide-react。共享登录态与权限判定的 TS 类型。

`pnpm-workspace.yaml` 为 `apps/*` 自动纳入，创建 `apps/admin` 零配置改动。

### 5.2 组件选型理由

选 **Ant Design 5**：一期最核心的两个页面是租户列表（Table + 筛选 + 分页）与角色权限编辑（Tree 父子半选穿梭）。AntD 的 `Tree checkStrictly={false}` 一行搞定父子半选；shadcn/ui 需手写递归 + 受控 checked + 半选联动，易出边界 bug。

代价是与 desktop 的 shadcn/ui 视觉不一致。判断为可接受——管理端是独立 Web 产品，与桌面客户端是不同使用场景，无需像素级一致。

后续若确认为割裂，可折中：AntD 仅用 Table/Form/Tree，页面骨架改用 Tailwind 自写。此优化不在一期。

### 5.3 目录结构

```
apps/admin/src/
├── main.tsx              # 复用 desktop 的 QueryClient 配置
├── router.tsx            # 路由 + 守卫
├── auth/
│   ├── store.ts          # zustand：登录态 + menuCodes
│   └── guard.tsx         # <RequireCode code="tenant:view">
├── components/
│   └── TreeSelect.tsx    # 权限树（AntD Tree 封装）
└── pages/
    ├── Login.tsx         # 双身份识别，登录后分流
    ├── TenantList.tsx
    ├── RoleList.tsx
    ├── RoleEdit.tsx      # 权限树勾选 — 本期唯一技术难点
    ├── TeamList.tsx
    └── UserList.tsx
```

`guard.tsx` 使前端隐藏与后端 403 共用同一套 code。

## 6. 一期页面清单

| 页面 | 关键交互 | 难度 |
|---|---|---|
| Login | 双身份识别，分流首页 | 中 |
| TenantList | 列表、启停、到期、配额 | 低 |
| RoleList | CRUD，内置角色禁删 | 低 |
| RoleEdit | 权限树勾选（父子半选 + BUTTON 节点） | **高** |
| TeamList | 树形 + 成员分配 | 中 |
| UserList | 成员分配角色与团队 | 中 |

## 7. 实施顺序

1. **后端地基** — `@EnableMethodSecurity`、`AuthPrincipal` 扩展、`JwtAuthFilter` 修 NPE、TTL 配置调整
2. **建表 + 种子数据** — 6 张新表 + 菜单树种子 + 内置角色
3. **后端 admin 包** — 租户管理、角色管理、团队管理 API
4. **前端骨架** — `apps/admin` 初始化、登录、路由守卫
5. **页面** — TenantList → RoleList → RoleEdit → TeamList → UserList
6. **refresh 权限重查** — §4.2 第 3 点

## 8. 验证门禁

沿用项目现有纪律：

- 五路 `pnpm typecheck`（node / web / desktop / admin / server）
- `pnpm test:unit`
- eslint 0 error
- **新增**：`AdminPermissionInterceptor` 单元测试（覆盖平台/租户/无权限三种路径）
- **新增**：NPE 回归测试（无 `tid` 的 token 必须正常解析）
- 单功能单 commit，提交排除 `.workbuddy/`
