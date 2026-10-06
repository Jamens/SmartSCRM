# B10 云手机（VMOS 管理 + 模拟拉流）设计

> 日期：2026-10-06 · 阶段：P12 · 来源 backlog：`| B10 | 云手机（VMOS 管理 + 模拟拉流） | P12 |`
> 两个架构性岔路已与用户确认（AskUserQuestion）：
> 1. **集成模式 = 自托管抽象 + 模拟拉流**（不接真实 VMOS，符合开源红线：默认不接商业云）。
> 2. **首版范围 = 管理 + 模拟拉流视图**（设备 CRUD + 状态 + 一个能看「屏幕」的模拟拉流视图；**不含**启动/停止/重启控制动作）。

## 1. 定位与边界

- B10 是**设备管理 + 可视化**模块，自身定义一套云手机抽象（`provider`/`host`/`status`/`specs`），
  **v1 不接任何真实云手机服务**。后端只存设备记录；「拉流」在前端用 **canvas 模拟渲染**（假的手机屏），
  不拉真实 RTSP/WebRTC。
- 开源红线：绝不硬编码/默认指向商业云 `*.smart-scrm.com` 或 VMOS 网关。`host` 字段由部署方自填，
  代码只留存储位，**v1 不消费 host**（不发起任何外连）。真实 provider 接入留作后续阶段。
- 与 B21 云账号池**互不阻塞**：B21 是「云号 → 本地视图导入」，B10 是「设备管理 + 拉流」，
  两者同阶段但无依赖（backlog 已注明）。

## 2. 数据模型

表 `cloud_phone`（迁移 V36，tenant 隔离）：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | BIGINT PK auto | |
| `tenant_id` | BIGINT NOT NULL | 租户隔离，取自 JWT |
| `name` | VARCHAR(64) NOT NULL | 设备别名 |
| `provider` | VARCHAR(32) NOT NULL DEFAULT 'generic' | 厂商占位：`generic` / `vmos`（v1 仅展示，不消费） |
| `host` | VARCHAR(255) NULL | 连接地址（真实 provider 用，v1 不消费、不发起外连） |
| `status` | VARCHAR(16) NOT NULL DEFAULT 'offline' | `offline`/`booting`/`online`/`error` |
| `android_version` | VARCHAR(32) NULL | 规格 |
| `resolution` | VARCHAR(16) NULL | 规格，如 `1080x1920` |
| `stream_seed` | INT NOT NULL DEFAULT 1 | 模拟拉流的确定性种子（每设备稳定，决定渲染图案） |
| `remark` | VARCHAR(255) NULL | |
| `create_time` | DATETIME | |
| `update_time` | DATETIME | on update |

**状态机（spec §5，v1 简化）**：`status` 在 v1 是**表单可设字段**，不自动流转（无控制动作）。
模拟拉流只据此渲染：
- `online` → canvas 播「手机屏」动画（状态栏时间、 App 网格、随 `stream_seed` 变的主题色、轻微动效）。
- `booting` → 「启动中」占位。
- `offline` → 灰「未连接」。
- `error` → 红「连接失败」。

> 注：因 v1 无启动/停止控制，`online` 由用户在表单里置位即可演示拉流；控制动作（boot/reboot/shutdown
> 触发真实状态流转）留作后续阶段，届时再上 `@Scheduled` 或 WebSocket 推送。

## 3. 接口（A16 判定）

路径 `/api/cloud-phones`，租户取自 JWT：

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/` | `cloudphone:read` | 列表（按 tenant 过滤，建时间倒序） |
| POST | `/` | `cloudphone:write` | 新建 |
| PUT | `/{id}` | `cloudphone:write` | 改 |
| DELETE | `/{id}` | `cloudphone:write` | 删（校验归属，非本租户 404） |

VO：`CloudPhoneVO`（含全部列；前端自己映射 status 文案/色）。

**拉流无后端端点**——纯前端 canvas。

### 权限播种（V37，仿 V30）

- `sys_menu` 插 `cloudphone`(父 `biz`) / `cloudphone:read`(父 `cloudphone`) / `cloudphone:write`(父 `cloudphone:read`)。
- 授予：`super_admin` 走 CROSS JOIN 拿全量；`tenant_admin` 拿 `cloudphone` / `cloudphone:read` / `cloudphone:write` 三码。
- 幂等：`INSERT IGNORE ... SELECT`，重跑不重复。

## 4. 前端（P12-3）

`pages/CloudPhonePage.tsx` + `api/cloudPhone.ts`：

- 设备表格：名称 / 厂商 / host / 状态徽章 / 规格（android 版本 · 分辨率）。
- 新建/编辑弹窗：name(必填)、provider(select)、host(可选)、androidVersion、resolution、status(select)、streamSeed(数字，默认随机)、remark。
- **模拟拉流视图**：选中设备 → 右侧/下方 canvas 按其 `status`+`stream_seed` 渲染假手机屏。
  用 `requestAnimationFrame` 画状态栏（实时时钟）、App 网格、随 seed 变的主题色；非 online 显示对应占位。
- 删除走**二次确认**（破坏性动作，与今天 B18/B19/B9/B20 纪律一致）。
- 路由 `/cloud-phone` + 侧栏入口（图标 `Smartphone`）+ 8 语 i18n。

## 5. 易错点 / 纪律

- **开源红线**：`host` 只存不用，v1 不发起任何外连；绝不默认指向商业云。
- **租户隔离**：所有查询/删除带 `tenant_id`，跨租户 404（仿 B20 单测）。
- **权限码**：新 authority 必须播种到 `tenant_admin`，否则 admin 调用 403（用 V30 同款模板）。
- **i18n**：8 语全补，漏一个 typecheck 红。
- **模拟拉流确定性**：用 `stream_seed` 而非 `Math.random`，保证同设备渲染稳定可复现。

## 6. 验收

- 后端单测：租户隔离、跨租户 404、缺 name 400、删除幂等/归属校验。
- 门禁：后端 `./mvnw -o test` + desktop 四路 typecheck + test:unit + lint 0 error。
- UI 端到端（CDP 页内 `el.click()` 驱动）：建设备 → 表格出现 → 选设备看模拟拉流（online 出动画、offline 占位）→ 删除二次确认后消失。
