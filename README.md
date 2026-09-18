# SmartSCRM

Electron + React + TypeScript desktop SCRM client with a Spring Boot + MySQL backend.
Rewritten from the legacy Vue 3 Electron client; UI, theme (royal blue + gold) and iconography are original.

## Structure (hybrid monorepo)

```
SmartSCRM/
├── apps/
│   ├── desktop/       # Electron + React 19 + TS (electron-vite, Tailwind v4 + shadcn/ui)
│   └── server/        # Spring Boot 3.5 + Java 17 + MyBatis-Plus + Flyway
├── packages/
│   └── shared/        # Shared TS types / API contract
└── docs/
```

## Prerequisites

- Node.js >= 20 (pnpm 10+)
- JDK 17
- MySQL 8 running on `localhost:3306` (user `root`)

## Run

```bash
# 1. install frontend deps
pnpm install

# 2. start backend (Flyway auto-migrates schema smartscrm_react)
cd apps/server && ./mvnw spring-boot:run

# 3. start desktop app (new terminal, repo root)
pnpm dev:desktop
```

Backend listens on `http://localhost:8180`, health check: `GET /api/health`.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev:desktop` | Electron dev mode |
| `pnpm build:desktop` | Typecheck + bundle desktop app |
| `pnpm dev:server` | Run Spring Boot server |
| `pnpm typecheck` | Typecheck all TS packages |

## Feature roadmap (one commit per stage)

- P0 scaffold (done)
- P1 login + window shell
- P2 platform account views (WebContentsView) + inject layer
- P3–P14 customers, quick replies, translation, chat history, batch send, group analytics, group-script engine, mutual-chat scheduling, proxy & fingerprint, cloud phone, reports & plans, i18n/theme/settings
- See `docs/` for the detailed module plan.
