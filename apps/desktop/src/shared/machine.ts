/**
 * 设备信息（A14）的纯模型：主进程取到的原始值 → 设置页要画的那几行。
 *
 * 放 shared 的理由与 `badge.ts` 一样是跨进程，但方向相反：badge 是渲染层算、主进程画，
 * 这里是主进程取、渲染层画。真正需要"只有一份"的是**空值怎么说**——
 * 一个字段取不到时必须显示「未知」，不能显示空串：空串在界面上一眼看不出是"没有这个信息"
 * 还是"这里本该有字而没渲染出来"，而这两者的处置完全不同。
 * 行序与标签也收在这里，是因为"这一屏该有哪几行"本身就是这条功能的一部分，
 * 不该由页面自己临时决定。
 */

/** 主进程给的原始值。约定：取不到就给空串，判定与展示都交给下面的 `machineProfileRows`。 */
export interface MachineProfile {
  /** `process.platform`，如 `win32`。 */
  platform: string
  /** `process.arch`，如 `x64`。 */
  arch: string
  /** `os.release()`，操作系统的内核版本串，如 `10.0.26100`。 */
  release: string
  /** `process.versions.electron`。 */
  electron: string
  /** `process.versions.chrome`。 */
  chrome: string
  /** `process.versions.node`。 */
  node: string
  /** `app.getVersion()`——读 package.json 的 version，不是 Electron 的版本。 */
  appVersion: string
  /** `app.getPath('userData')`，设置与会话文件所在处。 */
  userData: string
  /** `app.getLocale()`，操作系统语言，如 `zh-CN`。 */
  locale: string
  /** IANA 时区名，如 `Asia/Shanghai`。 */
  timezone: string
}

/** 取不到值时在界面上说的话。只此一处，页面与驱动都按它断言。 */
export const UNKNOWN_TEXT = '未知'

export interface DeviceRow {
  /** 稳定标识：驱动用它逐行寻址，不依赖标签文案。 */
  key: string
  label: string
  value: string
}

/** 行的顺序 = 卡片上的顺序，写死在这份数组字面量里：顺序本身也是要对账的一部分。 */
type RowSpec = {
  key: string
  label: string
  /** 从两份来源里取这一个值；两份都可以整体缺席，`orUnknown` 负责"空值说什么话"。 */
  read: (
    profile: MachineProfile | null | undefined,
    extras: DeviceExtras | null | undefined
  ) => string
}

/** 取主进程那十个字段里的一个。写成函数而非直接读，是为了让下面的表能逐行点名。 */
const fromProfile =
  (key: keyof MachineProfile) =>
  (profile: MachineProfile | null | undefined): string =>
    profile?.[key] ?? ''

const fromExtras =
  (key: 'deviceId' | 'deviceName') =>
  (_profile: MachineProfile | null | undefined, extras: DeviceExtras | null | undefined): string =>
    extras?.[key] ?? ''

const ROW_SPECS: RowSpec[] = [
  { key: 'platform', label: '平台', read: fromProfile('platform') },
  { key: 'arch', label: '架构', read: fromProfile('arch') },
  { key: 'release', label: '系统版本', read: fromProfile('release') },
  { key: 'appVersion', label: '应用版本', read: fromProfile('appVersion') },
  { key: 'deviceId', label: '机器码', read: fromExtras('deviceId') },
  { key: 'deviceName', label: '设备名', read: fromExtras('deviceName') },
  { key: 'electron', label: 'Electron', read: fromProfile('electron') },
  { key: 'chrome', label: 'Chromium', read: fromProfile('chrome') },
  { key: 'node', label: 'Node', read: fromProfile('node') },
  { key: 'locale', label: '系统语言', read: fromProfile('locale') },
  { key: 'timezone', label: '时区', read: fromProfile('timezone') },
  { key: 'userData', label: '本机数据目录', read: fromProfile('userData') },
  // 占用不是 `MachineProfile` 的字段：它来自一次磁盘遍历，比那十个常量慢得多，
  // 所以单独一条通道取；它没到时这一行写「未知」，其余十二行照旧。
  // 写法上的不同也说明了为什么这一行不能落到 `orUnknown`：它自己就有话要说。
  {
    key: 'storage',
    label: '本机数据占用',
    read: (_profile, extras) => storageUsageText(extras?.storage)
  }
]

/** 空串、纯空白、非字符串都算"没取到"。 */
function orUnknown(raw: unknown): string {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : UNKNOWN_TEXT
}

/**
 * 出设置页要画的那十三行。逐字段点名取值（不是 `Object.entries(profile)`）：
 * 少一个字段就是少一行，而这张卡片的用处恰恰是"这台机器上这些东西分别是什么"。
 *
 * 两份来源都可以整体缺席（主进程还没回、纯浏览器预览没有主进程），那时不是抛错而是一排「未知」——
 * 页面因此不需要为"取到了没有"另写一套分支。
 */
export function machineProfileRows(
  profile: MachineProfile | null | undefined,
  extras: DeviceExtras | null | undefined
): DeviceRow[] {
  return ROW_SPECS.map(({ key, label, read }) => ({
    key,
    label,
    value: orUnknown(read(profile, extras))
  }))
}

/**
 * 除主进程那十个字段外，卡片上还要出现三项：机器码、设备名、本机数据占用。
 * 机器码与设备名按登录请求那份口径取，占用来自主进程的目录遍历。
 */
export interface DeviceExtras {
  /** 后端 `device.device_id`：这台机器的稳定标识。 */
  deviceId: string
  /** 后端 `device.device_name`：人类可读的那一句。 */
  deviceName: string
  /** 本机数据目录的占用；还没统计出来（或宿主根本没有主进程）时给 null。 */
  storage?: StorageUsage | null
}

/**
 * 登录时上报给后端 `device.os_version` 的那一句。
 * 收成一处是因为设备信息卡要展示同一串：两处各拼一份，就会出现"页面上是 A，库里是 B"。
 */
export function osVersionOf(profile: MachineProfile): string {
  const platform = profile?.platform?.trim() || UNKNOWN_TEXT
  const release = profile?.release?.trim() || UNKNOWN_TEXT
  const arch = profile?.arch?.trim() || UNKNOWN_TEXT
  return `${platform} ${release} · ${arch}`
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * 目录占用的人话写法。`1 KiB = 1024 B`：这台机器上读的是文件系统字节数，
 * 按 1000 进制会跟资源管理器对不上。非有限数与负数一律「未知」而不是 `0 B`——
 * 后者读起来像"这个目录是空的"。
 */
export function formatBytes(bytes: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return UNKNOWN_TEXT
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1)
  return `${text} ${UNITS[unit]}`
}

/** 主进程遍历 `userData` 的回执。三个数同源：都是那一次遍历得出的。 */
export interface StorageUsage {
  /** 目录里普通文件的字节数之和；目录不存在时为 `0`。取不到（根目录就读不动）时为 `null`。 */
  bytes: number | null
  /** 参与求和的文件个数。`0 B / 0 个文件` 与 `未知` 是两件事：前者是"确实是空的"。 */
  files: number | null
  /** 这一次有没有读完。被权限挡住的条目、超出层级或时间预算都算没读完，此时前两个数只是下界。 */
  incomplete: boolean
}

/**
 * 占用那一行的写法：`1.5 MB · 23 个文件`，没读完时前面加「至少」。
 * 文件数一起说是因为它才是"这个目录是不是根本没在读"的证据——只有字节数时，
 * 一个空目录和一次失败的遍历都长得像 `0 B`。
 */
export function storageUsageText(usage: StorageUsage | null | undefined): string {
  const bytes = usage?.bytes
  const files = usage?.files
  if (
    typeof bytes !== 'number' ||
    typeof files !== 'number' ||
    !Number.isInteger(files) ||
    files < 0
  )
    return UNKNOWN_TEXT
  const size = formatBytes(bytes)
  // 字节数本身不成立时，半句"未知 · 23 个文件"是没意义的：这行要说的是同一个事实。
  if (size === UNKNOWN_TEXT) return UNKNOWN_TEXT
  return `${usage?.incomplete ? '至少 ' : ''}${size} · ${files} 个文件`
}
