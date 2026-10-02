// src/renderer/src/services/protocol/config.ts
// 协议网关地址：开源项目不内置任何商业云端点，必须由部署方自托管并通过环境变量注入。
// 未配置时为空字符串，协议号通道保持静默——不会向任何外部服务发起连接（避免"私连商业云"）。
// 本地 / 自托管联调用 VITE_PROTOCOL_URL / VITE_PROTOCOL_WS_URL 覆盖（对应旧版 SCRM_PROTOCOL_URL / SCRM_PROTOCOL_WS_URL）。
export const PROTOCOL_URL: string =
  (import.meta.env.VITE_PROTOCOL_URL as string | undefined)?.trim() || ''

export const PROTOCOL_WS_URL: string =
  (import.meta.env.VITE_PROTOCOL_WS_URL as string | undefined)?.trim() || ''
