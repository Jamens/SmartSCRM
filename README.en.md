# SmartSCRM

Electron + React + TypeScript desktop SCRM client with a Spring Boot + MySQL backend.
This file documents the **architecture** and **what each file is for**, so a new maintainer can pick up development or run a self-check. Chinese version: [README.md](./README.md) (default).

- Branch: `main`
- Delivered: P0 scaffold → ... → P6 chat history → **P7 batch send (B7) + conversation-level settings (B16)** → **settings page (A12 badge / A13 theme / A14 device info / A15)**
- **In progress: P8 group member analysis (B6)** — data layer and bridge side delivered, main-process build pump and renderer pending (see §10)
- Not delivered: Telegram collect / send chains, script engine, proxy & fingerprint, cloud phone, reports, i18n
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

# 1) backend (Flyway applies V1..V12; DataSeeder plants seed users)
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
# renderer / main / shared / bridge — 36 test files (295 assertions) on node:test
cd apps/desktop && pnpm test:unit

# backend pure functions and adapters — 20 test classes (118)
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
2. **Deleting a platform account cascade-deletes all of its chat history** (`V8__chat_history.sql:30/59`, plus the three group tables shaped the same way in `V12__group_member_analysis.sql:30/62/91`). The misclick half is now intercepted: the sidebar trash icon opens `DeleteAccountDialog`, which reports five cumulative counts (`GET /api/platform-accounts/{id}/impact`) and waits for an explicit confirmation (2026-10-08, see the §12-1 entry in §8). **The cascade itself is unchanged and there is no recycle bin / undo** — the archive is not regenerable, so export first or flip the status field instead.
3. **Chat messages have no FK to customers**: `chat_conversation.customer_id` (`V8__chat_history.sql:20`) is unconstrained, so deleting a customer leaves dangling heads and the customer timeline becomes unreachable.
4. **Dictionary changes require a backend restart**: `PhraseDict` loads once on first access and never invalidates (`service/PhraseDict.java:51-70`), and there is no phrase management endpoint.
5. **Global search is `body LIKE '%q%'`** (`MessageQueryService.java:190`) with no usable index. FULLTEXT/ngram is the scaling path.
6. **The packaged-mode CORS worry is disproven by measurement (2026-10-07), but the electron-builder artifact is still unverified**: this entry previously read "a `file://` document sends `Origin: null`, so the packaged app is expected to be blocked" — **that inference was wrong and is now retracted**. Measured (Electron 39.8.10, `webSecurity: true`, A/B controlled): cross-origin requests from a `file://` page **carry no `Origin` header at all and trigger no preflight**; the server only sees `Sec-Fetch-Site: cross-site`, so `DefaultCorsProcessor` short-circuits on `requestOrigin == null` and the request goes through. The same probe on an `http://` page does send a preflight and gets blocked for the missing ACAO header, which proves the probe itself is sound. Two more worries fall with it: `electron-vite` emits **relative** asset paths (`./assets/…`, which resolve fine under `file://`, so no `base` override is needed), and the built renderer **renders the login page correctly under `file://`** (React mounts, Tailwind applies, i18n correct, zero load errors). Screenshots and probe scripts are in `tmp/` (`packaged_probe_main.js` / `cors_probe*` / `cdp_probe.mjs`). `CorsOriginTest` locks in the two real rules: loopback origins allowed, external origins rejected. **Additionally, the login path is verified end-to-end** (2026-10-07, with the backend up against MySQL 8.0.45): the built artifact starts from `file://`, the form is filled in-page and "登 录" clicked, then `POST /api/auth/login` → `/api/auth/me` → main UI, with all 25 nav entries and the home overview rendering real database data (4 of 8 platform accounts, 6 customers, 78 broadcast tasks, LINE 2/3 online) — and B12's "升级套餐" button shows up correctly in the packaged artifact. Probe: `tmp/e2e_login_probe.mjs`. **Also: the electron-builder distribution chain now works, and it surfaced a real bug (2026-10-07).** `build:unpack` produced `dist/win-unpacked/desktop.exe` (202 MB, `resources/app.asar` 69 MB, the three `extraResources` bundles correctly placed *outside* the asar), and the real exe boots with a CDP target URL of `file:///.../resources/app.asar/out/renderer/index.html` — so **asar-internal `__dirname` resolution works**; it also restored the session left by the previous E2E run and went straight into the main UI (renderer identical to the dev build, item by item). `build:win` produced the **NSIS installer `desktop-0.1.0-setup.exe` (97 MB, valid PE) + `.blockmap` + `latest.yml`** (the electron-updater manifest with sha512/size/releaseDate, so A6's metadata side is now verified too). **Bug found and fixed**: all three `artifactName` entries in `electron-builder.yml` used `${name}`, but this package is **scoped** (`@smartscrm/desktop`), so the `/` was treated as a path separator → the output path became `dist\@smartscrm\...`, a directory electron-builder never creates → makensis aborted with `Can't open output file`. All three now use `${productName}` (`desktop`, no slash). **Three items remain unverified and need someone present**: actually running the installer (writes to Program Files, creates shortcuts, registers the uninstaller), code signing (no certificate, so the current artifact is unsigned), and auto-update **download and apply** (needs a deployer-hosted update source; `publish.url` is still the `example.com` placeholder, which is correct under the open-source red line).
7. **Authentication exists, authorization does not — desktop / tenant-side only**: the desktop business APIs (`/api/materials`, `/api/messages`, etc.) have no `@PreAuthorize` / `hasRole`; `role` is issued but never consulted, and the only isolation dimension is `tenant_id`. **This no longer holds for the admin side**: `/api/admin/**` is guarded by `AdminPermissionInterceptor`, which resolves `menuCodes` from the database on every request and converts them into authorities; `@EnableMethodSecurity` is enabled (see the A16 entry in §8).
8. **There is no request-level logging in the backend**: application code emits only two `log.info` calls (both in `DataSeeder`), and `GlobalExceptionHandler` has no logger and swallows the stack (`common/GlobalExceptionHandler.java:25-28`). What you do get at runtime is MyBatis DEBUG SQL (`application.yml:33-35`) — "what was queried", never "which request failed or was slow". Debugging means adding your own logging or querying the DB.
9. **Page-side bundles drop `console` in production** (`build-inject.mjs:27`, `build-bridge.mjs:35`), so internal inject-layer errors neither surface nor leave a trace.
10. **The Tencent translation route is not end-to-end verified**; see `docs/notes/2026-09-20-tencent-online-translation-deferred.md`.
11. `docs/notes/2026-09-22-legacy-feature-gap.md` (feature gap table) is **deliberately not committed** — local only.

## 8. What's next

From the task queue (details in `docs/feature-checklist.md` and `docs/feature-backlog.md`):

- **§12-1 delete confirmation + impact counts (latest, delivered 2026-10-08)** — item 1 of the audit's §12 priority list (R-13/R-52). **Backend**: new read-only `GET /api/platform-accounts/{id}/impact` (`AccountImpactService` + `AccountImpactVO`, `@PreAuthorize('account:read')` — a confirmation dialog must be able to ask before the destructive click, so it must not require write rights to see what would be lost). Returns five **cumulative** counts (`conversations/messages/groups/memberStates/memberEvents`) mapping one-to-one onto the five `ON DELETE CASCADE` edges out of `platform_account` (`V8:30/59`, `V12:30/62/91`); the tenant gate reuses `PlatformAccountService.requireOwned` (made public), so delete, credential and pre-check all share one verdict: "not your tenant ⇒ it does not exist (40404, not 403)". **Why not reuse an existing read surface**: `/api/messages/stats` is windowed by `Math.min(days, 90)` while the dialog needs the archive total (measured contrast: account 7 = 328 cumulative vs 300 in the 90-day window), and `ConversationPageVO` has no total field at all — you would have to page through it. **Renderer**: new `DeleteAccountDialog.tsx`, copying the shape already in the same file ("one state + one sibling dialog" — `deleteTarget` mirrors `importTarget`); `handleDelete` now only opens the dialog and the mutate call moved into the confirm callback, which on success runs `afterDeleted()` (destroys the real embedded view in the main process, clears the selection if the deleted account was selected); both footer buttons are disabled while confirming, and a failed delete **keeps the dialog open** and shows the backend message inline. **Counts unavailable never locks the delete**: the dialog says "the impact could not be measured" and 删除 still works (the pre-check is information, not a permission; `useAccountImpact` sets `retry:false` so an honest failure state isn't stretched into a spinner). All-zero also confirms, with no special case. Row copy uses `{{num}}`, not `{{count}}` — the latter triggers i18next plural-key resolution (`key_one`/`key_other`) and eight locales × two key sets buys nothing. Each of the eight locale files gained 13 `account.delete.*` keys. **Verification**: `AccountImpactServiceTest` 3 + JS unit `accountImpact` 5 / `accountDeleteCopy` 5 (the latter covers two things `DeepString` cannot see: the dynamic `t('account.delete.' + row.key)` addressing, and whether the interpolation placeholders survived — under-reporting a count is worse than not reporting one); four typechecks green, `test:unit` **496/496**, `eslint --quiet` on changed files 0 errors, `./mvnw test` **499 cases, 0 failures**; HTTP contract leg `tmp/p1-impact-contract.mjs` **15/15**, where #8 and #13 are deliberately written as equalities (the session count the dialog reports == the number of rows the list actually pages out; Σ per-account == the dashboard's `conversationsTotal`, 55==55). The copy probe was mutation-tested: removing one `{{num}}` from `id.ts` makes it red on exactly that locale and key. **Still to verify**: clicking the trash icon in a live app — dialog appears and nothing gets deleted (needs the dev app on `:9223`). **One contract fact uncovered, not fixed (another item's decision)**: the seeded tenant `QA0002` has no `tenant_admin` role row (V14 seeds that builtin role only for `invite_code='DEMO0001'`) and the `qa` user has no `sys_user_role` binding, so `selectMenuCodesByUserId` returns an empty set for it and **every** `@PreAuthorize`'d desktop business endpoint answers 40300 (measured, `tmp/p1-403-attribute.mjs`). Consequence: over HTTP the "cross-tenant caller" leg can only reach the permission layer, never the tenant gate, so #4 asserts the property actually measured ("a caller lacking the permission gets no counts, `data` null"), while "40404 rather than 403" is covered by #6 (nonexistent id → 40404, measured) plus the Java test — `requireOwned` has a single throw site for "not found" and "wrong tenant". Backfilling QA's role means writing three RBAC tables, which would change what other legs observe for `qa`, so it was not done unasked.
- **B12 simulated payment gating** — plan activation on top of the V48 tenant usage model. Backend: `PlanCatalog` (BASIC ¥0 / PRO ¥199 / FLAGSHIP ¥599), `PlanDefVO`, and `TenantInfoService.activatePlan` (writes `plan_name` + the seat / AI / translation limits and clears usage), exposed as `GET /api/tenant/plans` + `POST /api/tenant/activate-plan` (no `@PreAuthorize`, same posture as `/info`: the tenant id is only ever read from `AuthPrincipal`). Frontend: `PlanActivateDialog` (pick plan → simulated Alipay payment → activate; the payment is a pure local simulation with zero real charge), an "Upgrade plan" entry on the home usage card, and a **soft** quota gate (`isOverLimit` + `PlanOverLimitDialog`) wired into `AddAccountDialog` — over-quota prompts locally but never hard-blocks the backend. Reuses the existing V48 columns; no new migration. Per-feature engineering notes live in `docs/feature-checklist.md`.
- **Other recent deliveries** — B29 (imported session credentials instead of QR login), B28 (AI transfer rules + takeover queue), B27 (WhatsApp protocol-number channel + admin console), B26 (contact cache + local data cleanup / storage management), B25 (image / voice translation via OCR + ASR), B24 (home overview page), B23 (customer follow-ups), B22 (teams / sub-accounts), B21 (cloud account pool), B20 (automation panel), B19 / B18 (group auto join / kick), B17 (material buttons + ownership tiers), B16 (per-conversation translate toggles), and the A-series shell work (A4 multi-language, A6 auto-update, A7 perf metrics, A8 sensitive-word filtering, A9 change password, A10 in-app notifications, A11 help / FAQ, A12–A15 settings page + taskbar badge / theme switch / device info, A16 RBAC, A17 system notifications, A18 GPU fallback, A19 categorized log center).
- **Status**: B1–B29 are delivered except **B6**, whose CDP UI leg sits at 18/20 — the 2 red legs are a local sandbox limitation (`spawnSync` returns `EBUSY` for any child process), not a code defect. Of the audit's §12 priority list, **item 1 (delete confirmation) is delivered** (the entry above) and **item 4 (`refresh` re-checks tenant status)** was delivered with the admin refresh closure — see `docs/feature-checklist.md`. **Items 2, 3 and 5 are still open, and the code says so**: no `apiBase` allowlist exists anywhere under `apps/desktop/src` (today `apiBase` is only ever a compile-time constant, which is why nothing has gone wrong yet); `collectorHub.deliver()` now retries `1..retries` per delivery, but a failed flush still returns from `drain()` **without re-arming the timer** and with no backoff, so a stalled queue only moves again when new traffic arrives; `CustomerService.update` writes `country`/`email`/`remark` explicitly to survive `updateById` skipping nulls, but `nickname` is not in that list, so clearing a nickname still silently does nothing.
- **Telegram chain**: real-device DOM probe → inject selectors → collect → send. Blocked externally (no local TG account).
- **The packaged build has never been run end-to-end** — verify §7 item 6 first.

## 9. Commit conventions

- One commit per verified feature, prefixed `feat:` / `fix:` / `refa:` / `update:`, optionally scoped (`feat(P6): ...`).
- One task = one commit, made by whoever completed its verification.
- Commit only — pushing is done manually by the maintainer.
- Docs, comments and specs describe this project's design only; no comparison against other implementations.
