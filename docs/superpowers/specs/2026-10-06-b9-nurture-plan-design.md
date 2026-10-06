# B9 互聊养号 设计（2026-10-06 扩 spec）

> backlog 标 B9「**需 spec** / 日程调度用 worker-thread」。本 spec 定案后按 P10-x 分段实现。
>
> 范围一句话：**一批账号进同一个群，按可复现的日程在群里轮流发言**——让群"看起来是活的"，
> 顺带把各账号自己养热（发言历史、活跃度）。
>
> **与相邻模块的分工**（这是 B9 最容易搞混的地方）：
> | 模块 | 形态 | 谁发言 |
> |---|---|---|
> | B7 群发 | 一个账号 → 多个联系人/群 | 单账号 |
> | B8 炒群 | 一个账号 → 一个目标群，跑剧本 | 单账号 |
> | **B9 互聊养号** | **多个账号 → 同一个群** | **多账号轮流** |
>
> 也就是说 B9 的本质是"多账号在同群并发发言"，不是"一个号发很多条"。

## §1 引擎能力（实测 wa-js 4.x，路径 `dist/chat|group/functions/`）

| 能力 | 签名 | B9 怎么用 |
|---|---|---|
| 群发消息 | `chat.sendTextMessage(to: string, content: string, options?)` | 每个账号用**自己的 view** 各发一条 |
| 拉人进群 | `group.addParticipants(groupId, ids)` | 备群阶段把 N 个账号拉进同一群 |
| 建群 | `group.create(...)` | 需要新群时（可选，见 §4） |

**关键前提**：一个 `PlatformAccount` = 一个 `viewId`（实体字段），即**每个账号一个独立
WebContentsView**。所以"N 个账号在同一个群发言"= N 个 view 各发一条，与 B7 的单 view 群发
是不同链路，别复用 B7 的执行器。

## §2 范围与不做

**做**
- **养号计划（plan）**：一个计划 = 一个目标群 + 一批账号 + 日程配置 + 话术池。
- **装箱算法**：N 个账号怎么进群、每轮谁发言（§3）。
- **可复现日程**：每天固定时间点起若干轮、轮内间隔、**同 seed 同日程**（§3）。
- **备群**：按需建群/拉人（把账号凑进同一群），复用 B18 的 `addParticipants`。
- **执行**：Java `@Scheduled` 驱动（与 B8 一致），注入层 wa-js 真发消息。

**不做**
- 不做真人的"看到就回"（那是 AI 自动回复，不属养号）。
- 不做跨平台混编（一个群内账号必须同平台——群 chat_key 属于某个平台）。
- 不做绕过 B18 人工门去加群（拉人进群沿用 B18 的门）。
- 不做云端下发（本条链全本地，见 §7 形态裁定）。

## §3 装箱算法与可复现日程（核心）

### 3.1 装箱：`packAccounts(accountIds, perGroup)`
把 N 个账号按平台分组后装箱进群：`perGroup` = 每群容纳几个账号。
- **同平台才可同群**（群 chat_key 属某平台），跨平台账号分属不同群。
- 装箱顺序 = `accountIds` 的**稳定排序**（按 id 升序），不依赖集合迭代顺序——
  否则同一批账号两次装箱结果不同，"可复现"就无从谈起。
- 尾箱不足 `perGroup` 也成一群（不丢弃账号）。

### 3.2 日程：`planSchedule(...)`
每天的日程 = 一组**固定时间点**（`at: "09:30"`）+ 每点若干轮。同 seed 同配置必得同序列。
- 轮内发言账号顺序 = 装箱结果内的**可复现洗牌**（同 seed 的 LCG，不用 `Math.random`——
  理由同 B18：断点续跑要能接着来，随机数不可复现就断了）。
- 每次发言间隔 = `base ± jitter`（同 B18 口径：固定间隔本身是风控指纹）。
- 成员数上限：群内并发发言账号数（`speakingRounds`），避免刷屏。

纯函数放 `shared/nurturePlan.ts`（`packAccounts` / `planSchedule` / `speakingOrder`），配 node --test。

## §4 群与消息来源
- **群**：计划可指定已有群 `chat_key`，或 `createGroup=true` 由首个账号建群再拉人
  （建群/拉人走 B18 `addParticipants`，**过 B18 人工门**）。
- **话术池**：复用 B3 快捷回复 / B4 素材的引用（存 id，不复制内容）；每账号每轮取一条，
  取用顺序跟 `speakingOrder` 同 seed 可复现。

## §5 执行链（与 B8 同构：Java 编排，注入层执行）
```
养号计划(pending) → 人工确认(confirmed) → @Scheduled 驱动：
  到点取本轮该发言的账号 → 取话术 → 派发到该账号的 view（sendTextMessage）→ 回填
```
- 复用 B8 的 `requireConfirmed` 思路：**执行链入口判人工门**（养号要真发消息，不能默认跑）。
- 逐账号独立成败：一个账号这一轮失败不影响同轮其他账号。
- **不自动重试**：发失败的按 `failed` 记，下一轮自然重试（与 B18 同一取向）。

## §6 数据模型
`nurture_plan`（养号计划）
- `id`、`tenant_id`、`name`
- `group_chat_key` VARCHAR（目标群；`create_group` 时可空）
- `create_group` TINYINT
- `account_ids` JSON（参与账号，**稳定排序**后存）
- `per_group` INT（每群容纳账号数）
- `material_ids` JSON（话术池，存 B3/B4 的 id）
- `seed` BIGINT（可复现种子）
- `at_points` JSON（每天时间点数组，如 `["09:30","20:00"]`）
- `speaking_rounds` INT（每点几轮）
- `interval_min_sec` / `interval_max_sec` / `jitter_pct`
- `status` VARCHAR（`pending|confirmed|running|paused|done|error|cancelled`）
- `last_run_date` DATE（**断点**：当天跑到哪个时间点）
- `created_at`/`updated_at`

## §7 与 B20 / 形态裁定
- **B20（本地自动化任务面板）**管的就是 B9 这些任务的"状态总览"。B9 落地后 B20 才有东西可管
  （backlog 明确要求 B20 排在 B8/B9/B18/B19 之后）。B9 的 `nurture_plan` 列表即 B20 的数据源之一。
- **形态裁定**：backlog 有一条"待裁定"的「每日养号计划 runner（服务端编排→客户端执行，无 UI）」，
  不属于 B9 也不属于 B10。本 spec 只做**本地 B9**；那条 runner 是否保留属形态裁定，不在实现范围。

## §8 分期（每段单 commit）
1. **P10-1 数据层 + 纯规则**：V34 `nurture_plan` + 实体/Mapper/Service/Controller +
   `shared/nurturePlan.ts`（装箱/日程/发言顺序）+ 单测。计划能建能看。
2. **P10-2 执行链**：Java `@Scheduled` 驱动（到点取该发言的账号）+ 注入层 `sendTextMessage`
   + 结果回填 + 人工门。
3. **P10-3 前端**：养号计划表单（选账号/群/话术池/时间点）+ 状态总览。
4. 后续：接 B20 面板（状态总览合流）。

## §9 验收面
- 迁移 V34 重跑不报错（幂等）。
- 纯规则单测：装箱（同平台约束/稳定排序/尾箱）、日程（同 seed 可复现）、发言顺序。
- 后端单测：人工门拦截、未到点不取、跨平台拒配、逐账号独立成败。
- 端到端（接 CDP 时）：建计划 → 确认 → 到点执行 → 各账号在群里发言。

## §10 陷阱
- **N 个账号 = N 个 view**：执行时必须按 `viewId` 派发到各账号的视图，别复用 B7 的单 view 群发。
- **同平台才可同群**：跨平台账号装箱要分开，否则 chat_key 根本不存在。
- **可复现必须避开 `Math.random`**：装箱排序 + 日程洗牌都用同 seed LCG（与 B18/B19 同口径），
  否则"断点续跑"无从谈起（`last_run_date` 存了也接不上）。
- **养号要过人工门**：真发消息不是无害操作，默认不跑。
- **别把 B9 当 B7**：B7 一个号发多人，B9 多号发一个群——执行链路完全不同。
