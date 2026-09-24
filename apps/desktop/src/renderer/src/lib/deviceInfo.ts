/**
 * 设备信息（A14）的渲染层这一段。
 *
 * 三个来源、三种脾气，所以是三条查询而不是一条：
 * - `profile`：主进程内存里的十个常量，一次取到就永远是它（`staleTime: Infinity`）；
 * - `identity`：机器码与设备名，走的是登录请求那套取值，同一份口径；
 * - `storage`：目录遍历，比前两条慢，也最容易只拿到一半，所以它单独转，不挡前面十二行。
 *
 * 卡片上那一串行的**内容**由 `@shared/machine` 决定（行序、标签、空值怎么说都有单测）；
 * 这里只负责把三份来源喂给它，以及"还没到"的那一句该说什么。
 */
import { useQuery } from '@tanstack/react-query'
import {
  machineProfileRows,
  type DeviceExtras,
  type DeviceRow,
  type MachineProfile,
  type StorageUsage
} from '@shared/machine'
import { currentDeviceName, getDeviceId } from './device'

/** 占用还在统计时那一条行说的话。与「未知」分开：一个是"正在问"，一个是"问不出"。 */
export const STORAGE_PENDING_TEXT = '统计中…'

export const deviceQueryKeys = {
  profile: ['device', 'machine-profile'] as const,
  storage: ['device', 'storage-usage'] as const,
  identity: ['device', 'identity'] as const
}

/** 没有主进程（纯浏览器预览）时不给假值：`null` 一路传到 shared，那十行自然落成「未知」。 */
async function readProfile(): Promise<MachineProfile | null> {
  return (await window.scrm?.app.getMachineProfile()) ?? null
}

async function readStorage(): Promise<StorageUsage | null> {
  return (await window.scrm?.app.getStorageUsage()) ?? null
}

async function readIdentity(): Promise<DeviceExtras> {
  return { deviceId: await getDeviceId(), deviceName: currentDeviceName() }
}

export interface DeviceInfo {
  rows: DeviceRow[]
  /** 前两条来源是否都到位了。没到位时整张卡片写「读取中…」，而不是先闪一排「未知」。 */
  loading: boolean
}

/** 设备信息卡的数据。只在设置页挂载时取一次：这些数在一次会话里不会自己变。 */
export function useDeviceInfo(): DeviceInfo {
  const profile = useQuery({
    queryKey: deviceQueryKeys.profile,
    queryFn: readProfile,
    staleTime: Infinity
  })
  const storage = useQuery({
    queryKey: deviceQueryKeys.storage,
    queryFn: readStorage,
    staleTime: Infinity
  })
  const identity = useQuery({
    queryKey: deviceQueryKeys.identity,
    queryFn: readIdentity,
    staleTime: Infinity
  })

  const extras: DeviceExtras = {
    deviceId: identity.data?.deviceId ?? '',
    deviceName: identity.data?.deviceName ?? '',
    storage: storage.data ?? null
  }
  let rows = machineProfileRows(profile.data, extras)
  if (storage.isPending) {
    // 只有这一条行需要"还没到"的说法：其余十二行要么有值，要么真的没有。
    rows = rows.map((row) =>
      row.key === 'storage' ? { ...row, value: STORAGE_PENDING_TEXT } : row
    )
  }
  return { rows, loading: profile.isPending || identity.isPending }
}
