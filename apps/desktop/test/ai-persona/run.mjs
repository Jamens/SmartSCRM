// apps/desktop/test/ai-persona/run.mjs
// B28 离线契约入口：零依赖、零外网，直接跑 mock OpenAI 端点 + 契约 harness。
//
// 用法：pnpm --filter smartscrm-desktop run test:ai   （或 node test/ai-persona/run.mjs）
// 说明：这是**契约层**验证，不是真机验收、也不是端到端 HTTP 验收。
//       真机腿见 real-model-probe.mjs；端到端需要 MySQL + 后端启动后另行执行。

import { runAiPersonaOffline } from './ai-persona-offline-integration.mjs'

await runAiPersonaOffline()
