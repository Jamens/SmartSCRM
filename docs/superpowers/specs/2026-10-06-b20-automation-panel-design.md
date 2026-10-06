# B20 本地自动化任务面板 设计（2026-10-06 扩 spec）

> backlog 标 B20「需 spec / **宜排在 B8/B9/B18/B19 之后——它管的就是那些任务，先有任务才有面板**」。
> 那四类现在都在库里了（B8 剧本任务、B9 养号、B18 加群、B19 踢人），B20 可以做了。
>
> 范围一句话：**一个总览面板，把账号状态 + 四类自动化任务的状态汇总到一起，并提供批量操作。**

## §1 它到底管什么（backlog 三个词的准确口径）

| 词 | 口径 |
|---|---|
| **状态总览** | 账号维度（总数/在线/按平台分布）+ **四类任务**的状态计数（各有多少在跑/待确认/失败） |
| **批量关闭** | 停账号（`status=0`）+ **停掉这些账号上正在跑的任务**（可恢复，不删数据） |
| **批量删除** | 删账号，**删前先停其上任务**（§5），不可逆 |

**关键点**：B20 本身**不新增任何任务表**。它是**跨模块只读聚合 + 账号批量操作**的视图层。
四类任务各有自己的表与状态机（B20 不改它们），B20 只读 + 发起"停/删"。

## §2 四类任务来源（只读聚合）

| 来源 | 表 | 状态词表 | 账号关联字段 |
|---|---|---|---|
| B8 剧本任务 | `script_task` | pending/running/paused/done/error/cancelled | `account_id`（当前主账号） |
| B9 养号计划 | `nurture_plan` | 同上（+confirmed） | `account_ids`（JSON 数组，**多账号**） |
| B18 加群任务 | `group_join_task` | 同上 | `account_id` |
| B19 踢人任务 | `group_kick_task` | 同上 | `account_id` |

- B8/B18/B19 是**单账号**（`account_id`），B9 是**多账号**（`account_ids` JSON）——统计"某账号挂几个任务"
  时 B9 要**解析数组**，不能当标量比。这是 B20 唯一容易算错的地方（§8）。
- 只统计 `tenant_id` 本租户；已 `cancelled` 的不计入"在跑"。

## §3 数据流与分工
- **Java 侧聚合**：`AutomationService` 一次查出账号列表 + 四类任务计数（避免前端发 5 个请求）。
- **停/删动作**：仍走各模块自己的 Service（`BatchSendService`/`NurturePlanService`/
  `GroupJoinService`/`GroupKickService` 的 cancel），**B20 不直接改别人的表**——跨模块写操作
  走对方服务，保持各自状态机与人工门不被绕过。
- **注入层**：批量关闭要真的停账号对应的 view（主进程已有账号管理链路，复用）。

## §4 接口
- `GET /api/automation/overview` → 账号状态汇总 + 四类任务状态计数（一次拿齐）。
- `GET /api/automation/accounts` → 账号列表 + 每个账号挂的任务计数（供表格渲染）。
- `POST /api/automation/accounts/close` → **批量关闭**：`{accountIds, stopTasks:true}` → 停账号 + 停其上任务，返回停掉的任务数。
- `POST /api/automation/accounts/delete` → **批量删除**：`{accountIds}` → **先停任务再删账号**，返回 `{deletedAccounts, stoppedTasks}`。

## §5 删除前必须停任务（已裁定）
删账号而任务还在被 `@Scheduled` 驱动 → 对**不存在的 view** 派发，日志刷报错且行为不可预期。
所以删除流程固定为：**收集该账号上所有非终态任务 → 逐个 cancel → 再删账号**。
关闭同理（关了账号，任务也不该继续跑）。二者都返回"停了几个任务"让操作者知情。

## §6 纯规则（`shared/automation.ts`，配 node --test）
- `countTasksByAccount(tasks, accountId)`：**同时吃标量 accountId 与 JSON 数组 accountIds**（B9 多账号），
  返回该账号命中的任务数。这是 §2 那处易错点的落点，必须单测钉死。
- `aggregateTaskStatus(tasks, kinds)`：按来源 + 状态交叉计数（面板表格的数据源）。
- `shouldStopBeforeDelete(hasActiveTasks)`：有在跑任务时删除必须先停（纯判定，便于单测）。

## §7 分期（体量小，一段做完）
1. **数据层 + 接口**：V36 无新表（只读聚合）；`AutomationService` + `/api/automation/*` + `shared/automation.ts` + 单测。
2. **前端**：总览卡（账号状态 + 四类任务计数）+ 账号表格（批量勾选/关闭/删除，删除带预览确认）+ 8 语。

## §8 陷阱
- **B9 是多账号**：统计"某账号挂几个任务"必须解析 `account_ids` JSON 数组；拿标量 `account_id` 比会漏掉 B9。
- **别在 B20 里直接 UPDATE 别人的表**：停任务调各模块 Service（`cancel`），保持它们的人工门与状态机。
- **删除前先停任务**（§5），否则孤儿任务对着不存在的 view 派发。
- **面板是只读聚合**：B20 自身不新增任务表，统计口径来自各模块已有表，模块改了状态词表这里要跟着改。
- **关闭 ≠ 删除**：关闭可恢复（停账号+停任务，数据留着）；删除不可逆，UI 要二次确认并显示将停掉的任务数。

## §9 验收面
- 纯规则单测：`countTasksByAccount`（标量 + JSON 数组两种形态）、`aggregateTaskStatus`、`shouldStopBeforeDelete`。
- 后端单测：overview 聚合正确、批量关闭停任务、批量删除先停后删、跨租户隔离。
- 端到端（接 CDP 时）：勾选账号 → 关闭 → 状态总览变化；删除带预览确认 → 任务被停 → 账号消失。
