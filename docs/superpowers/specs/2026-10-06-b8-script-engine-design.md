# B8 炒群引擎 设计（2026-10-06 扩 spec）

> backlog 明确标注 B8「**大 / 需 spec / 数据模型需另起 spec**」，所以本文件先把数据模型与调度
> 架构定死，再分段实现（与 B28 同一流程：spec → 分段落地）。
>
> 范围一句话：**按「角色库 + 剧本」自动对目标群做一组动作（发言/私聊/…），由 Java 侧 loop 调度，
> 支持多账号 failover 与断点续跑。**
>
> 与 batch-send（B7）的关系：B7 是"向一批人发同一条消息"，一次性、有序、可撤回；B8 是"长期按剧本
> 对一批群做多步动作"，循环、可暂停续跑、跨账号容错。**两者共用同一套底座口径**（任务/明细状态机、
> 心跳、幂等键），但**调度位置不同**——见 §4。

## §1 范围与不做

**做**（本期）
- **角色库三级**：品类 → 角色 → 动作模板（如 `种草/测评` → `素人种草` → 「进群自我介绍话术」）。
- **剧本**：一个有序动作序列（每步 = 一个动作类型 + 参数），绑定角色库里的角色。
- **loop 调度（Java）**：按间隔把剧本投到目标群，每步有独立状态。
- **failover**：任务绑多个账号，主账号失败自动切下一个。
- **断点续跑**：按目标群记进度，中断后从断点继续，不重复已完成的步。

**不做**（明确排除）
- **不做实际群操作**（B18 加群 / B19 踢人是独立模块；B8 只负责**编排与派发**，真正"动手"由
  桌面端执行器 + 后续 B18/B19 完成）。本期执行器只落"派发记录"，不真调 wa-js。
- 不做复杂 DAG/条件分支剧本（本期剧本是**线性有序**动作序列）。
- 不做素材/话术编辑器（用现成 B4 素材库 / B3 快捷回复；spec 只存引用 id）。
- 不外连商业云（沿用红线；无外部 AI 依赖）。

## §2 术语与角色库三级
- **品类（category）**：群的粗分类（`种草` / `测评` / `私域`）。
- **角色（role）**：该品类下的具体人设（`素人种草` / `专业测评`），带 prompt/语气。
- **动作模板（actionTpl）**：该角色执行某动作时的默认参数（话术引用、频率上限）。

三级引用：`剧本 → 角色(role) → 品类(category)`；动作模板挂在角色下。

## §3 数据模型（核心——backlog 说"数据模型需另起 spec"，这里落定）

### 3.1 角色库（三级）
`script_role`（角色）
- `id`、`tenant_id`
- `category_id` BIGINT 归属品类
- `name`、`prompt` TEXT 人设提示词
- `enabled` TINYINT、`sort`
- `uk(tenant_id, category_id, name)`

`script_role_category`（品类）
- `id`、`tenant_id`、`name`、`sort`
- `uk(tenant_id, name)`

`script_action_tpl`（动作模板，挂角色下）
- `id`、`tenant_id`、`role_id`
- `action_type` VARCHAR（见 §5 动作词表）
- `name`、`params` JSON（话术引用/数量等）
- `enabled`

### 3.2 剧本与调度
`script_playbook`（剧本）
- `id`、`tenant_id`
- `role_id` BIGINT 用哪个角色
- `name`、`enabled`
- `loop_interval_sec` INT loop 间隔（秒）
- `account_ids` JSON 有序账号列表（**failover 顺序**）

`script_playbook_step`（剧本的一步，一个动作）
- `id`、`tenant_id`、`playbook_id`
- `seq` INT 步骤序号
- `action_type`、`params` JSON
- `uk(playbook_id, seq)`

### 3.3 任务实例（一次执行 = 一个目标群）
`script_task`（对某个群跑某剧本）
- `id`、`tenant_id`、`playbook_id`、`account_id`（当前主账号）
- `target_chat_key` VARCHAR、`target_group_id`
- `status` VARCHAR —— 与 batch-send 同一条词表：`pending|running|paused|done|error|cancelled`
- `current_step` INT 当前到第几步（**断点**）
- `attempts` INT、`last_error` VARCHAR
- `next_run_at` DATETIME（**loop 下次触发**）
- `heartbeat_at`、`created_at`、`updated_at`
- `uk(tenant_id, playbook_id, target_chat_key)` —— 同群同剧本**幂等**，不重复建任务

`script_task_step`（任务里每一步的执行记录，断点续跑的粒度）
- `id`、`tenant_id`、`task_id`
- `seq` INT、`action_type`
- `status` VARCHAR：`pending|sending|success|failed|skipped`
- `error_code`、`error_detail`、`msg_key`
- `uk(task_id, seq)`

### 3.4 动作词表（action_type，`shared/scriptActions.ts` 单一来源）
`post_message`（群发言） / `dm_member`（私聊成员） / `join_group`（占位，接 B18）/ `kick_member`（占位，接 B19）/ `react`（表情回应）。

## §4 调度架构（**在 Java**——与 B7 不同）
- **B7 的泵在 Electron 主进程**（`services/batchSend/engine.ts` 驱动发送）。B8 不复制那套；
  **Java 侧持一个调度器**：按 `next_run_at` 到期的 `script_task`，推进一格 step 并派发。
- **派发通道**：Java → 桌面端（本轮只落 `script_task_step.status='sending'` + 一条待认领记录，
  真执行由后续 B18/B19 + 执行器接）。桌面端上报 step 结果 → Java 推进 `current_step`。
- **心跳/健康**：桌面端定期 heartbeat（复用 B7 心跳口径）；心跳超时的 task 由调度器判 error。
- **loop**：`next_run_at = now + loop_interval_sec`，一轮跑完所有 step 后重置 `current_step=0` 再排下一次。

### failover
- task 首选 `account_ids[0]`；当前账号连续 `attempts >= N` 或 step 连续失败 → 切下一个账号，
  `attempts` 归零；账号用尽 → task `error`。
- 切账号**不重置 `current_step`**——换号接着跑断点。

### 断点续跑
- 进度粒度 = `script_task_step`（每步一行）。恢复时从 `current_step` 起，只补 `pending` 步；
  `success` 的步不重跑。

## §5 纯规则（`shared/scriptActions.ts`，配 node --test）
- `SCRIPT_ACTIONS`：动作词表 + 每项默认参数 + 是否需要目标（群/成员）。
- `nextStep(statuses)`：给定一批 step 状态，返回下一个该跑/该补的 seq（断点推进口径，纯函数可单测）。
- `failoverAccount(accountIds, currentIdx)`：下一账号口径。

## §6 分期（每段单 commit）
1. **P9-1 数据层**：V2x 三级角色库 + 剧本/步骤 + 任务/步骤实例 + `shared/scriptActions.ts` + 后端 CRUD。地基。
2. **P9-2 调度器**：Java loop 调度（到期推进）+ 心跳 + failover + 断点续跑，落到 step 状态。
3. **P9-3 前端**：角色库/剧本编辑 + 任务面板（跑批的"本地自动化任务面板"B20 复用它的任务视图）。
4. 后续：接 B18/B19 的真执行（`join_group`/`kick_member` 派发到桌面端执行器）。

## §7 验收面
- 迁移 V2x 重跑不报错（幂等）。
- 纯规则单测：`nextStep`（含断点/失败推进）、`failoverAccount`、动作词表。
- 后端单测：任务幂等（同群同剧本不重复建）、状态机 canMove、failover 切号、断点续跑不重跑成功步。
- 端到端（接 CDP 时）：建角色库三级 → 建剧本 → 起 loop 调度 → 任务推进 + 断点续跑。

## §8 陷阱
- **幂等靠 `uk(tenant_id, playbook_id, target_chat_key)`**：loop 会反复扫到期任务，没有这个唯一键
  就会把同一个群建出 N 个任务。
- **调度在 Java 不在主进程**：别把 B7 的 engine.ts 复制一份过来——两条链的运行位置不同（B7 泵在
  Electron，B8 调度在 Java），混了会出现"两个泵抢同一任务"。
- **failover 不重置断点**：换号接着跑；重置会让已完成的步重跑（发重复消息）。
- **心跳超时判 error**：长时间没心跳的任务不能永远 running 卡住调度。
- **`params` 存 JSON**：话术/数量等参数走 JSON 字段，不为每个动作建列（动作词表会扩）。
