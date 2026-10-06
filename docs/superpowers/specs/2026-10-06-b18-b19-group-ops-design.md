# B18 群自动加群 + B19 群自动踢人 设计（2026-10-06 扩 spec）

> backlog 对 B18 标注「需 spec / **入群方案需另起 spec**」、B19 标注「需 spec」，故先定方案再落地。
>
> 与 B8 炒群引擎的关系：B8 的动作词表里已留 `join_group`/`kick_member` 两个占位动作，但**本期不接**——
> 这两个动作是**破坏性/不可逆**的（加错群退不出、踢错人找不回），执行权必须留在人手里。
> 本 spec 落地后，B8 的剧本可以引用这两个动作，但**每一步都带人工门**（见 §5）。

## §1 引擎能力边界（先摸清再设计）

wa-js `dist/group/functions/` 实测提供：

| 能力 | 签名 | 备注 |
|---|---|---|
| 凭邀请码加群 | `join(inviteCode): Promise<{id, pendingApproval}>` | **只有这一条加群路径** |
| 拉人进群 | `addParticipants(groupId, ids)` | 需本账号在群里且有权限 |
| 踢人 | `removeParticipants(groupId, ids)` | 需 admin 权限 |
| 踢人前校验 | `canRemove(groupId, ids): Promise<boolean>` | **踢前必调**，防误踢超管 |
| 撤销邀请码 | `revokeInviteCode(groupId)` | 收口用 |
| 邀请码探信息 | `getGroupInfoFromInviteCode(code)` | 群名/成员数/群主，可用于 join 前预览 |
| 退群 | `leave(groupId)` | 加错群的退路 |

**关键约束**：**没有「按群名搜索加入」的 API**。市面上的"批量加群"工具走的是改协议包/多设备号，不在本仓正路上。
→ **B18 的输入只能是邀请码清单**（CSV/TXT 导入），不是"目标群名列表"。这是硬约束，不做妥协。

## §2 范围与不做

**做**
- **B18**：邀请码清单导入 → 任务编排（随机间隔/间隔组/失败重试）→ 逐个 `join` → 记录结果。join 前可先 `getGroupInfoFromInviteCode` 预览群信息。
- **B19**：规则表单 → **产出待踢名单** → **人工确认** → `canRemove` 校验 → `removeParticipants` 执行 → 记录结果。

**不做**
- 不做「按群名/链接搜索加入」（引擎不支持，见 §1）。
- 不做多设备号矩阵加群（超出引擎能力，且触碰红线）。
- 不做全自动无人值守：破坏性动作一律人工门（§5）。

## §3 数据模型

### 3.1 B18 加群
`group_join_task`（一次加群任务）
- `id`、`tenant_id`、`account_id`（用哪个号加）
- `name`、`status`（`pending|confirmed|running|done|error|cancelled`，与 B8 同词表）
- `interval_min_sec` / `interval_max_sec`（**随机间隔**，秒）、`jitter`（抖动，防风控指纹）
- `total`、`succeeded`、`failed`（计数，跑完回填）
- `created_at`、`updated_at`

`group_join_item`（一个邀请码一行，断点粒度）
- `id`、`tenant_id`、`task_id`
- `invite_code`、`group_id`（join 后回填）、`group_name`（预览回填）
- `status`（`pending|joining|joined|failed|skipped`）
- `error_detail`、`msg_key`
- `uk(task_id, invite_code)` 幂等

### 3.2 B19 踢人
`group_kick_task`（一次踢人任务）
- `id`、`tenant_id`、`account_id`、`group_id`
- `name`、`status`（同词表）+ **`approval_status`（`pending|approved|rejected`）**← 人工门
- `rule` JSON（规则快照，规则会演进，任务里存快照便于复现）
- `total`、`succeeded`、`failed`
- `created_at`、`updated_at`

`group_kick_item`（一个待踢成员一行）
- `id`、`tenant_id`、`task_id`
- `participant_id`、`display_name`
- `reason`（命中哪条规则）
- `status`（`pending|removing|removed|failed|skipped`）
- `can_remove`（`canRemove` 的结果，false 的直接标 skipped 不硬踢）
- `error_detail`
- `uk(task_id, participant_id)`

## §4 纯规则（`shared/groupOps.ts`，配 node --test）
- `joinIntervalMs(minSec, maxSec, jitterPct, seed?)`：随机间隔 + 抖动的**纯计算**（同 seed 同序列，可复现/可单测）。
- `approvalGate(status)`：踢人执行前的人工门判定（只有 `approved` 能进执行链；`pending`/`rejected` 一律拒绝）。
- `kickTargetDecision(item)`：单条待踢项该不该真踢（`canRemove=false` → `skipped`，不硬踢）。

## §5 执行链与人工门（**本设计的核心**）

```
B18 加群：  邀请码导入 → 建任务(pending) → 人工确认(confirmed) → 执行链:
            逐个 join（随机间隔+抖动）→ item 回填 group_id/status → 计数回填 → done
B19 踢人：  规则表单 → 规则出待踢名单 → 建任务(approval_status=pending)
            → 人工审阅名单 → approved → 执行链: 逐条 canRemove 校验 → removeParticipants
            → item 回填 → 计数 → done
```

- **人工门是硬约束**：B18 任务必须 `confirmed` 才能跑；B19 必须 `approved` 才能跑。`approvalGate` 在执行链入口再判一次（不只靠 UI 挡）。
- **canRemove 兜底**：即使人工确认了，`canRemove=false` 的成员只标 `skipped` 不硬踢——防止踢超管/踢自己这类不可逆事故。
- **不自动重试 join**：`join` 失败（邀请码失效/已被封）重试无意义，直接 `failed`，人工换码。

## §6 与 B8 的衔接
- B8 动作词表已有 `join_group`/`kick_member` 占位。本 spec 落地后，二者指向 B18/B19 的执行链。
- **但 B8 剧本里引用这两个动作时，同样受 §5 人工门约束**——`join_group` step 执行前检查其任务已 `confirmed`；`kick_member` 检查 `approved`。不允许剧本绕过人工门直连执行链。

## §7 分期（每段单 commit）
1. **P9-4 数据层 + CRUD**：V32 两组表 + 实体/Mapper/Service/Controller + `shared/groupOps.ts` 纯规则 + 单测。任务/名单能建能看。
2. **P9-5 执行链**：join/kick 执行器（调 wa-js）+ 随机间隔 + canRemove 校验 + 人工门 + 结果回填。含 B8 动作对接。
3. **P9-6 前端**：加群任务表单（邀请码导入）、踢人规则表单 + 名单审阅（人工门 UI）。

## §8 验收面
- 迁移 V32 重跑不报错（幂等）。
- 纯规则单测：随机间隔（边界/抖动/可复现）、`approvalGate`、`kickTargetDecision`。
- 后端单测：人工门拦截（未确认/未批准不执行）、`canRemove=false` 标 skipped、邀请码幂等、随机间隔真的调用。
- 端到端（接 CDP 时）：导入邀请码 → 建任务 → 确认 → 执行 → 结果回填；踢人规则出名单 → 未批准时执行被拒 → 批准后执行。

## §9 陷阱
- **加群只有邀请码一条路**（§1）。别设计"按群名加群"，引擎没这 API，做不出来。
- **join/kick 不可逆**：加错群只能退群、踢错人找不回 → 人工门 + `canRemove` 双保险，且门要在**执行链入口**判（不只 UI）。
- **join 失败不重试**：邀请码失效/被封时重试只是浪费配额还加深风控。
- **随机间隔要有 jitter**：固定间隔是风控指纹；`jitter` 让间隔本身也随机。
- **执行链在桌面端**：wa-js 跑在注入层（页面内），Java 只编排状态（与 B8 一样的分工）——别在 Java 里试图直接调 wa-js。
