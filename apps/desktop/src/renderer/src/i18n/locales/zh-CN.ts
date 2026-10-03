/**
 * zh-CN 界面文案（A4 基准语种）。
 *
 * 键命名：`顶层命名空间.具体项`，与 react-i18next 默认的点分隔符对应。
 * 新增壳层文案时，先在这里加键，再在 en.ts 补英文；组件里用 `t('namespace.key')` 取。
 * 插值用 `{{var}}` 占位，运行时由调用方传入，不要在文案里拼变量。
 */

export const zhCN = {
  common: {
    loading: '读取中…',
    reading: '读取设置中…'
  },
  nav: {
    workspace: '工作台',
    messages: '聊天记录',
    customers: '客户',
    labels: '标签',
    audiences: '人群包',
    broadcast: '批量群发',
    quickReplies: '快捷回复',
    materials: '素材库',
    translation: '翻译中心',
    logs: '日志中心',
    settings: '设置'
  },
  titleBar: {
    logout: '退出登录'
  },
  placeholder: {
    // {{title}} 由调用方传入（模块名），拼在「即将上线」前面。
    comingSoon: '{{title}}即将上线'
  },
  login: {
    welcome: '欢迎回来',
    subtitle: '登录你的 SCRM 工作台',
    invite: '企业邀请码',
    invitePlaceholder: '例如 {{sample}}',
    username: '账号',
    usernamePlaceholder: '请输入账号',
    password: '密码',
    passwordPlaceholder: '请输入密码',
    rememberInvite: '记住邀请码',
    demoAccount: '演示账号',
    storedLocally: '数据仅存储于本机 MySQL',
    signing: '登录中…',
    signIn: '登 录',
    heroTitle1: '让每一次客户对话',
    heroTitle2: '创造价值',
    heroSub: '多平台客户统一经营 · AI 消息翻译 · 智能化群发与增长引擎，为跨境团队提供一站式私域运营能力。',
    feature1: '全渠道消息实时互译，沟通零障碍',
    feature2: '群发与炒群引擎，增长自动化',
    feature3: '本地数据层，安全可控可回放',
    footer: '© 2026 SmartSCRM · 本地演示环境 · 数据全部存储于本机'
  },
  settings: {
    title: '设置',
    // 外观
    appearance: '外观',
    appearanceDesc:
      '只影响本应用的数据界面；内嵌的第三方页面（WhatsApp Web 等）由它们自己决定配色，不跟随这里的档位。',
    themeLight: '浅色',
    themeDark: '深色',
    themeSystem: '跟随系统',
    themeLightHint: '始终用亮色令牌',
    themeDarkHint: '始终用暗色令牌',
    themeSystemHint: '操作系统改档位时这里跟着改',
    effectiveDark: '深色',
    effectiveLight: '浅色',
    storedLocal: '本机设置文件',
    storedBrowser: '浏览器预览（不落盘）',
    statusLine: '生效：{{effective}} · 系统：{{system}} · 档位存于{{host}}',
    // 通知
    notifications: '通知',
    badgeDesc: '任务栏角标只统计本账号租户的未读，开关存在本机设置文件里。',
    badgeTitle: '任务栏未读角标',
    badgeDetail:
      '窗口不在前台时，把未读消息总数标到任务栏图标上：Windows 是图标右下角的红点（那个平台的接口画不了数字），macOS 与 Linux 是数字角标。正在用这个应用时不显示——那时未读正在被读掉，挂上去的数下一秒就过期。',
    badgeStatusBrowser: '当前宿主不画任务栏角标（浏览器预览）',
    badgeStatusNow: '现在：未读 {{total}} 条，分布在 {{conversations}} 个会话',
    badgeStatusLoading: '未读取中…',
    desktopNotify: '桌面消息通知',
    desktopNotifyDesc: '与任务栏角标是两个独立的开关：关掉一个不会牵连另一个。',
    desktopNotifyTitle: '收到消息时弹系统通知',
    desktopNotifyDetail:
      '窗口不在前台时，收到的消息会弹一条系统通知；点它会回到这个应用并打开对应会话。同一个会话连着来好几条会并成一条（标题上带条数），不会刷屏。正在用这个应用时不弹——那时你已经在看了。',
    desktopNotifyBrowser: '当前宿主弹不出系统通知（浏览器预览）',
    enabled: '已开启',
    disabled: '已关闭',
    // 账户安全
    accountSecurity: '账户安全',
    accountSecurityDesc: '修改登录密码。改密成功后当前登录会立即失效，需要用新密码重新登录。',
    oldPassword: '原密码',
    newPassword: '新密码',
    confirmPassword: '确认新密码',
    togglePwdVisible: '切换密码可见',
    pwdChanged: '密码已修改，正在退出登录…',
    changePassword: '修改密码',
    submitting: '提交中…',
    errPwdTooShort: '新密码至少 8 位',
    errPwdMismatch: '两次输入的新密码不一致',
    errPwdFailed: '修改失败，请重试',
    // 图形
    graphics: '图形',
    graphicsDesc:
      '硬件加速用 GPU 渲染界面，更流畅；出问题时可以关掉改用软件渲染。改动需重启生效，应用会自己重启一次以切换到新的渲染后端。',
    hardwareAccel: '硬件加速',
    hardwareAccelDetail:
      '关掉后用软件渲染（CPU）跑界面，更稳但更费电。部分老显卡驱动会崩 GPU 进程，那时应用会自动切到这个模式并提醒你。',
    accelOn: '已开启（使用 GPU）',
    accelOff: '已关闭（软件渲染）',
    accelBrowser: '当前宿主（浏览器预览）没有 GPU 后端可切换',
    safeModeTitle: '当前处于图形降级模式',
    safeModeFatal: '降级模式下 GPU 仍崩溃（原因：{{reason}}），多半是显卡驱动问题，建议更新驱动。',
    safeModeRecover: '上次启动因 GPU 进程崩溃被自动切到这里。可以尝试恢复正常模式：',
    retryStandard: '重试标准模式',
    // 设备信息
    deviceInfo: '设备信息',
    deviceInfoDesc:
      '这台机器与这个应用的现状。机器码与系统版本按登录时上报后端 device 那份口径取，所以卡片上写的与库里存的应当是同一串。',
    deviceLoading: '读取中…',
    deviceLogin: '当前登录：{{who}} · 服务地址 {{api}}',
    // 语言
    language: '语言',
    languageDesc: '界面显示语言。改动立即生效，并记到本机设置里。',
    languageLabel: '界面语言'
  },
  log: {
    browserNote: '当前是浏览器预览，日志由主进程产生，桌面端打开才能查看与导出。',
    loading: '读取日志中…',
    empty: '没有匹配的日志。调试时主进程打的带 [tag] 的 console 会自动归到对应类别。',
    title: '日志中心',
    desc: '主进程四类日志（app / ipc / bridge / error）+ 未处理 Promise 拒绝，只落本地、不上报服务端。',
    allCategories: '全部类别',
    allLevels: '全部级别',
    refresh: '刷新',
    openFolder: '打开日志目录',
    clear: '清空',
    filterByCategory: '按类别筛选',
    filterByLevel: '按级别筛选'
  }
} as const

export type TranslationSchema = typeof zhCN

/**
 * 把 `typeof zhCN`（全是字面量叶子）映射成「同结构、叶子为任意 string」的类型。
 * 英文资源用 `DeepString<typeof zhCN>` 标注后，漏键 / 多键 / 层级错都会在编译期报错，
 * 翻译时不会悄悄少翻一段。
 */
export type DeepString<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepString<T[K]>
}
