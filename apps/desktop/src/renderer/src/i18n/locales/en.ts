import type { DeepString, zhCN } from './zh-CN'

/**
 * en 界面文案（A4）。键结构与 zh-CN 完全一致——`DeepString<typeof zhCN>` 会在编译期保证这一点：
 * 漏一个键、多一个键、或层级写错都会 typecheck 失败。只补译文，不要动键。
 */
export const en: DeepString<typeof zhCN> = {
  common: {
    loading: 'Loading…',
    reading: 'Reading settings…'
  },
  nav: {
    workspace: 'Workspace',
    messages: 'Messages',
    customers: 'Customers',
    labels: 'Labels',
    audiences: 'Audiences',
    broadcast: 'Broadcast',
    quickReplies: 'Quick Replies',
    materials: 'Materials',
    translation: 'Translation',
    logs: 'Logs',
    settings: 'Settings'
  },
  titleBar: {
    logout: 'Sign out'
  },
  placeholder: {
    comingSoon: '{{title}} coming soon'
  },
  login: {
    welcome: 'Welcome back',
    subtitle: 'Sign in to your SCRM workspace',
    invite: 'Company invite code',
    invitePlaceholder: 'e.g. {{sample}}',
    username: 'Account',
    usernamePlaceholder: 'Enter your account',
    password: 'Password',
    passwordPlaceholder: 'Enter your password',
    rememberInvite: 'Remember invite code',
    demoAccount: 'Demo account',
    storedLocally: 'Data stored locally in MySQL only',
    signing: 'Signing in…',
    signIn: 'Sign in',
    heroTitle1: 'Turn every customer conversation',
    heroTitle2: 'into value',
    heroSub:
      'Unified multi-platform customer operations · AI message translation · smart broadcasting and growth engine — one-stop private-domain operations for cross-border teams.',
    feature1: 'Real-time translation across all channels, zero communication barriers',
    feature2: 'Broadcasting and engagement engine, automated growth',
    feature3: 'Local data layer, secure, controllable and replayable',
    footer: '© 2026 SmartSCRM · Local demo environment · All data stored on this machine'
  },
  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    appearanceDesc:
      'Only affects this app’s data interface. Embedded third-party pages (WhatsApp Web, etc.) pick their own colors and do not follow this setting.',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'Follow system',
    themeLightHint: 'Always use light tokens',
    themeDarkHint: 'Always use dark tokens',
    themeSystemHint: 'Follows the OS when it changes',
    effectiveDark: 'Dark',
    effectiveLight: 'Light',
    storedLocal: 'local settings file',
    storedBrowser: 'browser preview (not persisted)',
    statusLine: 'Active: {{effective}} · System: {{system}} · Stored in {{host}}',
    notifications: 'Notifications',
    badgeDesc: 'The taskbar badge counts unread for this account’s tenant only; the toggle lives in the local settings file.',
    badgeTitle: 'Taskbar unread badge',
    badgeDetail:
      'When the window is not in front, the total unread is shown on the taskbar icon: Windows uses a red dot at the corner (that platform’s API can’t draw a number), macOS and Linux use a numeric badge. It is hidden while you are actively using the app — the count would be stale the next second.',
    badgeStatusBrowser: 'Current host does not draw a taskbar badge (browser preview)',
    badgeStatusNow: 'Now: {{total}} unread across {{conversations}} conversations',
    badgeStatusLoading: 'Reading unread…',
    desktopNotify: 'Desktop notifications',
    desktopNotifyDesc: 'Independent toggle from the taskbar badge: turning one off does not affect the other.',
    desktopNotifyTitle: 'Show a system notification on new messages',
    desktopNotifyDetail:
      'When the window is not in front, a new message raises a system notification; clicking it returns to the app and opens the conversation. Several messages from the same conversation are merged into one (with a count in the title), no spam. Not shown while you are actively using the app.',
    desktopNotifyBrowser: 'Current host cannot raise system notifications (browser preview)',
    enabled: 'Enabled',
    disabled: 'Disabled',
    accountSecurity: 'Account security',
    accountSecurityDesc: 'Change your login password. After a successful change, the current session expires immediately and you must sign in again.',
    oldPassword: 'Current password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    togglePwdVisible: 'Toggle password visibility',
    pwdChanged: 'Password changed, signing out…',
    changePassword: 'Change password',
    submitting: 'Submitting…',
    errPwdTooShort: 'New password must be at least 8 characters',
    errPwdMismatch: 'The two new passwords do not match',
    errPwdFailed: 'Change failed, please retry',
    graphics: 'Graphics',
    graphicsDesc:
      'Hardware acceleration renders the UI with the GPU for smoother performance; turn it off to fall back to software rendering. Requires a restart to take effect — the app restarts once to switch the backend.',
    hardwareAccel: 'Hardware acceleration',
    hardwareAccelDetail:
      'Off uses software (CPU) rendering — more stable but more power-hungry. Some old GPU drivers crash the GPU process; the app then auto-switches here and warns you.',
    accelOn: 'Enabled (using GPU)',
    accelOff: 'Disabled (software rendering)',
    accelBrowser: 'Current host (browser preview) has no GPU backend to switch',
    safeModeTitle: 'Graphics fallback mode is active',
    safeModeFatal:
      'The GPU still crashes in fallback mode (reason: {{reason}}); likely a GPU driver issue — update your driver.',
    safeModeRecover: 'Last launch was auto-switched here after a GPU crash. You can try restoring normal mode:',
    retryStandard: 'Retry standard mode',
    deviceInfo: 'Device info',
    deviceInfoDesc:
      'The state of this machine and this app. The machine code and OS version follow the same口径 reported to the backend `device` at login, so what’s shown here should match what’s stored.',
    deviceLoading: 'Reading…',
    deviceLogin: 'Signed in: {{who}} · Service at {{api}}',
    language: 'Language',
    languageDesc: 'Interface display language. Changes apply immediately and are saved to local settings.',
    languageLabel: 'Interface language'
  },
  log: {
    browserNote: 'You are in browser preview; logs are produced by the main process and require the desktop app to view or export.',
    loading: 'Reading logs…',
    empty: 'No matching logs. Console output tagged with [tag] in the main process is auto-categorized while debugging.',
    title: 'Log center',
    desc: 'Four main-process log categories (app / ipc / bridge / error) + unhandled Promise rejections. Local only, never uploaded.',
    allCategories: 'All categories',
    allLevels: 'All levels',
    refresh: 'Refresh',
    openFolder: 'Open log folder',
    clear: 'Clear',
    filterByCategory: 'Filter by category',
    filterByLevel: 'Filter by level'
  }
}
