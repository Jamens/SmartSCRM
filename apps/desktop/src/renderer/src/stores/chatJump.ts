// src/renderer/src/stores/chatJump.ts
import { create } from 'zustand'
import type { ConversationVO } from '@/api/messages'

interface ChatJumpState {
  /** 待选会话：抽屉点了「打开」之后、`MessagesPage` 挂载之前挂在这里。 */
  target: ConversationVO | null
  /**
   * 通知点击（A17）带来的定位目标：**只有 chatKey**，没有整条 VO——
   * 主进程广播里就只有 `{ accountId, chatKey }` 两个字段，拿不到标题与客户归属。
   * 所以它是"尽力而为"的定位：消息页在已加载的会话里按 chatKey 找，找不到就停在消息页。
   */
  chatKey: string | null
  hold: (conversation: ConversationVO) => void
  holdKey: (chatKey: string) => void
  clear: () => void
  clearKey: () => void
}

/**
 * 为什么是 store 而不是路由参数：跳过去要用的是**整条 `ConversationVO`**
 * （`accountId` + `chatKey` + `isGroup` + `customerId`），而 chat_key 里有 `@`、`.`、
 * 群 id 的连字符——塞进 hash query 要做编解码、会被截断显示、还把号码暴露在标题栏。
 * 抽屉里那份本来就是后端刚给的真实形状，直接递过去最省事。
 * `useSelectionStore`（账号维度的选中态）已经是同一个模式，这里不是新发明。
 */
export const useChatJumpStore = create<ChatJumpState>((set) => ({
  target: null,
  chatKey: null,
  hold: (conversation) => set({ target: conversation }),
  holdKey: (chatKey) => set({ chatKey }),
  clear: () => set({ target: null }),
  clearKey: () => set({ chatKey: null })
}))
