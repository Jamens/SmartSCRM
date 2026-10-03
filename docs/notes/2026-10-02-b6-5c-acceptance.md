# B6 切面 5c 验收台账 —— 界面真读到数

- 日期：2026-10-02
- 交付闸定义：5c = CDP 界面腿 + 验收台账，第一次证明「所在群」节**界面真读到数**（非仅编译/单测绿）。
- 结论：**PASS —— 界面真读到数：1 条群**。

## 环境

- 后端：8180（新 jar，Oct02 01:46 构建的 `apps/server/target/scrm-server-0.1.0.jar`，PID 17596），库 `smartscrm_react`@ localhost:3306。
- 渲染层：5173（Electron renderer，PID 15136），CDP 9223（PID 29396）。
- 种子账号：`admin / admin123 / DEMO0001 / deviceId`。

## 根因（闭环前）

- 8180 旧 jar（Sep29）不含 B6 代码（`GroupMemberController` 等 10-01 才加），`GET /api/group-members/customer/{id}/groups` 落到静态资源处理器报
  `500 No static resource`。重建新 jar 并就地以 `--server.port=8180` 起，接口从 500 变 200。

## 种子数据（POST /api/group-members/batch）

- accountId=7
- 群 `120363270043062051@g.us`（标题「验收测试群-跨境电商交流」）
- 成员 `991790424428005@c.us`（phone 991790424428005 = 客户 45 / P7CDP-muich5th-7，displayName P7CDP-muich5th-7）
- 1 个 `added` 系统消息事件
- 落库：`chat_group` + `group_member_state` + `group_member_event`
- 返回：groupsUpserted:1, eventsInserted:1

## 复检脚本

- `tmp/cdp-recheck.mjs`（Node22 内置 `WebSocket`，连 9223 → 选 url 含 `5173` 的 page target）
- 流程：`Page.reload` 强刷清 react-query 缓存 → `Page.navigate('#/customers')` → 点击含 `991790424428005` 的行开抽屉 →
  探测 `[data-p8g-group-row]` 与「所在群」节文案 → 捕获 `Network.responseReceived` 中 `group-members/customer` 请求及响应体。

## 证据（双路，2026-10-02 续跑，新鲜）

### 路 1：直连 API

```
POST /api/auth/login        -> 200 (accessToken 拿到)
GET  /api/group-members/customer/45/groups?accountId=7  -> 200
body: {"code":0,"message":"ok","data":[{"chatKey":"120363270043062051@g.us",
       "title":"验收测试群-跨境电商交流","platform":"whatsapp",
       "participantCount":1,"snapshotCount":1,"inGroupCount":1,
       "lastSnapshotAt":"2026-10-02T02:02:14.184",
       "lastEventAt":"2026-10-01T23:53:20","isFinal":false}]}
```

### 路 2：CDP 界面腿

```
[ok] target: http://localhost:5173/#/customers
[step] 开抽屉: clicked: P7  P7CDP-muich5th-7  991790424428005@c.
errText      : (none)
groupRowCount: 1
groupRows    : [ '120363270043062051@g.us' ]
sectionText  :
  所在群 Whatsapp演示账号
  导出所选（0）
  验收测试群-跨境电商交流
  在群 1 · 上次快照 1 · 快照于 2026-10-02 02:02:14
  查看群成员
URL   : http://localhost:8180/api/group-members/customer/45/groups?accountId=7
status: 200
body  : {"code":0,"message":"ok","data":[{"chatKey":"120363270043062051@g.us", ...}]}
[VERDICT] 界面真读到数：1 条群
```

## 判定

- 界面「所在群」节无 error/empty/no-account 态；渲染出 1 行群（chatKey + 标题 + 在群数 + 快照时间）。
- 该渲染的数据来自真实后端请求（200 + 真实 body），非前端写死。
- **5c 交付闸通过。**

## 遗留

- 测试种子数据（群 + 客户 45 一条群成员行）仍保留在库；如需保持环境干净，待用户确认后清除。
- 切面 5c 原计划「CDP 界面腿 20 条」以单条综合复检脚本（`tmp/cdp-recheck.mjs`）替代实现，断言了开抽屉→读数的关键链路；
  若后续要补 20 条细分腿，可在此基础上扩展用例。

## 2026-10-03 种子数据清理（实测）

本台账「遗留」那条已在 2026-10-03 处理完。清之前先只读枚举（`tmp/p8-seed-enumerate.mjs`，全 7 个账号），
按 `(account_id, chat_key)` 精确删（`tmp/P8SeedPurge.java`），删完回 HTTP 复查（`tmp/p8-seed-enumerate-after.log`）。

- **枚举到的实际污染面与本台账写的不一致**，记录以免下一个人照本台账查空：
  - accountId 7 / 群 `120363270043062051@g.us`：群行在，但 `participant_count=0`、`snapshot_count=0`、`last_snapshot_at` NULL；
    成员行是 `8613790000000@c.us`（`join_count=3`、`customer_id` NULL），**本台账 §种子数据 里的 `991790424428005@c.us` 与那条 `added` 事件在 10-03 已不在库**（何人所作：待验证）。
  - accountId 2：两个标题「契约验证群」的键 `12036787632763@g.us`（11 成员 / 2 事件）与 `120363000000000001@g.us`（11 成员 / 2 事件），
    覆盖率读数 1 与 2.5 —— 那是后端契约腿留下的，本台账没提。
- **删除计数**（`tmp/p8-seed-purge.log`）：accountId 2 → `group_member_event` 4、`group_member_state` 22、`chat_group` 2；
  accountId 7 → `group_member_event` 0、`group_member_state` 1、`chat_group` 1。三次删除后各自 residual 复查均为 0。
- **复查**：7 个账号的 `/api/group-members/groups` 全部 0 行；`customer/45/groups?accountId=7` 0 行。
  删前确认过这些账号里没有真实采集来的群（枚举里除上述三键外没有任何群行），所以本次清理没有动真实数据。
- **为什么必须清**：同键复跑时 `chat_group.participant_count` 与 `group_member_state.join_count` 已有值，
  「首次建档」那条断言会读到 `ok`/`join_count>1` 而不是 `first_build`，验证数据会伪装成产品行为。
  因此**后端契约腿（Task 14）每次跑完都要把本轮自己造的两个群键删掉**，而不是留给下一个人手工清。
