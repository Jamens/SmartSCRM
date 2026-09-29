# 批量群发（B7）· 验收记录

**日期**：2026-09-29（CDP 两腿实跑 + 渲染层换档补刷修复 + 机械五数复抄）
**规格**：`docs/superpowers/specs/2026-09-28-batch-send-design.md`
**计划**：`docs/superpowers/plans/2026-09-28-batch-send.md`（16 个任务）
**提交区间**：`2ea58aa`（spec 落档）→ `24e72e7`（第一支代码：V11 两表）→ `8458716`（本轮最后一支：渲染层换档补刷），共 64 支，逐支 `git log --oneline 2ea58aa~1..8458716`
**证据词口径**：**实测** = 本轮真跑过并读到输出；**读码** = 只从源码得出；**推断** = 由环境事实推出；**待验证** = 没跑过，不当结论用。
**现场**：`smartscrm_react`（本地 MySQL，只连这一库）＋ `:8180` 后端（F1 那轮构建）＋ electron dev（用户 12:0x 起，`out/main/index.js` 11:41:07 > `host.ts` 10:20:50，主进程是新的）＋ 真实登录的 WhatsApp 内嵌会话。**全程 `dryRun=1`，未点过任何撤回，未注入过任何键盘事件。**

---

## 1. 四档总览

| 档 | 覆盖什么 | 结论 | 证据词 |
| --- | --- | --- | --- |
| 机械 | Java 单测 / node:test 单测 / typecheck 四路 / 改动文件 lint | Java **118/0 + BUILD SUCCESS**；unit **254/254**；typecheck 四路 exit 0；lint 改动文件 0 输出 | 实测 |
| 后端契约 | 创建与展开、十个运行端点、状态机与租户闸、心跳看门狗、撤回资格与三条边 | `tmp/p7b-batch-contract.mjs` **37/37、exit 0** | 实测 |
| CDP 演练腿 | 20 条演练任务跑完、暂停/继续/取消、内嵌视图零触碰、渲染层那一屏与 R11 重发链 | dry-run **8/8 exit 0**；detail-ui **6/6 exit 0** | 实测 |
| 真实档 | 真发 1 条、真撤回 1 次（含超窗失败形状） | **待验证（需用户在场并明确放行）**，两格都没跑 | 待验证 |

自主档三格闭合；只有真发/真撤回那两格没排进去——它们是不可回收动作，按 spec §9 只由用户在场放行。

---

## 2. 机械验证（实测，五个数逐个抄）

| # | 命令（工作目录） | 读数 | 现场日志 |
| --- | --- | --- | --- |
| 1 | `pnpm run test:unit`（`apps/desktop`） | `ℹ tests 254 / pass 254 / fail 0` | `tmp/p7b-unit-leg6fix.log` |
| 2 | `pnpm run typecheck`（`apps/desktop`，node+web+inject+unit 四路） | 四路 exit 0，0 error | `tmp/p7b-typecheck-leg6fix.log` |
| 3 | `pnpm exec eslint <改动文件> --quiet`（`apps/desktop`） | 无输出（0 error） | `tmp/p7b-eslint-leg6fix.log` |
| 4 | `./mvnw test`（`apps/server`，JDK 17） | `Tests run: 118, Failures: 0, Errors: 0` + BUILD SUCCESS | `tmp/p7b-gate-t16-java.log` |
| 5 | `node tmp/p7b-batch-contract.mjs`（仓库根，打 `:8180`） | `37/37 passed`，exit 0 | `tmp/p7b-gate-t16-contract.log` |

分母口径（读码 + 实测，不拿算术当证人）：unit 的 254 = 计划预测值 + Task 15 修复轮给 `retryFailed` 三态补的 1 条 + B7 终审修复轮 I-1 给 `errorDetail` 截断补的 1 条；Java 的 118 = 基线 81 + 群发纯函数 22 + 整枝修复轮 12 + 终审修复轮 I-2/I-6 的 3 条判别（`BatchSendServiceTest` 现为 11 条，磁盘 `grep -c "@Test"` 与日志一致）。第 3 行的"改动文件"本轮只有两支渲染层文件（见 §4c）。

---

## 3. 后端契约（实测，37 条逐条）

驱动：`tmp/p7b-batch-contract.mjs`（gitignored，不入库）。本轮 37/37、exit 0；建的任务见 §8。

| 编号 | 判据 | 期望 | 实际 | 结果 |
| --- | --- | --- | --- | --- |
| #1 | 创建 → taskId + rejected:[] + totalCount:4 | code=0,totalCount=4,rejected=[] | {"taskId":72,"rejected":[],"totalCount":4} | ok |
| #2 | 读任务 → status:pending, sent/fail/total=0/0/4, dryRun:true | pending,0,0,4,dryRun=true | {"id":72,"name":"p7t6 契约任务","platform":"whatsapp","dryRun":true,"status":"pending","accountIds":[7],"contents":["第一条 {客户名} {号码} {订单号}","第二条"],"msgIntervalMin":0,"msgIntervalMax":0,"chatIntervalMin":0,"chatIntervalMax":0,"totalCount":4,"sentCount":0,"failCount":0,"heartbeatAt":null,"createdAt":"2026-09-29T12:20:02.761"} | ok |
| #3 | 明细分页 → size=2 每页两条、page=2 接上后两行，seq=[1,2,3,4] 同人两条相邻 | seq=1,2,3,4 / ci=0,1,0,1 | [[1,"15510303838@c.us",0],[2,"15510303838@c.us",1],[3,"14510303838@c.us",0],[4,"14510303838@c.us",1]] | ok |
| #4 | body 含 {订单号}，两个已知 token 已被替换 | 含 {订单号}，不含两个 token | ["第一条 3838 {订单号}","第一条 3838 {订单号}"] | ok |
| #5 | 收件人挂存活客户 → body 逐字 = 客户昵称\|客户手机号 | P7CDP-muich5th-7\|991790424428005 | ["P7CDP-muich5th-7\|991790424428005"] | ok |
| #6 | preview 与 detail 同一个渲染函数，且 preview 走样例链（{客户名}=本地段尾 4、{号码}=空） | 逐字相等 + 第一条 3838 {订单号} | {"same":true,"expect":"第一条 3838 {订单号}","actual":"第一条 3838 {订单号}"} | ok |
| #7 | preview 收件人截到 5 且 truncated:true | 5 行 + truncated | {"n":5,"t":true} | ok |
| #8 | platform:telegram → code 40013 | 40013 | {"code":40013,"message":"第一版只放开 whatsapp 平台","data":null} | ok |
| #9 | 空正文 → 40013 且文案点名"第 1 条" | 40013 + 第 1 条 | 第 1 条正文是空的 | ok |
| #10 | 5001 字 → 40013 且含"第 1 条"与"5000" | 40013 | 第 1 条正文超过 5000 字 | ok |
| #11 | 21 条内容 → 40013 且含 20 | 40013 | 内容条数超过上限 20 条 | ok |
| #12 | dryRun:false + msgMin:0 → 40013 且含 3 | 40013 | 同人间隔 min 真发不能低于 3 秒；换人间隔 min 真发不能低于 5 秒 | ok |
| #13 | dryRun 的零间隔任务已创建成功（同 #1 的 taskId 存在） | dryRun 0 通过 / 真发 0 拒 | T=72,c12=40013 | ok |
| #14 | min>max → 40013 且含"min 不能大于 max" | 40013 | 同人间隔 min 不能大于 max | ok |
| #15 | 两条不可寻址分别点名、其余照常展开，totalCount=2（1 人 × 2 内容） | rejected=[nope-9999(无会话), 999999(账号不在清单)] total=2 | {"code":0,"d":{"taskId":74,"rejected":[{"chatKey":"nope-9999@c.us","accountId":7,"reason":"当前账号下没有这条会话的采集记录"},{"chatKey":"15510303838@c.us","accountId":999999,"reason":"这条会话所属的账号不在本次勾选的账号里"}],"totalCount":2}} | ok |
| #16 | 全员不可寻址 → 40012 | 40012 | {"code":40012,"message":"所有收件人都不可寻址","data":null} | ok |
| #17 | 账号不可用 → 40011 且 message 里有那个 id | 40011 | 账号不可用: 999999 | ok |
| #18 | pending→pause = 40902 且含"pending" | 40902 | {"code":40902,"message":"当前状态 pending 不能 pause","data":null} | ok |
| #19 | start/pause/resume/cancel 链每一跳都返回目标态 | running→paused→running→cancelled | ["running","paused","running","cancelled"] | ok |
| #20 | 终态再 start = 40902 | 40902 | {"code":40902,"message":"当前状态 cancelled 不能 start","data":null} | ok |
| #21 | heartbeat 只在 running 时命中一行 | 0,1,0 | [0,1,0] | ok |
| #22 | reports 后 sent=2 / fail=1（unknown 不计 fail，R2） | sent2/fail1/paused | {"sent":2,"fail":1,"st":"paused"} | ok |
| #23 | detail 的 msgKey 逐字带 _out | true_a@c.us_1_out | true_a@c.us_1_out | ok |
| #24 | 无 open 行时再报一次 → 任务 done（收尾那一跳只带结论） | done | done | ok |
| #25 | #24b detailIds 只复位那一条：reset=1 / status=paused / failCount=0 / 其余三行原样 | reset=1,paused,[success,success,pending,unknown] | {"d":{"reset":1,"status":"paused"},"s":["success","success","pending","unknown"],"fail":0} | ok |
| #26 | #24c cancelled 任务 retry → reset=0 且 status 仍是 cancelled | reset=0/cancelled | {"reset":0,"status":"cancelled"} | ok |
| #27 | #25 retry-failed reset=1 且 unknown 仍是 unknown | reset=1 / [pending,unknown,pending,pending] | ["pending","unknown","pending","pending"] | ok |
| #28 | #26a dryRun 任务 recall → eligible:[] 且四条理由都是演练 | eligible=0 / rejected=4 全含"演练" | {"eligible":[],"rejected":[{"detailId":398,"reason":"演练任务没有真发过，无物可撤"},{"detailId":399,"reason":"演练任务没有真发过，无物可撤"},{"detailId":400,"reason":"演练任务没有真发过，无物可撤"},{"detailId":401,"reason":"演练任务没有真发过，无物可撤"}]} | ok |
| #29 | #26b 非演练 + success → eligible 1 条带 msgKey、recall_status 变 recalling，其余 3 条点名原因 | eligible=1/recalling=1 | {"e":[{"detailId":402,"accountId":7,"chatKey":"15510303838@c.us","msgKey":"true_c@c.us_9_out"}],"r":["recalling","none","none","none"]} | ok |
| #30 | #27 八跳对不存在的任务都回 40404，心跳回 code=0/updated=0 | 8 段全 =40404 + heartbeat updated=0 | start=40404 pause=40404 resume=40404 cancel=40404 reports=40404 retry-failed=40404 recall=40404 recall-reports=40404 heartbeat=0/0 | ok |
| #31 | #28 换号后八跳 + 两个 GET 打别人的真任务全是 40404（本租户读得到同一个 id） | 本租户 code=0 + 换号 10 段全 =40404 | 0 start=40404 pause=40404 resume=40404 cancel=40404 reports=40404 retry-failed=40404 recall=40404 recall-reports=40404 GET_task=40404 GET_details=40404 | ok |
| #32 | #29a 刚 start（心跳已续上）时 reconcile 两拍都不动这一行与这一任务 | markedUnknown=0 pausedTasks=0 | {"pausedTasks":0,"markedUnknown":0,"markedRecallFailed":0} | ok |
| #33 | #29b 心跳停过阈值后：那一行 sending→unknown(ENGINE_LOST)、任务 running→paused | markedUnknown=1/pausedTasks=1/[unknown,pending,…]/paused | {"r":{"pausedTasks":1,"markedUnknown":1,"markedRecallFailed":0},"s":[["unknown","ENGINE_LOST"],["pending",null],["pending",null],["pending",null]],"st":"paused"} | ok |
| #34 | #30 reconcile 回 `markedRecallFailed` 键且孤儿 recalling 已结回 recall_failed（I-2 第三拍） | markedRecallFailed 是 number / recall_status=recall_failed / recall_detail 非空 | {"r":{"pausedTasks":0,"markedUnknown":0,"markedRecallFailed":0},"rs":"recall_failed","rd":"宿主在撤回途中中断，撤回结果未知"} | ok |
| #35 | #31 recall_failed 的行再点撤回 → 重新进 eligible，recall_status 推回 recalling（I-6 回程入口） | eligible 含 detailId=dT4[0].id | {"e":[{"detailId":402,"accountId":7,"chatKey":"15510303838@c.us","msgKey":"true_c@c.us_9_out"}],"r":[]} | ok |
| #36 | #32 recalled 的行再点撤回 → 挡下且 reason 含「已撤回」（I-6 终态），eligible 不含它 | rejected 含 detailId=dT4[0].id 且 reason 点名「已撤回」 | {"e":[],"r":[{"detailId":402,"reason":"已经撤回成功（recall_status=recalled），没有可再撤的东西"}]} | ok |
| #37 | #33 recalling 的行再点撤回 → 挡下且 reason 含「正在撤回」（I-6 那一条别人的手里） | rejected 含 detailId=dT4[1].id 且 reason 点名「正在撤回」 | {"e":[],"r":[{"detailId":403,"reason":"这条正在撤回中（recall_status=recalling），请等这一趟收口"}]} | ok |

---

## 4. CDP 演练腿（实测）

两腿都在同一份现场跑（用户起好的 dev 应用 + 真实登录会话）。每次腿之前同拍执行 `powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1` 抬窗口，驱动开场断言 `document.visibilityState === 'visible'`，每一次点击前再断言一次（窗口隐藏 ≠ 点不动，判据是"点完读得到"）。

### 4a. `tmp/p7b-dry-run.mjs` — 执行环那一侧，8 条

| 编号 | 判据 | 期望 | 实际 | 结果 |
| --- | --- | --- | --- | --- |
| #1 | 建 20 行演练单 → taskId + totalCount=20 + rejected=[] | code=0,totalCount=20,rejected=[] | {"code":0,"d":{"taskId":70,"rejected":[],"totalCount":20}} | ok |
| #2 | batch.start 非 null 且 GET 回 status=running | hop.r.status=running + GET=running | {"hop":{"hop":true,"r":{"sentCount":0,"failCount":0,"totalCount":20,"status":"running"}},"got":"running"} | ok |
| #3 | 30s 内轮询到 status 离开 running（演练出料口应自然收尾到 done） | 30s 内 running→done | rounds=16 final=done | ok |
| #4 | sentCount=20 且 failCount=0 | 20/0 | {"sent":20,"fail":0,"total":20} | ok |
| #5 | 20 行 detail 的 msgKey 全部以 dryrun: 开头 | 20 行全 dryrun: | {"n":20,"sample":["dryrun:347","dryrun:348"],"nonDrill":0} | ok |
| #6 | 没有行留在 sending/pending（每行都有结论） | 0 行未结 | {"open":0,"statuses":["success"]} | ok |
| #7 | start→1s内pause→在飞结清后计数冻住(三读全等且≤在飞上界)→resume→计数再涨→cancel→每行都有结论 | pause≤1s 且 r 非null / paused 后涨完在飞(≤accountIds 条)再三读(600/1200ms)全等 / resume 后增长 / cancelled 后 pending=0 且 sending=0 且 skipped≥1 且 20 行全有结论 | {"wPauseMs":43,"sentA":0,"acctN":1,"inflightCap":1,"sentWait":1,"sentB":1,"sentB2":1,"sentB3":1,"冻住":true,"暂停hop":{"sentCount":0,"failCount":0,"totalCount":20,"status":"paused"},"resume后":true,"终态":"cancelled","pending":0,"sending":0,"skipped":17,"结清":3} | ok |
| #8 | 内嵌视图 href+当前会话标记 跑前跑后逐字相等（会话标记前置已验真实在场；演练出料口不碰页面） | href 逐字相等 + session 非 null 且逐字相等（session 读不到时前置就 exit 4，不在这里空转） | before=https://web.whatsapp.com/\|wa=261963795943523@lid\|bridge=chat:null\|session=wa:261963795943523@lid after=https://web.whatsapp.com/\|wa=261963795943523@lid\|bridge=chat:null\|session=wa:261963795943523@lid | ok |

- **#7 的第一版是红的（7/8），红在断言而不是产品**：它写死了「pause 之后计数一格都不动」与「cancel 之后 `pending|sending` 必须为 0」。用只读探针 `tmp/p7b-dryrun7-after.mjs` 归因到那张单的终态：`cancelled`、3 条 success、17 条 skipped、0 行未结。真实形状是（读码 `host.ts` 的 `stopEngine` + `skipAllPending`）：暂停只摘掉"下一次投料"的定时器，**已经在 `await dispatch` 里的那一行照样结清**——每个账号至多一行；`skipAllPending` 只把 `pending` 翻成 `skipped`。断言于是改成**有界增长后冻住**：上界 `inflightCap = sentA + accountIds.length`，然后 0/600/1200 ms 三读全等才算止住。修后读数：`{wPauseMs:70, sentA:0, acctN:1, inflightCap:1, sentB:1, sentB2:1, sentB3:1, 冻住:true, resume 后增长:true, 终态:"cancelled", pending:0, sending:0, skipped:17, 结清:3}`（实测）。两个失败方向都还抓得住：泵不理暂停 → 三读不等；20 条在等待窗口内全跑完 → `sentB > inflightCap`。
- **#8 的"在场"是被前置锁死的**：会话标记读不到（哨兵值 `chat:null` 等）时驱动直接 `exit 4`，不会带着空读数打印 passed。本轮跑前跑后逐字相等：`https://web.whatsapp.com/|wa=261963795943523@lid|bridge=chat:null` 与 `session=wa:261963795943523@lid`（实测）——演练出料口一行页面都没碰。

### 4b. `tmp/p7b-detail-ui.mjs` — 渲染层那一屏 + R11 重发腿，6 条

| 编号 | 判据 | 期望 | 实际 | 结果 |
| --- | --- | --- | --- | --- |
| #1 | 列表行：演练徽标在 + 状态已完成 + 进度 20/20 + 内条 width:100% | 演练/已完成/20/20/width:100% 同框出现 | {"row":{"txt":"p7b-ui-list-1790655322929 已完成 演练 20/20 0 2026-09-29 12:15","bar":"width: 100%;"},"shot":"saved tmp/p7b-shot-list.png"} | ok |
| #2 | 详情页 20 行且 seq 逐字 1..20 | n=20, seqs=[1..20] | {"n":20,"head":["1","2","3"],"tail":["18","19","20"]} | ok |
| #3 | 20 个撤回 checkbox 全 disabled + 有「演练任务没有真发过」 | boxN=20 全禁用 + 那句在场 | {"boxN":20,"allDisabled":true,"drillNote":true,"shot":"saved tmp/p7b-shot-detail.png"} | ok |
| #4 | B 单布景读回：done 徽标+失败1（DOM），GET 交叉核对 done/fail=1/行2=failed/行1 msgKey 是 forced 前缀 | DOM: 已完成/失败 1/重发这一条 + GET: done,1,failed,forced | {"head":"p7b-ui-retry-1790655322929 已完成 演练 共 2 · 已发 1 · 失败 1 1/2 心跳：12:15 · 距今 2 秒 终态任务没有","row2":{"send":"失败","key":"—","btn":"重发这一条"},"api":{"st":"done","fail":1,"s2":"failed"}} | ok |
| #5 | 点「重发」读回：行2=待发送/pending，任务=已暂停/paused，「继续」出现且可用，failCount 掉回 0 | 行2 pending + 任务 paused + 继续可用 + fail=0（DOM 与 GET 各读各的） | {"row2":{"send":"待发送","key":"—","btn":null},"resume":{"text":"继续","disabled":false},"api":{"st":"paused","fail":0,"s2":"pending"}} | ok |
| #6 | 点「继续」读回：行2 重跑成 success 且 msgKey 以 dryrun: 开头（引擎产的新 key）、行1 仍是 forced/success（单条重发不误伤）、任务 done、failCount=0 | 行2 success + dryrun: 前缀新 key + 行1 原样(forced/success) + done + 失败 0 | {"row2":{"dom":{"send":"成功","key":"dryrun:346","btn":null},"api":"done"},"trail":[[4,["待发送","—"],"paused"],[516,["成功","dryrun:346"],"done"]],"samples":2,"api":{"st":"done","sent":2,"fail":0,"key1":"p7b-ui-forced-345","s1":"success","key2":"dryrun:346"}} | ok |

截图（gitignored）：`tmp/p7b-shot-list.png`（列表那一屏：演练徽标、状态、20/20 进度条 100%）、`tmp/p7b-shot-detail.png`（详情那一屏：20 行 seq 1..20、撤回勾选整列禁用 + 那句「演练任务没有真发过」）。

R11 那条腿的归因靠两种互斥的 `msgKey` 前缀：布景那两行由驱动用 HTTP 写成 `p7b-ui-forced-<detailId>`，而引擎的演练出料口只会产 `dryrun:<detailId>`——所以 `dryrun:346` 出现的那一行必然是"引擎真重跑过"，不是"布景残留"（实测）。行 1 在同一次单条重发后仍是 `p7b-ui-forced-345` + `success`，这一格证的是"单条重发不误伤别人"。

### 4c. 这一腿抓到的真缺陷：短跑的明细永远不刷（已修）

第一版 detail-ui 是 5/6，#6 只报出 `row2: null`——那份输出把「行找不着」「行还停在待发送」「msgKey 前缀不对」三种长相全塌成一个 `null`，归因只能靠猜。驱动先补了 `pollTrail`（每帧无条件记读数，并同帧带一次 `GET /tasks/{id}`），补完第一次跑就看清了：

- 修复前：20 s 窗口内 **41 帧**，DOM 全程 `["待发送","—"]`，同帧 API 全程 `done`，行 2 元素在场。不是元素没挂，是明细那一屏**没有任何刷新触发器**。
- 根因（读码 `BatchTaskDetail.tsx` + `api/batchSend.ts`）：明细的 2 s 节律只在 `status === 'running'` 时开着，而单条重发跑不满一拍（trail 只有 2 帧就 done）；`batch:state` 事件又只覆盖任务与列表两个 key，明细不在它的管辖里。于是表头说「已完成 · 已发 2」、那一行永远停在「待发送」——一张自相矛盾的表。
- 修法（`8458716`）：`BatchTaskDetail` 认**换档**补一刷——任务状态一变就按 `[batch, details, taskId]` 前缀作废明细。判据取 GET 回来的状态而不是事件本身：`finish()` 先等所有 reports 落地、再 GET、再广播，所以读到 `done` 那一档时行状态一定已经结清，跟着刷一次拿到的是同一份真值，不会刷出半张旧表。失效口径收进 `invalidateBatchDetails`，重发与撤回两个 mutate 改走同一处（key 前缀散在三处就会有人漏刷）。
- 修复后：trail 两帧 `[4ms, ["待发送","—"], "paused"] → [516ms, ["成功","dryrun:346"], "done"]`（实测），6/6、exit 0。

**驱动另补一条前置**：渲染层整页 `location.reload()` 一次再跑（常驻 dev 页可能还拿着改动前的模块图），hash 由轮询逐拍重设。

---

## 5. 真实档两格（待验证，需用户在场）

| 格 | 怎么做 | 读什么 | 状态 |
| --- | --- | --- | --- |
| 真发 1 条 | `dryRun=false`、1 收件人 × 1 内容、`msgMin=3/msgMax=3/chatMin=5/chatMax=5`，收件人必须是用户当场指定的那一个会话，用户点头后点「开始」 | `msgKey` 不带 `dryrun:` 前缀、`sentAt` 有值、明细 `success` | **待验证（需用户在场并明确放行）** |
| 真撤回 1 次 | 对刚发那条勾「撤回已发」并提交 | `recall_status` = `recalled` 或 `recall_failed`；`recall_detail` 的原文（超出 WhatsApp 时间窗那一格就是要抄的串，spec §11.2） | **待验证（需用户在场并明确放行）** |

这两格之外不许真发：群发的形状决定了"多发一条"不可回收。

已读码确认、但只有真机能结的部分：页内撤回的结论只看 `isRevoked`（读码 `src/bridge/whatsapp/recall.ts`）；`deleteMessage` 第四位在真机上是否真走到"对所有人撤回"仍是 **待验证**（spec §11.1）。

---

## 6. 已知行为（裁定为接受，写在这里免得日后被当疏漏）

1. **失败路径 `api.task` 读两次**：一次拿现状用于回滚判断，一次拿权威徽标。代价一个来回，换来徽标只认 GET 那一份。
2. **`batch:recall` 的 IPC promise 会按节律 Hold 满整批**（≈ `chat_interval` × 条数）：撤回逐条之间要按同一份节律走，这是终审 I-5 的必然后果、与 spec §5 一致。含义是给撤回 mutation 加"超时"之前要先看清——promise 没做完不等于没在撤。
3. **暂停不是"立刻冻住"**：在飞的那一行会结清（每账号至多一行），见 §4a #7。取消之后 `skipped` 由后端 `skipAllPending` 一条 SQL 落，`unknown` 由熔断/桥离线那两格由引擎逐条报，`recalling` 孤儿由 `reconcile` 第三拍结回 `recall_failed`——三个去处各有各自的作者。
4. **明细刷新节律**：running 期间 2 s 一刷，非 running 只在换档那一刷（§4c）。事件不 invalidate 明细是刻意的——演练任务 0 秒间隔一秒能广播几百个 `batch:state`，每一个都刷明细就是对本地后端自 DDoS。

---

## 7. V1 缺口登记（都不阻塞本功能收口，逐条有名有姓）

| 缺口 | 现状 | 为什么 V1 不做 |
| --- | --- | --- |
| `unknown` 行没有人工裁决入口 | 只有显示：文案「结果未知（可能已发出），不自动重发」；`retryFailed` 的 WHERE 不含它，撤回资格也不含它 | spec §2 写了"只能由人工裁决改写"，但 V1 没有那个入口——**这是 spec 与实现的缺口，已回填进 spec §10** |
| running 途中被后端复位成 `pending` 的行不会被捡回队列 | 队列是 `engine.start` 之前的快照，`buildQueues` 只捡 `pending`；要重跑得 暂停 → 继续 | 改运行中重扫 = 双发风险；暂停→继续是明示路径 |
| `ReportBacklog` 头部若有一行永久被拒（如 400）会挡住后续上报 | 结清载荷已按 `REPORT_DETAIL_MAX=255` 截断（终审 I-1），把最可能的 400 源堵在门外；隔离"永久被拒头部"没做 | 截断后没有已知的永久 400 形状；先不加隔离层 |
| 熔断只对"连续 3 条同类失败"的账号生效，`unknown` 不计入 | 按 spec §5 的口径实现 | `unknown` 可能已送达，把它算成熔断依据会误停好账号 |
| 同一任务连点两次「开始」不产生第二条泵，但没有库内证人 | 宿主用 `running` 表 + 在飞标记挡住（读码）；契约与 CDP 两腿都没测这一格 | 要证它得在库里放两个心跳作者，V1 不值得 |
| 明细/预览的可测性：没有 `data-batch-action` 之类的测试锚点 | CDP 驱动按 `value` / 数据属性 / 结构选择器认元素（按钮只能按文案，且只读回它自己那一行） | 加测试 id 是给驱动用的产品属性，暂缓 |
| 上限与预览文案没有 `aria-live` | 文案变化不会被读屏播报 | 与 A 系列无障碍欠账同批处理 |
| 向导 1000 收件人上限只挡「下一步」与创建，输入期无渐进提示 | 终审 F2 落的两档 | 观感问题 |

---

## 8. 遗留数据（`smartscrm_react`，不删）

本轮各腿在 `batch_send_task` 留下 **78** 条任务（`GET /api/batch-send/tasks` 分页现读）：**66 cancelled / 11 done / 1 pending**。

- 唯一 `pending` 的是 `1:tenant-gate-smoke`（Task 6 的租户闸夹具，从未起泵）。
- `p7b-*` 前缀的是本轮 CDP 两腿（列表腿 20 行、重发腿 2 行、执行腿 20 行 × 多张），`p7t6 *` 前缀的是契约驱动的夹具。
- 每条退出路径都 `cancel` 过，收尾打印 `sending_after=0`；库里没有 `sending`/`recalling` 悬空行。
- 这一库是本地演练库，不是生产库；`smartscrm`（42 张表的老库）本轮未被连接过。

---

## 9. 复现方式（驱动全部在 `tmp/`，gitignored，不进提交）

| 驱动 | 跑法 | 前置 |
| --- | --- | --- |
| `tmp/p7b-batch-contract.mjs` | `node tmp/p7b-batch-contract.mjs` | `:8180` 在线（当前 Java 构建） |
| `tmp/p7b-dry-run.mjs` | 抬窗口 + `node tmp/p7b-dry-run.mjs` | dev 应用已重启（`src/main` 改过必须重启，dev watcher 不重载主进程）、已登录、人工打开一个 WhatsApp 会话 |
| `tmp/p7b-detail-ui.mjs` | 抬窗口 + `node tmp/p7b-detail-ui.mjs` | 同上（只吃渲染层，不吃会话） |
| `tmp/p7b-detail-ui-spotof-selftest.mjs` | `node ...` | 改 `spotOf` 或四个 finder 形状之前先跑它 |
| `tmp/p7b-dryrun7-after.mjs` | `node ... <taskId>` | 只读探针，不写库 |

退出码口径（两腿一致）：`0` 全绿；`1` 断言红或运行期异常；`2` 环境前提没成（登录 / 后端不可达 / 凑不出 ≥10 条会话的账号 / 布景 HTTP 没成）；`4` 点击环境前提没成（窗口不可见、target 不在、没挂 preload、崩场残留 `pointer-events:none`）。红与"没跑成"永远分两个码。
