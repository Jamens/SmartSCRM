# A17 桌面系统通知 设计（2026-10-03）

清单行 **A17**（`docs/feature-checklist.md`，P14 可提前）。backlog 第 30 项。
形态是同类桌面 IM 的通行做法：入站消息弹一条 OS 通知，同一会话的连发并成一条，点通知回到该会话。

---

## §1 范围与不做

**做**：窗口不在前台时，入站消息到达 → 弹操作系统通知；同一会话在合并窗口内的多条消息并成一条（标题带条数）；点击通知 → 唤起并聚焦主窗口 → 切到消息页并定位该会话。

**不做（写死，不是"以后再说"）**：
1. **不做站内通知列表**。那是 A10（消息中心 / 站内通知，列表 + 未读 + 系统通知投递），与本行不是一个东西。本行只有 OS 弹窗，没有持久化、没有未读计数、没有列表页。
2. **不做头像下载**。入站帧里没有头像字段（`LiveFrame.message` 是 `NormalizedMessage`，见 `shared/chatTypes.ts:45`），而为了一个图标去外连 URL 违反本项目的开源红线（外部服务一律自托管或不接）。图标用应用自带图标，`Notification` 不给 `icon` 时由系统决定。
3. **不做已读回写**。点击通知只做"跳过去"，不标已读——标已读是读会话那个动作的事，通知不能替用户读。
4. **不做发声 / 免打扰时段 / 按账号粒度开关**。第一版只有一个总开关。
5. **不做失败重试**。通知弹不出来就弹不出来（系统层面，比如用户关了系统通知权限），不排队重发。

---

## §2 数据来源与分工

触发源是 `msg:live` 的 **LiveFrame**（`shared/chatTypes.ts:45`：`viewId` / `accountId` / `platform` / `activeChatKey` / `message`）。
它已经有一切需要的字段：`message.direction` 判入站、`message.chatKey` 做去抖键、`message.body` 做正文预览。

分工按"谁知道什么"切，与 A12 角标同一套理由（`lib/unreadBadge.ts` 头注释）：

| 谁 | 知道什么 | 因此负责 |
|---|---|---|
| 渲染层 | 入站帧什么时候来、开关在不在、窗口有没有焦点 | 决定"这一帧该不该提请弹窗"，并把字段摊平交给主进程 |
| 主进程 | 系统通知怎么弹、跨帧累积怎么做、窗口怎么唤起 | 去抖合并 + 实际弹窗 + 点击后唤起窗口 |
| `@shared/notification` | 规则本身（弹不弹、怎么合、标题正文怎么裁） | 纯函数，两头共用，有单测 |

**为什么去抖必须在主进程**：渲染层每条消息都会来一帧，而它需要"跨帧累积"——这个状态若放在渲染层，会因组件重挂载（路由切换、热更新）丢掉一半，表现是"去抖时灵时不灵"。主进程常驻，是唯一稳的落脚点。

---

## §3 纯规则（`src/shared/notification.ts`）

跨进程共用，所以放 shared，与 `shared/badge.ts` 同构。

```ts
/** 提请弹窗的输入。渲染层摊平后交给主进程，主进程不反向依赖渲染层类型。 */
export interface NotifyCandidate {
  /** 设置里的「桌面通知」开关。 */
  enabled: boolean
  /** 窗口此刻有没有焦点。与角标同口径：前台不弹。 */
  focused: boolean
  /** 消息方向。只弹收到的。 */
  direction: 'in' | 'out'
  /** 去抖键，用 chatKey：同一会话的连发并成一条。 */
  chatKey: string
  /** 会话显示名（号码或群名）。 */
  title: string
  /** 消息正文，可能为空（纯媒体消息）。 */
  body: string
}

export type NotifyDecision =
  | { action: 'skip'; reason: 'disabled' | 'focused' | 'outgoing' }
  | { action: 'show'; chatKey: string; title: string; body: string }

export function notifyDecisionOf(c: NotifyCandidate): NotifyDecision
```

判定的顺序是 `enabled → focused → direction`：开关关了就不用管焦点，前台就不必再看方向。

```ts
/** 同一会话并成一条的窗口。 */
export const NOTIFY_MERGE_WINDOW_MS = 3000
/** 正文预览上限。 */
export const NOTIFY_BODY_MAX = 80

export interface NotifyPending {
  chatKey: string
  title: string
  body: string
  /** 合并进来的条数，>=1。 */
  count: number
  /** 这一批第一条到达的时刻。 */
  firstAt: number
}

/**
 * 把一条新消息并进待弹批次。同一 chatKey 且在合并窗口内 → 计数累加、正文换成本条；
 * 跨窗口或换会话 → 重开一批（count=1）。
 */
export function mergeNotifyPending(
  prev: NotifyPending | null,
  next: { chatKey: string; title: string; body: string },
  now: number
): NotifyPending

/** 通知标题：单条是会话名，多条带条数。 */
export function notifyTitleOf(p: NotifyPending): string
/** 通知正文：裁剪 + 空正文的占位。 */
export function notifyBodyOf(p: NotifyPending): string
```

`notifyTitleOf` 多条时输出 `${title}（${count} 条新消息）`——条数是**合并计数**，不是未读总数，措辞要能看出来。

纯函数要有单测（`src/shared/notification.test.ts`，`node --test`）：判定四路（开/关 × 前/后台 × 入/出站）、合并窗口内与跨窗口、换会话重开、正文裁剪与空正文占位。

---

## §4 主进程（`src/main/services/desktopNotify.ts`）

```
showIncoming(candidate)  →  notifyDecisionOf → skip 则直接返回 skip 原因
                         →  show 则 mergeNotifyPending 进 pending map
                            + 起一个 NOTIFY_MERGE_WINDOW_MS 的定时器，到点 flush
flush(chatKey)           →  new Notification({ title, body })  +  .on('click')
click                    →  showMainWindow()  →  webContents.send('notify:clicked', { accountId, chatKey })
```

- `pending` 是 `Map<chatKey, NotifyPending>`。定时器按 chatKey 存，flush 时清掉。
- **点击回调只做两件事**：唤起/聚焦主窗口，把 `{ accountId, chatKey }` 推给渲染层。不标已读、不改未读、不自己导航。
- 导出 `resetNotifyState()` 供单测与"退出登录"清场。
- 回执形状 `NotifyEcho { shown: boolean; reason: string | null }`：主进程要能说清"弹了 / 为什么没弹"，驱动据此断言，而不是靠"看起来没报错"。

---

## §5 IPC 与 preload

| 通道 | 方向 | 载荷 |
|---|---|---|
| `notify:show` | 渲染 → 主进程（invoke） | `NotifyCandidate` → `NotifyEcho` |
| `notify:clicked` | 主进程 → 渲染（send） | `{ accountId: number; chatKey: string }` |

preload 增 `scrm.notify = { show, onClicked }`，`onClicked` 返回解绑函数（与 `win.onMaximizedChanged` 同形）。

---

## §6 渲染层

**提请弹窗**：挂在 `useLiveTailSync`（`lib/liveTailSync.ts:268`）里，与 `onLive` 同一个订阅点——那里已经拿到了完整帧，另起一个订阅会重复消费。

正文与标题从帧里取：`message.body`（空则占位）、会话名用 `titleOfConversation`（`lib/chatDisplay.ts:9`）；帧里没有会话名时退回 `chatKey` 的号码部分，**不伪装成一个名字**。

**点击跳转**（`AppLayout` 常驻订阅）：
1. `useSelectionStore` 把选中账号设为 `accountId`；
2. `chatJump` 记下 `chatKey`；
3. `navigate('/messages')`。

`MessagesPage` 消费时在已加载的会话列表里按 `chatKey` 定位。**定位不到就停在消息页**——不报错、不伪造一条会话、不清空选中态。这条边界要写进验收面：通知点过来的会话可能还没进当前筛选，那是正常结果不是 bug。

---

## §7 设置项与 UI

`AppSettings`（`main/state/settings.ts`）增 `notificationEnabled: boolean`，默认 **true**（与 `badgeEnabled` 同：开着的开关不用等落盘才生效）。必须在 `mergeKnown` 里加判定——那里是读盘与 `settings:set` 的唯一合并口，漏一处就表现为"能写进文件但读不回来"。

设置页「通知」那张 Card（`pages/SettingsPage.tsx:113`）里，角标开关下面加一行：**桌面消息通知**。文案要写清"窗口不在前台时"、"同一会话的连发会并成一条"。

---

## §8 验收面

| # | 断言 | 手段 |
|---|---|---|
| 1 | 规则四路：开关关 → skip(disabled)；前台 → skip(focused)；出站 → skip(outgoing)；入站且失焦且开 → show | shared 单测 |
| 2 | 合并：同 chatKey 3s 内 3 条 → 一条通知，标题含"（3 条新消息）"，正文是最后一条 | shared 单测 |
| 3 | 跨窗口 / 换会话 → 各弹各的，计数不串 | shared 单测 |
| 4 | 正文裁剪到 80 字；空正文有占位文案 | shared 单测 |
| 5 | 开关落盘并广播：设置页翻开关 → `settings:changed` 到达，重开应用仍是该值 | 主进程 + CDP |
| 6 | 点击通知 → 主窗口唤起 | 手动 / CDP |
| 7 | 点击后跳到消息页并定位到该会话；定位不到时停在消息页且不报错 | CDP |

类型与静态门禁：四路 `pnpm typecheck`（node/web/inject/unit）+ `pnpm test:unit` + `eslint --quiet` 零 error。

---

## §9 陷阱

1. **别把去抖状态放渲染层**（§2 有理由）。重挂载丢状态的表现是"时灵时不灵"，最难查。
2. **`Notification` 在部分 Linux 桌面与 macOS 未授权时不弹也不报错**。所以回执里的 `shown` 只能证明"调用了"，不能证明"用户看见了"——驱动断言到第 5 条为止，第 6/7 条要人在场看。
3. **正文可能含换行与控制字符**（复制粘贴来的长文本）。`notifyBodyOf` 裁剪前要把换行折成空格，否则通知会被撑成一大块。
4. **入站帧在本项目会回声**：页面上自己发出的消息也会回一帧（`direction==='out'`）。所以方向判定必须显式，不能靠"有帧就弹"——否则自聊测试会把通知刷满。
5. **别顺手做头像**。入站帧没有头像字段，为了一个图标去外连 URL 违反开源红线（§1 第 2 条）。
