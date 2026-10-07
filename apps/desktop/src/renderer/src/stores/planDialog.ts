// src/renderer/src/stores/planDialog.ts
// B12 模拟支付门控：跨组件共享「升级 / 充值套餐」弹窗的开关状态。
// 首页用量卡区的按钮、加席位超额拦截的「去升级」都通过这个 store 打开同一个弹窗。
import { create } from 'zustand'

interface PlanDialogState {
  open: boolean
  openPlan: () => void
  closePlan: () => void
}

export const usePlanDialog = create<PlanDialogState>((set) => ({
  open: false,
  openPlan: () => set({ open: true }),
  closePlan: () => set({ open: false })
}))
