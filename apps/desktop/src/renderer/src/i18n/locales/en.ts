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
  },
  messages: {
    title: 'Message history',
    tab: {
      conversations: 'Conversations',
      search: 'Global search'
    },
    empty: {
      noAccount: 'Add and select a platform account on the workspace first.',
      noSelection: 'Select a conversation from the left to view its history.'
    },
    list: {
      selectAccount: 'Select account',
      searchPlaceholder: 'Search conversation titles',
      platform: 'Platform',
      allPlatforms: 'All platforms',
      syncHistory: 'Sync history',
      syncHintOnline: 'Fill back the current conversation list from the page',
      syncHintOffline: 'Conversation is offline, sync cannot start',
      syncStarted: 'Sync started, messages appear as they arrive',
      syncNotOnline: 'Conversation is offline, sync not started',
      syncRequestFailed: 'Sync request failed to send, check if the conversation is online',
      loading: 'Loading conversations…',
      pickAccountFirst: 'Select a platform account above first.',
      loadError: 'Cannot load conversations. Make sure the backend is running.',
      emptyFiltered:
        'No conversations match the current filters. Clear the keyword or switch back to “All platforms”.',
      emptyNoData:
        'This account has no conversations collected yet. They sync automatically after login, or click “Sync history” above.',
      badgeGroup: 'Group',
      badgeStranger: 'Stranger',
      noText: '(no text content)',
      loadMore: 'Load more conversations',
      loadingMore: 'Loading…'
    },
    thread: {
      stranger: 'Stranger',
      count: '{{count}} messages',
      located:
        'Located at the message “{{label}}”: earlier records are below; newer messages are not in this window.',
      backToLatest: 'Back to latest',
      loading: 'Loading messages…',
      loadError: 'Cannot read history. Make sure the backend is running.',
      empty: 'This conversation has no messages collected yet.',
      loadingEarlier: 'Loading earlier messages…',
      reachedEarliest: 'Reached the earliest message',
      retry: 'Retry'
    },
    search: {
      inputPlaceholder: 'Search message text (at least {{min}} characters)',
      allPlatforms: 'All platforms',
      allAccounts: 'All accounts',
      allDirections: 'All directions',
      directionIn: 'Received',
      directionOut: 'Sent',
      to: 'to',
      currentCustomerOnly: 'Current customer only',
      clearFilters: 'Clear filters',
      customerFilterDisabled: 'Select a conversation linked to a customer on the right first',
      customerFilterHint:
        'The current conversation has no linked customer, so “Current customer only” is paused; it resumes when you switch to a linked conversation.',
      searching: 'Searching…',
      minHint:
        'Type at least {{min}} characters to search. Search scans message text already stored.',
      loadError: 'Search request failed. Make sure the backend is running.',
      noHits: 'No hits. Try another keyword or widen the time window.',
      media: '(media message)',
      noConversationHead: 'This message has no matching conversation head, cannot jump.',
      loadMore: 'Load more',
      loadingMore: 'Loading…',
      barTitle: '{{day}} received {{in}} / sent {{out}}'
    },
    stats: {
      dayUnit: '{{days}} days',
      pickAccount: 'Select an account to see stats.',
      loading: 'Loading stats…',
      loadError: 'Stats failed to load. Make sure the backend is running.',
      labelTotal: 'Messages',
      labelIn: 'Received',
      labelOut: 'Sent',
      labelActive: 'Active chats',
      legend: 'Last {{days}} days: solid = received / light = sent'
    },
    actions: {
      direction: 'Direction',
      createCustomer: 'Create customer',
      unknownCustomer: 'Customer #{{id}}'
    },
    composer: {
      translateFirst: 'Translate then send',
      offlinePlaceholder: 'Conversation is offline; log in to reply here',
      inputPlaceholder: 'Type a message, Enter to send, Shift+Enter for newline',
      send: 'Send',
      scopeNotHeld: 'This scope’s locator is not in hand; nothing was written',
      flagsSavedNoSync: 'Settings saved, but failed to sync to embedded pages',
      flagsSaveFailed: 'Failed to save toggle: {{error}}',
      translateFailed: 'Translation failed: {{error}}',
      sentScope: 'This message was sent as {{scope}}'
    },
    createCustomer: {
      title: 'Create customer',
      desc: 'Create a customer for this conversation’s counterpart and backfill its stored history messages to them.',
      notAllowed: 'This conversation cannot become a customer (group or already linked).',
      conversationId: 'Conversation ID (open_id)',
      conversationIdHint:
        'This is the conversation’s chat_key; changing it creates a customer for a different number.',
      nickname: 'Nickname',
      nicknamePlaceholder: 'Leave blank to skip',
      phone: 'Phone',
      phonePlaceholder: 'Leave blank to skip',
      remark: 'Remark',
      remarkPlaceholder: 'Optional',
      createError: 'Creation failed',
      duplicateHint:
        ' —— this open_id already has a customer on this platform. There is no “find customer by open_id” entry yet (the customer list only searches nickname / phone / email); check the customer management page to see who it is.',
      linkFailed:
        'Customer #{{id}} was created, but history linking failed (the conversation head is not attached yet).',
      linkError: 'Linking failed',
      linkRetryHint:
        'Retry only re-runs the “link” step and will not create a duplicate customer — a duplicate open_id is blocked by the backend at 40901.',
      close: 'Close for now',
      cancel: 'Cancel',
      retryLink: 'Retry linking',
      linking: 'Linking…',
      creating: 'Creating…',
      submit: 'Create customer and link history'
    },
    direction: {
      title: 'This customer’s direction',
      desc: 'Only changes this customer’s translation direction. In-page bubbles and the history reply box pick the first matching scope in “conversation → customer → global”, so this override’s effective layer is shown by the badge above and the “session-only” tag next to the reply box.',
      inherited: 'Inherited from global',
      owned: 'This customer’s own',
      inheritedHint: 'Saving creates an override for this customer only; global settings stay unchanged.',
      ownedHint: 'Override row · Customer #{{id}}',
      receive: 'Receive',
      send: 'Send',
      saveFailed: 'Save failed: {{error}}',
      saveFailedFallback: 'backend unavailable',
      resetFailed: 'Reset failed: {{error}}',
      resetFailedFallback: 'backend unavailable',
      reset: 'Restore global',
      resetPending: 'Restoring…',
      save: 'Save',
      savePending: 'Saving…',
      saveDirty: 'Save ({{count}} changes)',
      cancel: 'Cancel'
    },
    bubble: {
      groupMember: 'Group member',
      media: 'Media message',
      empty: '(empty message)',
      sendFailed: 'Send failed'
    }
  }
}
