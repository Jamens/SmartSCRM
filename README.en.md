# SmartSCRM

Electron + React + TypeScript desktop SCRM client with a Spring Boot + MySQL backend.
This file documents the **architecture** and **what each file is for**, so a new maintainer can pick up development or run a self-check. Chinese version: [README.md](./README.md) (default).

- Branch: `main`
- Delivered: P0 scaffold → P1 login / window shell → P2 platform accounts + embedded views → P3 customers → P4 materials / quick replies → P5 translation center → P6 chat history
- Not delivered: Telegram collect / send chains, bulk send, group analytics, script engine, proxy & fingerprint, cloud phone, reports, settings page, i18n
- Audit and risk register (every claim carries `file:line`): [docs/notes/2026-09-25-module-audit.md](./docs/notes/2026-09-25-module-audit.md)

## 1. Requirements

| Dependency | Version / note |
|---|---|
| Node.js | `>=20.19.0` (root `package.json` `engines`) |
| Package manager | **pnpm** (`packageManager: pnpm@11.18.0`). Never npm / npx in this repo |
| JDK | 17 (example path `C:/Program Files/Java/jdk-17.0.18`) |
| MySQL | 8, local `localhost:3306`, user `root`, database `smartscrm_react` (auto-created via `createDatabaseIfNotExist=true`) |

`apps/server/src/main/resources/application.yml` is the single backend config entry point: datasource at `:5-9`, server port at `:17` (`8180`), JWT secret and the two TTLs at `:27-31`, log level at `:33-35` (`com.smartscrm: debug` ⇒ MyBatis prints every SQL statement, its bound parameters and the row count).

## 2. Running

```bash
# 0) install (repo root)
pnpm install

# 1) backend (Flyway applies V1..V8; DataSeeder plants seed users)
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
cd apps/server && ./mvnw spring-boot:run

# 2) desktop app (new terminal, repo root; `predev` builds the two page-side bundles first)
pnpm dev:desktop
```

Health check: `GET http://localhost:8180/api/health` (one of the three anonymous endpoints permitted at `SecurityConfig.java:43`; the others are login and refresh).

Seed logins: invite code `DEMO0001`, users `admin` / `agent01`; `QA0002` exists for cross-tenant isolation checks (`config/DataSeeder.java`).

## 3. Top-level layout

```
SmartSCRM/
├── apps/
│   ├── desktop/          # Electron + React 19 + TS (electron-vite, Tailwind v4 + shadcn/ui)
│   └── server/           # Spring Boot 3.5 + Java 17 + MyBatis-Plus + Flyway
├── packages/
│   └── shared/           # Shared TS types / API contract
├── docs/
│   ├── superpowers/specs/  # design docs (one per phase; the authority plans argue from)
│   ├── superpowers/plans/  # implementation plans (task by task, with test steps)
│   ├── notes/              # acceptance records, the audit, deferral notes
│   └── feature-checklist.md
├── tmp/                  # local verification scripts and logs (git-ignored)
└── README.md / README.en.md
```

## 4. Backend (`apps/server`)

Layering is `controller → service → mapper → entity`, with cross-cutting code in `security` / `config` / `common`. Note that **controllers live in the `web/` package** (`web/*Controller.java`), request bodies in `web/dto/` and response bodies in `web/vo/` — there is no `controller` package. Every response uses `ApiResponse{code,message,data}`; only `code==0` means success.

### 4.1 How a request is authenticated

```
HTTP request
 → security/JwtAuthFilter.doFilterInternal   read Bearer token, parse claims, populate SecurityContext
 → config/SecurityConfig                     stateless + default-deny; login/refresh/health permitted; 401 → code 40100
 → Controller                                @AuthenticationPrincipal AuthPrincipal → userId/tenantId/inviteCode/role
 → Service                                   every query adds eq(tenantId) by hand (that IS the isolation, see §7)
 → common/GlobalExceptionHandler             collapses controller/service exceptions into the envelope (filter-level throws bypass it — see audit R-04)
```

| File | Purpose |
|---|---|
| `security/JwtService.java` | issues / parses access and refresh tokens; claims are `tid`, `ic`, `role`, `typ` (access/refresh) |
| `security/JwtAuthFilter.java` | `OncePerRequestFilter`; authentication is only established when `typ=="access"` |
| `security/AuthPrincipal.java` | record representing "who is logged in" in controllers |
| `config/SecurityConfig.java` | stateless sessions, default-deny, 401 body, CORS allowed origins |
| `config/MybatisPlusConfig.java` | pagination plugin, etc. |
| `config/DataSeeder.java` | plants the DEMO0001 / QA0002 seeds on first start |
| `common/ApiResponse.java` | response envelope |
| `common/BizException.java` | exception carrying HTTP status + business code |
| `common/GlobalExceptionHandler.java` | `@RestControllerAdvice`: business / validation / catch-all 50000 |
| `common/PageResult.java` | paged result shape |

### 4.2 Feature surface (by phase)

| Phase | Controller | Service | Notes |
|---|---|---|---|
| P1 | `AuthController` | `AuthService` | login, refresh, `me`; BCrypt check, device registration, dual token |
| P2a | `PlatformAccountController` | `PlatformAccountService` | platform account CRUD + status; `viewId` identifies the embedded view / partition |
| P3 | `CustomerController` / `LabelController` / `AudienceController` | `CustomerService` / `LabelService` / `AudienceService` | customers, label groups/labels, audiences; `CustomerService.countMatching` is the single member-count algorithm |
| P4 | `MaterialController` / `QuickReplyController` | `MaterialService` / `QuickReplyService` | material groups/items, quick-reply groups/replies/items |
| P5 | `TranslationController` | `TranslationService` + `SimulatedTranslationEngine` + `PhraseDict` + `service/provider/*` | direction settings (global / per customer), cache, latency probes, credentials |
| P6 | `MessageController` / `ConversationController` | `MessageService` (writes) + `MessageQueryService` (reads) | batch ingest, status advance, list/cursor/search/stats/timeline |

`service/msg/` holds **stateless pure functions** — the main target of the Java unit tests:

| File | Purpose |
|---|---|
| `ChatKeys.java` | `chat_key` shape rules (`@c.us` 1:1 / `@g.us` group / TG numeric id), platform inference, phone normalization |
| `MsgTimes.java` | epoch seconds → `DATETIME(3)`; clamps implausible timestamps to ingest time |
| `StatusLadder.java` | monotonic send-status ladder (`pending→sent→delivered→read`, `failed` as side branch) |
| `Cursors.java` | `(time,id)` cursor encode / decode |
| `SearchPattern.java` | LIKE escaping plus the "blank query short-circuits" rule |
| `ScopeSettings.java` | **the single direction resolver**: per-customer override if present, otherwise global |

`service/provider/` is the vendor adapter layer: `TranslationProvider` (interface), `BaiduProvider`, `TencentProvider`, `Tc3Signer` (Tencent signing), `Credentials`, `ProviderResult`, `ProviderException`. The routing table lives at `TranslationService.java:53-55` — only channel 5→Baidu and 7→Tencent; every other channel uses the simulated engine.

### 4.3 Schema and migrations (`src/main/resources/db/migration`)

| Migration | Creates | Key constraints |
|---|---|---|
| `V1__baseline_tenant_user_device.sql` | `tenant` / `app_user` / `device` | multi-tenant root |
| `V2__platform_account.sql` | `platform_account` | `viewId` unique per tenant |
| `V3__customer_domain.sql` | `customer` / `label_group` / `label` / `customer_label` / `customer_audience` | `uk_customer_tenant_platform_openid`; `customer_label` cascades to both sides |
| `V4__reply_material.sql` | material and quick-reply tables | `material→group` is `SET NULL`; `quick_reply_item→quick_reply` is `CASCADE` |
| `V5__translation.sql` | `translation_setting` / `translation_node` / `translation_cache` / `translation_phrase` | `uk_tset_tenant_scope`; `uk_tcache_tenant_key` |
| `V6__translation_channel_comment.sql` | channel value comments | — |
| `V7__translation_credential.sql` | `translation_credential` | per-tenant keys, always masked on read |
| `V8__chat_history.sql` | `chat_conversation` / `chat_message` | `uk_conv`, `uk_msg` (idempotency key), `idx_msg_conv`, `idx_msg_customer`; **`ON DELETE CASCADE` from `platform_account` on both tables** |

## 5. Desktop (`apps/desktop`)

Four process boundaries; read them in this order: **renderer (business UI) / main (windows, embedded views, ingest delivery, sending) / inject (translation layer running inside the third-party page) / bridge (collect + send executor inside that page)**.

```
                    ┌──────────────── main window (local React) ────────────────────────────┐
                    │ pages/ (9) · components/ · stores/(zustand) · api/ · lib/http.ts        │
                    └───────────────┬──────────────────────────────────────┬─────────────────┘
                          preload/index.ts (window.scrm)          preload/view.ts (window.ele)
                                    │                              ↑ embedded views only, no token
                    ┌───────────────▼──────────────────────────────┴──────┐
                    │ main: window/ · webContentsView/ · services/ · state/ │
                    └───┬────────────────────────────────────────┬────────┘
             executeJavaScript inject                  msg:live / msg-report
                    │                                        │
        ┌───────────▼───────────────┐          ┌─────────────▼──────────────┐
        │ inject.bundle.js (in page) │          │ msg-bridge.bundle.js + wa-js│
        │ bubbles / input preview    │          │ collect+normalize / send     │
        └────────────────────────────┘          └────────────────────────────┘
```

### 5.1 `src/main`

| File | Purpose |
|---|---|
| `index.ts` | entry: single-instance lock, `registerIpcHandlers` → `startMsgBridge` → window → tray; `before-quit` calls `stopMsgBridge()` + `destroyAll()` |
| `ipc.ts` | renderer-facing channels and window events (minimize / maximize / close) |
| `window/mainWindow.ts` | main `BrowserWindow`; dev uses `loadURL(ELECTRON_RENDERER_URL)`, packaged uses `loadFile(...)`; `webSecurity: true` |
| `window/tray.ts` | system tray |
| `webContentsView/manager.ts` | **embedded view lifecycle**: `createView` (partition `persist:scrm-${viewId}`, `sandbox`/`contextIsolation` on, `nodeIntegration` off), UA set before load, re-inject on `dom-ready`, bounds sync, `window.open` denied and handed to the external browser, cross-site navigation guard, `destroyView`/`unmountView`/`uninject` |
| `webContentsView/ipc.ts` | three channel allowlists (11 host / 1 invoke / a few push), 20 req/s limit on `view:invoke`, text ≤ 5000 chars, **main process stamps `accountId`+`chatKey` onto translation requests** (surface ②) |
| `webContentsView/chromeUserAgent.ts` | standard Chrome UA generation (third-party sites must see a normal browser) |
| `services/authedFetch.ts` | token-carrying fetch in main, 5 s timeout, one refresh on 401 |
| `services/translationBridge.ts` | calls `/api/translation/translate` and hands the result back to inject / renderer |
| `services/msgBridge/index.ts` | collect + send controller: account mount, login observation, `handleBridgeReport` (ack and backfill progress), `sendText`, `requestBackfill`, `unmountView`, `stopMsgBridge` |
| `services/msgBridge/collectorHub.ts` | **buffering and delivery**: groups by `(accountId, activeChatKey)`, flush at 500 messages or 2 s, 10000-slot queue that drops oldest on overflow, failed groups re-queued at the head, rejected rows summarized in one warn line (never message bodies) |
| `services/msgBridge/msgApi.ts` | `/api/messages/batch`, `/api/messages/status`, account list reads |
| `services/msgBridge/sendRegistry.ts` | `SendRegistry` (`localId` → invoke receipt, 20 s timeout, settled at once when the view dies) and `SendAttribution` (`msgKey → localId` claim) |
| `services/msgBridge/bridgeMount.ts` | two-stage page load: wa-js first, then the bridge; reports versions and phase |
| `services/msgBridge/accountDirectory.ts` | `viewId ↔ account` lookup (the source of the stamped `accountId`) |
| `state/session.ts` | session persistence: `userData/scrm-session.bin`, `safeStorage` when available, plaintext otherwise |

### 5.2 `src/preload`

| File | Purpose |
|---|---|
| `index.ts` | exposes `window.scrm` (`session` / `win` / `view` / `msg`) and `window.electron` to the main window |
| `view.ts` | exposes **only** `window.ele` (`sendToHost` / `send` / `invoke` / `on`) to embedded views — no token, no window controls |
| `index.d.ts` | typings for `window.scrm` |

### 5.3 `src/renderer/src`

| Path | Purpose |
|---|---|
| `App.tsx` | `HashRouter` + route table; unauthenticated renders `LoginPage` |
| `layouts/AppLayout.tsx` | shell: `TitleBar` + `ModuleRail` + `AccountSidebar` + content area |
| `pages/` | 9 pages: `HomePage`, `MessagesPage`, `CustomersPage`, `LabelsPage`, `AudiencesPage`, `QuickRepliesPage`, `MaterialsPage`, `TranslationPage`, `LoginPage` |
| `components/AccountSidebar.tsx` | account list + add/delete (delete also destroys the view) |
| `components/AccountStage.tsx` | view stage: measures container bounds, passes `injectConfig` (incl. `apiBase`) to main |
| `components/AddAccountDialog.tsx` / `ModuleRail.tsx` / `TitleBar.tsx` / `ModulePlaceholder.tsx` | new-account dialog / module rail / custom title bar / not-yet-built placeholder |
| `components/messages/` | 9 chat-history parts: `ConversationList`, `ConversationActions` (header direction popover), `CreateCustomerDialog`, `CustomerDirectionDialog`, `MessageThread`, `MessageBubble`, `ReplyComposer`, `SearchPanel` (300 ms debounce), `StatsCards` |
| `components/customers/` | `CustomerDrawer`, `CustomerTimeline` (timeline + jump back to the history page) |
| `components/translation/LangSelect.tsx` | language picker |
| `components/ui/` | 11 shadcn primitives |
| `api/` | per-domain backend calls: `customers` `labels` `audiences` `materials` `quickReplies` `messages` `translation` |
| `stores/auth.ts` | auth state: tokens stored only through `window.scrm.session` (never localStorage), restored on boot |
| `stores/accounts.ts` | account list and current account |
| `stores/chatJump.ts` | one-shot handoff: the drawer calls `hold(conversation)`, the history page takes it and `clear()`s (the whole `ConversationVO`, deliberately not a route param — `chat_key` contains `@`/`.`/hyphens and shouldn't show in the address bar) |
| `hooks/useWebContentsView.ts` | React-side wiring of the view lifecycle to its container |
| `hooks/useDebouncedValue.ts` | input debouncing |
| `lib/http.ts` | **the renderer's only egress**: base from `VITE_API_BASE`, one automatic refresh on 401, `code!=0` throws `ApiError` |
| `lib/translationSync.ts` / `lib/loginStatusSync.ts` | sync inject-layer signals into the UI |
| `lib/chatDisplay.ts` `chatDays.ts` `chatSearch.ts` `chatStats.ts` `chatTimeline.ts` `sendDraft.ts` `sendError.ts` `directionDraft.ts` `createCustomerPrefill.ts` `nodeSelect.ts` `langData.ts` `platform.ts` `nav.ts` `device.ts` | pure display/computation helpers, each with a matching `.test.ts` |
| `services/viewService.ts` / `viewOverlay.ts` / `msgService.ts` | thin wrappers over `window.scrm` |

### 5.4 `src/inject` (bundled into `resources/inject.bundle.js`)

| File | Purpose |
|---|---|
| `index.ts` | entry: picks the platform adapter; pre-installs `window.__SCRM_DESTROY__` for unmounting |
| `core/BaseInjector.ts` | lifecycle: adapter init, host IPC wiring, mount, 3 s login poll, destroy |
| `core/PlatformAdapter.ts` | adapter interface (selectors + platform differences) |
| `core/StateManager.ts` | in-page state: `translationRevision` (push invalidation), `translatedMsgIds` (dedupe) |
| `core/translation/messageState.ts` | per-message state table + throttling |
| `core/translation/domScan.ts` | scans the DOM for untranslated messages, uses revision to decide repaints |
| `core/translation/renderTranslation.ts` | bubble rendering |
| `core/translation/bubbleDirection.ts` | which direction this bubble uses (pairs with surface ②) |
| `core/translation/inputPreview.ts` | pre-send translation preview in the composer |
| `core/translation/manualButton.ts` | manual translate button |
| `core/translation/translationQueue.ts` | request queue and concurrency |
| `core/editorText.ts` | writing text into the rich-text composer (`execCommand insertText` route) |
| `core/featureFlag.ts` | in-page flags |
| `platforms/whatsapp/{index,selectors}.ts` | WhatsApp adapter and selector list |
| `platforms/telegram/{index,selectors}.ts` | Telegram adapter skeleton (**not wired up**, see §7) |
| `constants/{channels,config,events}.ts` | channel names, poll interval, event names |
| `shared/ui/badge.ts` `utils/event-emitter.ts` `types.ts` | small UI helper, emitter, types |

### 5.5 `src/bridge` (bundled into `resources/msg-bridge.bundle.js`)

| File | Purpose |
|---|---|
| `index.ts` | bridge entry: reports ready to main, receives commands |
| `host.ts` | send/receive wrapper over `window.ele` |
| `types.ts` | frame types aligned with `shared/` |
| `whatsapp/collect.ts` | conversation/message collection and backfill |
| `whatsapp/normalize.ts` | raw objects → `NormalizedMessage` (`chatKey`/`msgKey`/direction/media type) |
| `whatsapp/send.ts` | real send: switch conversation → write composer → click send → report `send_result` |

### 5.6 `src/shared` — pure models used by both sides

`chatTypes.ts` (frame shapes), `chatKeys.ts`, `chatTime.ts`, `chatStatus.ts`, `chatPlatform.ts`, `liveTail.ts` (tail merge / optimistic row settlement / status advance), `translateKey.ts`, each with `.test.ts`. This is where "the renderer and the bridge understand the same message" is pinned down. **Runs directly on `node:test`.**

### 5.7 Build scripts and artifacts

| Path | Purpose |
|---|---|
| `scripts/build-inject.mjs` | esbuild IIFE → `resources/inject.bundle.js`; production adds `minify` + `drop:['console']`, only watch emits an inline sourcemap |
| `scripts/build-bridge.mjs` | builds `resources/msg-bridge.bundle.js` and copies `@wppconnect/wa-js` verbatim to `resources/wa-js.bundle.js` (two artifacts on purpose: size and upgrade cadence differ) |
| `resources/*.bundle.js` | generated; all git-ignored; `electron-builder.yml` ships them via `extraResources` |
| `electron.vite.config.ts` | three-entry build config (main / preload / renderer) |
| `tsconfig.{node,web,inject,unit}.json` | four typecheck surfaces with different boundaries (renderer cannot reach Node APIs; inject cannot reach Electron APIs) |

## 6. Testing and verification

```bash
# renderer / main / shared / bridge — 22 test files on node:test
cd apps/desktop && pnpm test:unit

# backend pure functions and adapters — 10 test classes
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
cd apps/server && ./mvnw test

# all four typecheck surfaces
cd apps/desktop && pnpm typecheck

# package (includes the inject/bridge bundles)
cd apps/desktop && pnpm build && pnpm build:win
```

Conventions:

- **Free `:8180` before `mvn package`**, otherwise port contention produces misleading results.
- Don't pass `-q` when surefire output matters; prefer `set -o pipefail`.
- Backend HTTP contract checks live as scripts in the git-ignored `tmp/` (~409 `.mjs` files); they are the real coverage for "the API behaves as specified". Chinese request bodies go through a UTF-8 file, never inline on the command line.
- Renderer interaction checks run over CDP with the **window raised and `visibilityState==='visible'`**, using real `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText` — never `element.click()`.
- Delivered conclusions: `docs/notes/2026-09-20-p6-chat-history-verification.md` (P6 end-to-end acceptance) and `docs/superpowers/specs/2026-09-19-translation-center-design.md` §6.3 (in-page translation chain).

## 7. Known limitations and gaps (not visible from reading the code alone)

1. **Telegram collect / send chains are not implemented.** `inject/platforms/telegram/` has skeletons but no real-device DOM probe and no end-to-end verification. The TG `chat_key` shape is already defined in `V8__chat_history.sql:17` (numeric chat id) and the backend platform whitelist already includes `telegram` (`MessageQueryService.java:43`). **Beyond opening the page in a view, nothing there has been verified.**
2. **Deleting a platform account cascade-deletes all of its chat history** (`V8__chat_history.sql:30/59`), and the sidebar delete button has no confirmation. The archive is not regenerable — export first or flip the status field instead.
3. **Chat messages have no FK to customers**: `chat_conversation.customer_id` (`V8__chat_history.sql:20`) is unconstrained, so deleting a customer leaves dangling heads and the customer timeline becomes unreachable.
4. **Dictionary changes require a backend restart**: `PhraseDict` loads once on first access and never invalidates (`service/PhraseDict.java:51-70`), and there is no phrase management endpoint.
5. **Global search is `body LIKE '%q%'`** (`MessageQueryService.java:190`) with no usable index. FULLTEXT/ngram is the scaling path.
6. **The packaged build has never been verified**: the renderer runs on `http://localhost` in dev but `file://` when packaged (`mainWindow.ts:66`), while CORS allows `http://localhost:*`, `http://127.0.0.1:*`, `file://*` (`SecurityConfig.java:64`). A `file://` document sends `Origin: null`, so the packaged app is expected to be blocked — **untested; verify this first.**
7. **Authentication exists, authorization does not**: no `@PreAuthorize` / `hasRole` anywhere; `role` is issued but never consulted. The only isolation dimension is `tenant_id`.
8. **There is no request-level logging in the backend**: application code emits only two `log.info` calls (both in `DataSeeder`), and `GlobalExceptionHandler` has no logger and swallows the stack (`common/GlobalExceptionHandler.java:25-28`). What you do get at runtime is MyBatis DEBUG SQL (`application.yml:33-35`) — "what was queried", never "which request failed or was slow". Debugging means adding your own logging or querying the DB.
9. **Page-side bundles drop `console` in production** (`build-inject.mjs:27`, `build-bridge.mjs:35`), so internal inject-layer errors neither surface nor leave a trace.
10. **The Tencent translation route is not end-to-end verified**; see `docs/notes/2026-09-20-tencent-online-translation-deferred.md`.
11. `docs/notes/2026-09-22-legacy-feature-gap.md` (feature gap table) is **deliberately not committed** — local only.

## 8. What's next

From the task queue (details in `docs/feature-checklist.md`):

- P6 wrap-up: taskbar unread badge, settings page (theme switch, device info section)
- Telegram chain: real-device DOM probe → inject selectors → collect → send
- Priority fixes listed in the audit's §12 (delete confirmation, `apiBase` allowlist, collector retry stall, `nickname` clearing, `refresh` re-checking tenant status)

## 9. Commit conventions

- One commit per verified feature, prefixed `feat:` / `fix:` / `refa:` / `update:`, optionally scoped (`feat(P6): ...`).
- One task = one commit, made by whoever completed its verification.
- Commit only — pushing is done manually by the maintainer.
- Docs, comments and specs describe this project's design only; no comparison against other implementations.
