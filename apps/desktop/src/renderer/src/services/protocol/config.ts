// src/renderer/src/services/protocol/config.ts
// 协议网关地址：开源项目不内置任何商业云端点，必须由部署方自托管并通过环境变量注入。
// 未配置时为空字符串，协议号通道保持静默——不会向任何外部服务发起连接（避免"私连商业云"）。
// 本地 / 自托管联调用 VITE_PROTOCOL_URL / VITE_PROTOCOL_WS_URL 覆盖。
//
// TG 协议源（type-8）用另一组地址：它是与 WA 协议号并列的另一个网关进程，独立部署。

export const PROTOCOL_URL: string =
  (import.meta.env.VITE_PROTOCOL_URL as string | undefined)?.trim() || ''

export const PROTOCOL_WS_URL: string =
  (import.meta.env.VITE_PROTOCOL_WS_URL as string | undefined)?.trim() || ''

// TG 协议源：同样不内置任何端点。未配置则静默，不向任何外部服务发起连接——
// 期一没有真实 TG 网关可连，这一对变量当前版本下恒为 ''（多源通路只由离线 harness 覆盖）。
export const TG_PROTOCOL_URL: string =
  (import.meta.env.VITE_TG_PROTOCOL_URL as string | undefined)?.trim() || ''

export const TG_PROTOCOL_WS_URL: string =
  (import.meta.env.VITE_TG_PROTOCOL_WS_URL as string | undefined)?.trim() || ''
