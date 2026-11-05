/**
 * dsh-sticky-notes-wall — Client half.
 *
 * Registers three additive surfaces:
 *   - `sidebar.panellist` — the left-rail sticky-note entry with an overdue badge.
 *   - `main` (key `sticky-notes`) — the note wall, quick capture and editor.
 *   - `shell.overlay` — due-reminder toasts that stay available on every panel.
 *
 * Notes are read from and written to the Host half through same-origin
 * `/sticky-notes/api/*` routes. Images are uploaded once and referenced by
 * file name; the wall document therefore stays small.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sticky-notes-wall',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const NS = 'sticky-notes'
    const PANEL_ID = 'sticky-notes'
    const API = 'sticky-notes/api'
    const COLORS = ['amber', 'rose', 'mint', 'sky', 'violet', 'slate']
    const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    const IMAGE_INPUT_LIMIT = 12 * 1024 * 1024
    const IMAGE_KEEP_BYTES = 1_400_000
    const IMAGE_MAX_EDGE = 1800
    const FILE_RE = /^[a-z0-9][a-z0-9-]*\.(?:png|jpe?g|webp|gif)$/i
    const NOTE_ID_RE = /^[A-Za-z0-9_-]{6,80}$/
    const DAY_MS = 86_400_000
    const FLOAT_STORE_KEY = 'dsh-sticky-notes-wall.float.v1'
    const PREFS_LOCAL_KEY = 'dsh-sticky-notes-wall.prefs.v1'
    const FLOAT_PIN_LIMIT = 24

    const FONT_STACKS = {
      system: 'inherit',
      sans: '"Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif',
      serif: '"Source Han Serif SC", "Songti SC", Georgia, "Times New Roman", serif',
      mono: 'ui-monospace, "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      rounded:
        '"MiSans", "PingFang SC", "Hiragino Sans GB", "Segoe UI Variable Display", system-ui, sans-serif',
    }

    const PREF_DEFAULTS = {
      version: 1,
      appearance: {
        scheme: 'auto',
        surface: 'auto',
        accent: 'amber',
        fontFamily: 'system',
        fontSize: 14,
        lineHeight: 1.55,
        density: 'cozy',
        radius: 12,
        contrast: 'normal',
      },
      float: { width: 326, opacity: 0.98, autoOpen: false, locked: false },
      sort: 'auto',
    }

    function clampPref(value, min, max, fallback) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return fallback
      return Math.min(Math.max(Math.round(number * 100) / 100, min), max)
    }

    function normalizePrefsClient(raw) {
      const a = raw?.appearance ?? {}
      const f = raw?.float ?? {}
      return {
        version: 1,
        appearance: {
          scheme: ['auto', 'light', 'dark'].includes(a.scheme) ? a.scheme : PREF_DEFAULTS.appearance.scheme,
          surface: ['auto', 'solid', 'glass'].includes(a.surface) ? a.surface : PREF_DEFAULTS.appearance.surface,
          accent: COLORS.includes(a.accent) ? a.accent : PREF_DEFAULTS.appearance.accent,
          fontFamily: Object.prototype.hasOwnProperty.call(FONT_STACKS, a.fontFamily)
            ? a.fontFamily
            : PREF_DEFAULTS.appearance.fontFamily,
          fontSize: clampPref(a.fontSize, 12, 20, PREF_DEFAULTS.appearance.fontSize),
          lineHeight: clampPref(a.lineHeight, 1.25, 1.9, PREF_DEFAULTS.appearance.lineHeight),
          density: a.density === 'compact' ? 'compact' : 'cozy',
          radius: clampPref(a.radius, 6, 22, PREF_DEFAULTS.appearance.radius),
          contrast: a.contrast === 'high' ? 'high' : 'normal',
        },
        float: {
          width: clampPref(f.width, 260, 460, PREF_DEFAULTS.float.width),
          opacity: clampPref(f.opacity, 0.6, 1, PREF_DEFAULTS.float.opacity),
          autoOpen: f.autoOpen === true,
          locked: f.locked === true,
        },
        sort: raw?.sort === 'manual' ? 'manual' : 'auto',
      }
    }

    /** Class names that drive the appearance scheme of the wall and the float. */
    function appearanceClass(prefs) {
      const a = prefs.appearance
      return `sn-scheme-${a.scheme} sn-surface-${a.surface} sn-contrast-${a.contrast} sn-density-${a.density}`
    }

    function appearanceVars(prefs) {
      const a = prefs.appearance
      return {
        '--sn-font-family': FONT_STACKS[a.fontFamily] ?? 'inherit',
        '--sn-font-size': `${a.fontSize}px`,
        '--sn-line-height': String(a.lineHeight),
        '--sn-radius': `${a.radius}px`,
        '--sn-gap': a.density === 'compact' ? '8px' : '14px',
        '--sn-pad': a.density === 'compact' ? '14px 16px 76px' : '22px 26px 96px',
      }
    }

    // ---------------------------------------------------------------------
    // Locale
    // ---------------------------------------------------------------------

    const ZH = {
      panel: '便签墙',
      title: '便签墙',
      subtitle: '随手记下灵感，到点提醒，完成即归档。',
      searchPlaceholder: '搜索便签…',
      filterAll: '全部',
      filterActive: '未完成',
      filterDue: '今天到期',
      filterDone: '已完成',
      statActive: '未完成',
      statDue: '今天到期',
      statDone: '已完成',
      newNote: '新建便签',
      quickPlaceholder: '记一笔灵感…',
      quickHint: 'Ctrl+Enter 保存 · 可粘贴图片',
      quickSave: '保存',
      quickCancel: '取消',
      addImage: '添加图片',
      pasteHint: '可直接粘贴或拖入图片',
      uploading: '正在处理图片…',
      imageFailed: '图片处理失败',
      imageTooLarge: '图片不能超过 12 MB',
      unsupportedImage: '仅支持 PNG / JPEG / WebP / GIF 图片',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      saveFailed: '保存失败',
      retry: '重试',
      close: '关闭',
      delete: '删除',
      deleteNote: '删除便签',
      confirmDelete: '再次点击确认删除',
      editorNew: '新建便签',
      editorEdit: '编辑便签',
      notePlaceholder: '写点什么…',
      color: '颜色',
      due: '到期',
      dueNone: '无到期',
      clearDue: '清除',
      dueInOneHour: '1 小时后',
      dueTomorrowMorning: '明早 9:00',
      today: '今天',
      tomorrow: '明天',
      yesterday: '昨天',
      overdue: '已逾期',
      justNow: '刚刚',
      minutesAgo: '{n} 分钟前',
      hoursAgo: '{n} 小时前',
      daysAgo: '{n} 天前',
      markDone: '标记为完成',
      markUndone: '标记为未完成',
      doneLabel: '已完成',
      emptyTitle: '还没有便签',
      emptyBody: '按 Ctrl+Shift+N，或在上方输入框记下第一条灵感。',
      emptyFilterTitle: '没有匹配的便签',
      emptyFilterBody: '换个关键词或筛选条件试试。',
      loading: '正在读取便签…',
      loadFailed: '便签读取失败',
      reminderTitle: '便签到期',
      reminderImageOnly: '一张图片便签',
      reminderView: '查看',
      reminderDone: '完成',
      reminderSnooze: '稍后 10 分钟',
      reminderDismiss: '关闭提醒',
      reminders: '到期提醒',
      desktopNotify: '开启桌面通知',
      desktopNotifyOn: '桌面通知已开启',
      desktopNotifyDenied: '桌面通知被拒绝',
      desktopNotifyUnsupported: '当前环境不支持桌面通知',
      shortcuts: '快捷键',
      helpTitle: '快捷键与操作',
      helpTips: '操作提示',
      helpNewGlobal: '在任意页面打开便签墙并新建',
      helpNewLocal: '在便签墙内新建',
      helpSave: '保存便签',
      helpEsc: '关闭编辑器或图片预览',
      helpSearch: '聚焦搜索框',
      helpHelp: '打开快捷键说明',
      helpPaste: '在记录框或编辑器中粘贴图片',
      helpDrop: '拖拽图片或文本到便签墙即可新建',
      helpClick: '点击便签编辑，勾选左侧方框标记完成',
      helpNotify: '开启桌面通知后，应用在后台也能收到到期提醒',
      colorAmber: '琥珀',
      colorRose: '玫瑰',
      colorMint: '薄荷',
      colorSky: '天空',
      colorViolet: '紫罗兰',
      colorSlate: '石板',
      imageAlt: '便签图片',
      viewImage: '查看图片',
      savedToast: '已记下这条灵感',
      clipboardBusy: '正在读取剪贴板…',
      dropBusy: '正在处理拖入的图片…',
      attachments: '{n} 张图片',
      removeImage: '移除图片',
      editNote: '编辑',
      shortcutHint: '按 ? 查看快捷键',
      emptyNote: '（空便签）',
      saveAndClose: '保存',
      escSaves: 'Esc 会保存并关闭',
      shortcutKey: '快捷键',
      pin: '置顶',
      pinToFloat: '置顶到浮窗',
      unpin: '取消置顶',
      floatTitle: '置顶便签',
      floatCount: '{n} 条',
      floatToggle: '置顶浮窗',
      floatHide: '隐藏浮窗',
      floatCollapse: '收起',
      floatExpand: '展开',
      floatOpenWall: '在便签墙中打开',
      floatCapture: '速记一条灵感…',
      floatEmpty: '还没有置顶便签。点便签上的图钉，或在上面速记一条。',
      floatEditHint: 'Ctrl+Enter 保存 · Esc 取消',
      floatHint: '拖动标题栏移动浮窗 · Ctrl+Shift+P 显示或隐藏',
      helpPin: '置顶的便签会浮在所有页面之上，切换面板也不会消失',
      helpFloat: '显示 / 隐藏置顶便签浮窗',
      settingsTitle: '便签墙',
      settingsSub: '外观、置顶浮窗与桌面行为，修改后立即生效。',
      secAppearance: '外观',
      secFloat: '置顶浮窗',
      secDesktop: '桌面与排序',
      schemeLabel: '便签配色',
      schemeAuto: '跟随主题',
      schemeLight: '浅色纸面',
      schemeDark: '深色纸面',
      surfaceLabel: '纸面质感',
      surfaceAuto: '自动',
      surfaceSolid: '实心',
      surfaceGlass: '毛玻璃',
      contrastLabel: '对比度',
      contrastNormal: '标准',
      contrastHigh: '高对比',
      accentLabel: '新便签默认颜色',
      fontLabel: '字体',
      fontSystem: '跟随界面',
      fontSans: '无衬线',
      fontSerif: '衬线',
      fontMono: '等宽',
      fontRounded: '圆体',
      fontSizeLabel: '字号',
      lineHeightLabel: '行高',
      radiusLabel: '圆角',
      densityLabel: '密度',
      densityCozy: '宽松',
      densityCompact: '紧凑',
      previewLabel: '预览',
      previewText: '把灵感贴在这里，抬头就能看见。',
      floatWidthLabel: '浮窗宽度',
      floatOpacityLabel: '不透明度',
      floatLockLabel: '锁定浮窗位置',
      floatAutoOpenLabel: '启动 Harness 时自动显示浮窗',
      floatDesktopLabel: '系统级置顶',
      floatDesktopBody:
        '浮窗已悬浮在 Harness 所有面板之上，切换页面不会消失；把窗口钉在其它软件之上仍需要桌面端窗口能力，当前版本不支持。',
      autostartLabel: '开机自启动',
      autostartBody: '登录 Windows 后自动启动 Harness，便签随开随用。',
      autostartOn: '已启用',
      autostartOff: '未启用',
      autostartUnsupportedPlatform: '当前系统不支持',
      autostartUnsupportedHost: '仅桌面应用进程可用',
      autostartFailed: '设置失败',
      sortLabel: '便签排序',
      sortAuto: '到期优先',
      sortManual: '手动拖拽',
      sortManualHint: '拖动便签卡片即可调整顺序',
      dragToSort: '拖动排序',
      pinInEditor: '置顶到浮窗',
      settingsSaved: '设置已保存',
      lockFloat: '位置已锁定',
      notSupported: '暂不支持',
      desktopWidgetLabel: '桌面置顶窗口',
      desktopWidgetBody: '在 Windows 桌面上打开一个原生便签窗口，始终浮在其它软件之上；首次打开需要编译约 10 秒。',
      desktopStart: '在桌面打开',
      desktopStop: '关闭桌面窗口',
      desktopRunning: '桌面窗口运行中',
      desktopUnsupported: '仅 Windows 可用',
      desktopCompiling: '正在准备桌面窗口…',
    }

    const EN = {
      panel: 'Sticky Notes',
      title: 'Sticky Notes Wall',
      subtitle: 'Capture ideas, get reminded on time, and check them off.',
      searchPlaceholder: 'Search notes…',
      filterAll: 'All',
      filterActive: 'Open',
      filterDue: 'Due today',
      filterDone: 'Done',
      statActive: 'Open',
      statDue: 'Due today',
      statDone: 'Done',
      newNote: 'New note',
      quickPlaceholder: 'Jot an idea…',
      quickHint: 'Ctrl+Enter to save · paste images',
      quickSave: 'Save',
      quickCancel: 'Clear',
      addImage: 'Add image',
      pasteHint: 'Paste or drop images right here',
      uploading: 'Processing image…',
      imageFailed: 'Image failed',
      imageTooLarge: 'Image must be under 12 MB',
      unsupportedImage: 'Only PNG / JPEG / WebP / GIF images are supported',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Save failed',
      retry: 'Retry',
      close: 'Close',
      delete: 'Delete',
      deleteNote: 'Delete note',
      confirmDelete: 'Click again to confirm',
      editorNew: 'New note',
      editorEdit: 'Edit note',
      notePlaceholder: 'Write something…',
      color: 'Color',
      due: 'Due',
      dueNone: 'No due date',
      clearDue: 'Clear',
      dueInOneHour: 'In 1 hour',
      dueTomorrowMorning: 'Tomorrow 9:00',
      today: 'Today',
      tomorrow: 'Tomorrow',
      yesterday: 'Yesterday',
      overdue: 'Overdue',
      justNow: 'just now',
      minutesAgo: '{n} min ago',
      hoursAgo: '{n} h ago',
      daysAgo: '{n} d ago',
      markDone: 'Mark as done',
      markUndone: 'Mark as not done',
      doneLabel: 'Done',
      emptyTitle: 'No notes yet',
      emptyBody: 'Press Ctrl+Shift+N, or use the box above to capture your first idea.',
      emptyFilterTitle: 'No matching notes',
      emptyFilterBody: 'Try another keyword or filter.',
      loading: 'Loading notes…',
      loadFailed: 'Could not load notes',
      reminderTitle: 'Sticky note due',
      reminderImageOnly: 'An image note',
      reminderView: 'View',
      reminderDone: 'Done',
      reminderSnooze: 'Snooze 10 min',
      reminderDismiss: 'Dismiss',
      reminders: 'Due reminders',
      desktopNotify: 'Enable desktop notifications',
      desktopNotifyOn: 'Desktop notifications on',
      desktopNotifyDenied: 'Desktop notifications blocked',
      desktopNotifyUnsupported: 'Desktop notifications unavailable',
      shortcuts: 'Shortcuts',
      helpTitle: 'Shortcuts & tips',
      helpTips: 'Tips',
      helpNewGlobal: 'Open the wall and create a note from anywhere',
      helpNewLocal: 'Create a note inside the wall',
      helpSave: 'Save the note',
      helpEsc: 'Close the editor or image preview',
      helpSearch: 'Focus search',
      helpHelp: 'Show this shortcut sheet',
      helpPaste: 'Paste images into the composer or editor',
      helpDrop: 'Drop images or text onto the wall to create a note',
      helpClick: 'Click a note to edit; tick the box to complete it',
      helpNotify: 'Enable desktop notifications to be reminded while the app is in the background',
      colorAmber: 'Amber',
      colorRose: 'Rose',
      colorMint: 'Mint',
      colorSky: 'Sky',
      colorViolet: 'Violet',
      colorSlate: 'Slate',
      imageAlt: 'Sticky note image',
      viewImage: 'View image',
      savedToast: 'Idea captured',
      clipboardBusy: 'Reading the clipboard…',
      dropBusy: 'Processing dropped images…',
      attachments: '{n} images',
      removeImage: 'Remove image',
      editNote: 'Edit',
      shortcutHint: 'Press ? for shortcuts',
      emptyNote: '(empty note)',
      saveAndClose: 'Save',
      escSaves: 'Esc saves and closes',
      shortcutKey: 'Shortcut',
      pin: 'Pinned',
      pinToFloat: 'Pin to the floating notes',
      unpin: 'Unpin',
      floatTitle: 'Pinned notes',
      floatCount: '{n}',
      floatToggle: 'Floating notes',
      floatHide: 'Hide the floating notes',
      floatCollapse: 'Collapse',
      floatExpand: 'Expand',
      floatOpenWall: 'Open in the wall',
      floatCapture: 'Jot an idea…',
      floatEmpty: 'No pinned notes yet. Pin one from the wall, or capture one above.',
      floatEditHint: 'Ctrl+Enter saves · Esc cancels',
      floatHint: 'Drag the header to move · Ctrl+Shift+P shows or hides it',
      helpPin: 'Pinned notes float above every panel, so switching panels never hides them',
      helpFloat: 'Show or hide the floating pinned notes',
      settingsTitle: 'Sticky Notes',
      settingsSub: 'Appearance, floating window and desktop behaviour. Changes apply immediately.',
      secAppearance: 'Appearance',
      secFloat: 'Floating notes',
      secDesktop: 'Desktop & order',
      schemeLabel: 'Note colours',
      schemeAuto: 'Follow theme',
      schemeLight: 'Light paper',
      schemeDark: 'Dark paper',
      surfaceLabel: 'Paper surface',
      surfaceAuto: 'Auto',
      surfaceSolid: 'Solid',
      surfaceGlass: 'Frosted',
      contrastLabel: 'Contrast',
      contrastNormal: 'Normal',
      contrastHigh: 'High',
      accentLabel: 'Default colour for new notes',
      fontLabel: 'Font',
      fontSystem: 'Match the UI',
      fontSans: 'Sans serif',
      fontSerif: 'Serif',
      fontMono: 'Monospace',
      fontRounded: 'Rounded',
      fontSizeLabel: 'Text size',
      lineHeightLabel: 'Line height',
      radiusLabel: 'Corner radius',
      densityLabel: 'Density',
      densityCozy: 'Cozy',
      densityCompact: 'Compact',
      previewLabel: 'Preview',
      previewText: 'Pin an idea here so it is always in sight.',
      floatWidthLabel: 'Window width',
      floatOpacityLabel: 'Opacity',
      floatLockLabel: 'Lock the window position',
      floatAutoOpenLabel: 'Show the floating window when Harness starts',
      floatDesktopLabel: 'System-level always on top',
      floatDesktopBody:
        'The window already floats above every Harness panel and survives panel switches; pinning it above other applications needs desktop window APIs this build does not expose.',
      autostartLabel: 'Start with Windows',
      autostartBody: 'Launch Harness after you sign in, so the notes are always there.',
      autostartOn: 'Enabled',
      autostartOff: 'Disabled',
      autostartUnsupportedPlatform: 'Not supported on this system',
      autostartUnsupportedHost: 'Desktop app only',
      autostartFailed: 'Could not change it',
      sortLabel: 'Note order',
      sortAuto: 'Due first',
      sortManual: 'Manual',
      sortManualHint: 'Drag a note card to change its place',
      dragToSort: 'Drag to reorder',
      pinInEditor: 'Pin to the floating notes',
      settingsSaved: 'Settings saved',
      lockFloat: 'Position locked',
      notSupported: 'Unavailable',
      desktopWidgetLabel: 'Desktop window',
      desktopWidgetBody:
        'Open a native note window on the Windows desktop that stays above other applications. The first launch compiles it, which takes about ten seconds.',
      desktopStart: 'Open on the desktop',
      desktopStop: 'Close the desktop window',
      desktopRunning: 'Desktop window running',
      desktopUnsupported: 'Windows only',
      desktopCompiling: 'Preparing the desktop window…',
    }

    function interpolate(template, params) {
      if (params === undefined || params === null) return String(template)
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
      )
    }

    function tr(key, params) {
      let text = key
      try {
        const translate = runtime?.ctx?.locale?.bind?.(NS)
        if (typeof translate === 'function') text = translate(key)
      } catch {
        text = key
      }
      return interpolate(text, params)
    }

    // ---------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------

    let runtime = null

    function apiUrl(path) {
      const base = typeof document !== 'undefined' && typeof document.baseURI === 'string' ? document.baseURI : '/'
      return new URL(`${API}/${path}`, base).href
    }

    async function fetchJson(path, options) {
      const response = await fetch(apiUrl(path), {
        cache: 'no-store',
        ...options,
        headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) },
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok || body === null || body.ok === false) {
        const message = body?.error?.message || `HTTP ${response.status}`
        throw new Error(message)
      }
      return body
    }

    function uid() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      } catch {
        // fall through
      }
      return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    }

    function nowIso() {
      return new Date().toISOString()
    }

    function parseTime(value) {
      if (typeof value !== 'string' || value.length === 0) return null
      const time = Date.parse(value)
      return Number.isFinite(time) ? time : null
    }

    function isoOr(value, fallback = null) {
      const time = parseTime(value)
      return time === null ? fallback : new Date(time).toISOString()
    }

    function activeLocale() {
      try {
        const snapshot = runtime?.ctx?.locale?.getSnapshot?.() ?? runtime?.ctx?.locale?.getLocale?.()
        return String(snapshot?.active ?? snapshot?.id ?? 'zh')
      } catch {
        return 'zh'
      }
    }

    function dateLocale() {
      return activeLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
    }

    function startOfDay(time) {
      const date = new Date(time)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }

    function endOfToday() {
      return startOfDay(Date.now()) + DAY_MS - 1
    }

    function formatClock(time) {
      try {
        return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(time)
      } catch {
        return ''
      }
    }

    function formatDate(time) {
      try {
        return new Intl.DateTimeFormat(dateLocale(), { month: 'short', day: 'numeric' }).format(time)
      } catch {
        return ''
      }
    }

    function formatDue(value, done = false) {
      const time = parseTime(value)
      if (time === null) return ''
      const now = Date.now()
      const dayDiff = Math.round((startOfDay(time) - startOfDay(now)) / DAY_MS)
      let day
      if (dayDiff === 0) day = tr('today')
      else if (dayDiff === 1) day = tr('tomorrow')
      else if (dayDiff === -1) day = tr('yesterday')
      else day = formatDate(time)
      const label = `${day} ${formatClock(time)}`.trim()
      return !done && time < now ? `${tr('overdue')} · ${label}` : label
    }

    function relativeTime(value) {
      const time = parseTime(value)
      if (time === null) return ''
      const diff = Date.now() - time
      if (diff < 60_000) return tr('justNow')
      if (diff < 3_600_000) return tr('minutesAgo', { n: Math.floor(diff / 60_000) })
      if (diff < DAY_MS) return tr('hoursAgo', { n: Math.floor(diff / 3_600_000) })
      if (diff < 2 * DAY_MS) return tr('yesterday')
      if (diff < 7 * DAY_MS) return tr('daysAgo', { n: Math.floor(diff / DAY_MS) })
      return formatDate(time)
    }

    function toLocalInput(value) {
      const time = parseTime(value)
      if (time === null) return ''
      const date = new Date(time)
      const pad = number => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function fromLocalInput(value) {
      if (typeof value !== 'string' || value.length === 0) return null
      const time = new Date(value).getTime()
      return Number.isFinite(time) ? new Date(time).toISOString() : null
    }

    function presetInHour() {
      const date = new Date(Date.now() + 3_600_000)
      date.setSeconds(0, 0)
      return toLocalInput(date.toISOString())
    }

    function presetTomorrowMorning() {
      const date = new Date()
      date.setDate(date.getDate() + 1)
      date.setHours(9, 0, 0, 0)
      return toLocalInput(date.toISOString())
    }

    function isEditableTarget(target) {
      if (target === null || target === undefined) return false
      if (typeof target.closest !== 'function') return false
      return target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null
    }

    function imageSrc(image) {
      if (image === null || image === undefined || typeof image.file !== 'string') return ''
      if (!FILE_RE.test(image.file)) return ''
      return apiUrl(`file/${encodeURIComponent(image.file)}`)
    }

    function sanitizeImage(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const file = typeof raw.file === 'string' ? raw.file.trim() : ''
      if (!FILE_RE.test(file)) return null
      return {
        file,
        w: Number.isSafeInteger(raw.w) && raw.w > 0 ? raw.w : 0,
        h: Number.isSafeInteger(raw.h) && raw.h > 0 ? raw.h : 0,
        name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : '',
      }
    }

    function sanitizeNote(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const id = typeof raw.id === 'string' && NOTE_ID_RE.test(raw.id) ? raw.id : null
      if (id === null) return null
      const created = isoOr(raw.createdAt) ?? nowIso()
      return {
        id,
        text: typeof raw.text === 'string' ? raw.text.slice(0, 100_000) : '',
        color: COLORS.includes(raw.color) ? raw.color : 'amber',
        createdAt: created,
        updatedAt: isoOr(raw.updatedAt, created),
        dueAt: isoOr(raw.dueAt),
        done: raw.done === true,
        doneAt: isoOr(raw.doneAt),
        remindedAt: isoOr(raw.remindedAt),
        order: Number.isFinite(raw.order) ? Math.round(raw.order) : null,
        images: Array.isArray(raw.images)
          ? raw.images.slice(0, 12).map(sanitizeImage).filter(Boolean)
          : [],
      }
    }

    // ---------------------------------------------------------------------
    // Images
    // ---------------------------------------------------------------------

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error ?? new Error('read failed'))
        reader.readAsDataURL(file)
      })
    }

    function loadImageElement(dataUrl) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('decode failed'))
        image.src = dataUrl
      })
    }

    async function prepareImage(file) {
      if (file === null || file === undefined || typeof file.type !== 'string' || !IMAGE_TYPES.has(file.type)) {
        throw new Error(tr('unsupportedImage'))
      }
      if (file.size > IMAGE_INPUT_LIMIT) throw new Error(tr('imageTooLarge'))
      let dataUrl = await readFileAsDataUrl(file)
      let width = 0
      let height = 0
      let image = null
      try {
        image = await loadImageElement(dataUrl)
        width = image.naturalWidth
        height = image.naturalHeight
      } catch {
        image = null
      }
      if (image !== null && file.type !== 'image/gif' && (file.size > IMAGE_KEEP_BYTES || Math.max(width, height) > 2000)) {
        const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(width, height, 1))
        const targetWidth = Math.max(1, Math.round(width * scale))
        const targetHeight = Math.max(1, Math.round(height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const context = canvas.getContext('2d')
        if (context !== null) {
          context.drawImage(image, 0, 0, targetWidth, targetHeight)
          dataUrl = canvas.toDataURL('image/jpeg', 0.86)
          width = targetWidth
          height = targetHeight
        }
      }
      return {
        dataUrl,
        width,
        height,
        name: typeof file.name === 'string' && file.name.length > 0 ? file.name : `pasted-${Date.now()}.png`,
      }
    }

    async function uploadImageFile(file) {
      const prepared = await prepareImage(file)
      const body = await fetchJson('upload', {
        method: 'POST',
        body: JSON.stringify(prepared),
      })
      const image = sanitizeImage(body.image)
      if (image === null) throw new Error(tr('imageFailed'))
      return image
    }

    /** Paste, drop and pick images for any composer. */
    function useImageDrop(onImage) {
      const [pending, setPending] = useState(0)
      const [error, setError] = useState(null)

      const addFiles = useCallback(
        async fileList => {
          const files = Array.from(fileList ?? []).filter(
            file => file && typeof file.type === 'string' && file.type.startsWith('image/'),
          )
          if (files.length === 0) return
          setPending(value => value + files.length)
          setError(null)
          for (const file of files) {
            try {
              const image = await uploadImageFile(file)
              onImage(image)
            } catch (uploadError) {
              setError(String(uploadError?.message ?? uploadError))
            } finally {
              setPending(value => Math.max(0, value - 1))
            }
          }
        },
        [onImage],
      )

      const onPaste = useCallback(
        event => {
          const items = event.clipboardData?.items
          if (items === undefined || items === null) return
          const files = []
          let hasText = false
          for (const item of items) {
            if (item.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/')) {
              const file = item.getAsFile()
              if (file !== null) files.push(file)
            } else if (item.kind === 'string' && item.type === 'text/plain') {
              hasText = true
            }
          }
          if (files.length === 0) return
          if (!hasText) event.preventDefault()
          void addFiles(files)
        },
        [addFiles],
      )

      const onDrop = useCallback(
        event => {
          const files = Array.from(event.dataTransfer?.files ?? []).filter(
            file => typeof file.type === 'string' && file.type.startsWith('image/'),
          )
          if (files.length === 0) return
          event.preventDefault()
          event.stopPropagation()
          void addFiles(files)
        },
        [addFiles],
      )

      return { pending, error, addFiles, onPaste, onDrop, clearError: () => setError(null) }
    }

    // ---------------------------------------------------------------------
    // Store
    // ---------------------------------------------------------------------

    /**
     * Floating-window state. It is presentation state rather than note content,
     * so it lives in localStorage and never travels through the Host document.
     */
    function readFloatState() {
      // First run opens the window once so the surface is discoverable; hiding it
      // afterwards is remembered.
      const fallback = { visible: true, x: null, y: null, collapsed: false, ids: [] }
      try {
        const raw = window.localStorage.getItem(FLOAT_STORE_KEY)
        if (typeof raw !== 'string' || raw.length === 0) return fallback
        const parsed = JSON.parse(raw)
        return {
          visible: parsed?.visible === true,
          x: Number.isFinite(parsed?.x) ? Math.round(parsed.x) : null,
          y: Number.isFinite(parsed?.y) ? Math.round(parsed.y) : null,
          collapsed: parsed?.collapsed === true,
          ids: Array.isArray(parsed?.ids)
            ? parsed.ids
                .filter(id => typeof id === 'string' && NOTE_ID_RE.test(id))
                .slice(0, FLOAT_PIN_LIMIT)
            : [],
        }
      } catch {
        return fallback
      }
    }

    function writeFloatState(next) {
      try {
        window.localStorage.setItem(FLOAT_STORE_KEY, JSON.stringify(next))
      } catch {
        // private mode or a full quota must not break note taking
      }
    }

    let snapshot = {
      status: 'loading',
      notes: [],
      savedAt: null,
      error: null,
      saveError: null,
      saving: false,
      reminders: [],
      pendingNew: false,
      focusNoteId: null,
      modalOpen: false,
      prefs: readLocalPrefs() ?? normalizePrefsClient(PREF_DEFAULTS),
      autostart: null,
      desktop: { supported: null, running: false, compiled: false, busy: false, error: null },
      float: readFloatState(),
    }
    const listeners = new Set()
    let revision = 0
    let dirty = false
    let saving = false
    let saveTimer = null
    let loadRetry = 0

    function emit(patch) {
      snapshot = { ...snapshot, ...patch }
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // a broken consumer must not break the store
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function getSnapshot() {
      return snapshot
    }

    function setFloat(patch) {
      const next = { ...snapshot.float, ...patch }
      writeFloatState(next)
      emit({ float: next })
    }

    function pinNote(id) {
      const current = snapshot.float
      if (current.ids.includes(id)) {
        if (!current.visible) setFloat({ visible: true })
        return
      }
      setFloat({ ids: [id, ...current.ids].slice(0, FLOAT_PIN_LIMIT), visible: true })
    }

    function unpinNote(id) {
      if (!snapshot.float.ids.includes(id)) return
      setFloat({ ids: snapshot.float.ids.filter(value => value !== id) })
    }

    function togglePin(id) {
      if (snapshot.float.ids.includes(id)) unpinNote(id)
      else pinNote(id)
    }

    function toggleFloat() {
      setFloat({ visible: !snapshot.float.visible })
    }

    /** A wall dialog owns the screen while it is open, so the float steps aside. */
    function setModalOpen(open) {
      if (snapshot.modalOpen === open) return
      emit({ modalOpen: open })
    }

    let prefsTimer = null
    let prefsSaving = false

    /** Preferences are cached locally so the UI stays instant and usable offline. */
    function readLocalPrefs() {
      try {
        const raw = window.localStorage.getItem(PREFS_LOCAL_KEY)
        if (typeof raw !== 'string' || raw.length === 0) return null
        return normalizePrefsClient(JSON.parse(raw))
      } catch {
        return null
      }
    }

    function writeLocalPrefs(prefs) {
      try {
        window.localStorage.setItem(PREFS_LOCAL_KEY, JSON.stringify(prefs))
      } catch {
        // private mode or a full quota must not break the settings page
      }
    }

    function patchPrefs(patch) {
      const next = normalizePrefsClient({
        ...snapshot.prefs,
        ...patch,
        appearance: { ...snapshot.prefs.appearance, ...(patch.appearance ?? {}) },
        float: { ...snapshot.prefs.float, ...(patch.float ?? {}) },
      })
      writeLocalPrefs(next)
      emit({ prefs: next })
      if (prefsTimer !== null) clearTimeout(prefsTimer)
      prefsTimer = window.setTimeout(() => {
        prefsTimer = null
        void persistPrefs()
      }, 420)
    }

    async function persistPrefs() {
      writeLocalPrefs(snapshot.prefs)
      if (prefsSaving) return
      prefsSaving = true
      try {
        await fetchJson('prefs', {
          method: 'POST',
          body: JSON.stringify({ prefs: snapshot.prefs }),
        })
      } catch {
        // The local cache already holds the change.
      } finally {
        prefsSaving = false
      }
    }

    async function loadPrefs() {
      const local = readLocalPrefs()
      if (local !== null) emit({ prefs: local })
      try {
        const body = await fetchJson('prefs')
        const remote = normalizePrefsClient(body.prefs)
        emit({ autostart: body.autostart ?? null })
        if (local === null) {
          writeLocalPrefs(remote)
          emit({ prefs: remote })
        } else if (JSON.stringify(remote) !== JSON.stringify(local)) {
          // The local cache is the last explicit choice, so push it to the Host.
          void persistPrefs()
        }
        if (snapshot.prefs.float.autoOpen && !snapshot.float.visible) setFloat({ visible: true })
      } catch {
        // The Host half may still be the previous generation (before a restart):
        // keep the cached preferences and report login start as unavailable.
        if (snapshot.autostart === null) {
          emit({ autostart: { supported: false, enabled: false, command: null, reason: 'error' } })
        }
      }
    }

    async function setAutostart(enabled) {
      const body = await fetchJson('autostart', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      })
      emit({ autostart: body.autostart ?? null })
      return body.autostart ?? null
    }

    async function loadDesktopStatus() {
      try {
        const body = await fetchJson('desktop/status')
        emit({
          desktop: {
            ...snapshot.desktop,
            supported: body.supported !== false,
            running: body.running === true,
            compiled: body.compiled === true,
            error: null,
          },
        })
      } catch {
        emit({ desktop: { ...snapshot.desktop, supported: false, running: false, error: 'host' } })
      }
    }

    /** Push the pinned notes the native desktop window renders. */
    let desktopSignature = null
    async function syncDesktopNow() {
      const pinned = snapshot.float.ids
        .map(id => snapshot.notes.find(note => note.id === id))
        .filter(Boolean)
        .map(note => ({
          id: note.id,
          text: note.text,
          color: note.color,
          dueAt: note.dueAt,
          done: note.done,
          images: note.images.map(image => ({ file: image.file })),
        }))
      const payload = { notes: pinned, appearance: snapshot.prefs.appearance }
      const signature = JSON.stringify(payload)
      if (signature === desktopSignature) return
      try {
        await fetchJson('desktop/sync', { method: 'POST', body: JSON.stringify(payload) })
        desktopSignature = signature
      } catch {
        // The Host half may predate the desktop routes until the next restart.
      }
    }

    async function toggleDesktop() {
      if (snapshot.desktop.busy) return
      emit({ desktop: { ...snapshot.desktop, busy: true, error: null } })
      try {
        await syncDesktopNow()
        const action = snapshot.desktop.running ? 'desktop/stop' : 'desktop/start'
        const body = await fetchJson(action, { method: 'POST', body: '{}' })
        emit({
          desktop: {
            ...snapshot.desktop,
            supported: body.supported !== false,
            running: body.running === true,
            compiled: body.compiled === true,
            busy: false,
            error: null,
          },
        })
      } catch (error) {
        emit({ desktop: { ...snapshot.desktop, busy: false, error: String(error?.message ?? error) } })
      }
    }

    /** Drop pin references whose note no longer exists. */
    function pruneFloat(notes) {
      const ids = snapshot.float.ids
      if (ids.length === 0) return
      const alive = new Set(notes.map(note => note.id))
      const kept = ids.filter(id => alive.has(id))
      if (kept.length !== ids.length) setFloat({ ids: kept })
    }

    function scheduleSave(delay = 350) {
      if (saveTimer !== null) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        void persist()
      }, delay)
    }

    async function persist() {
      if (saving) return
      saving = true
      const sentRevision = revision
      emit({ saving: true, saveError: null })
      try {
        const body = await fetchJson('save', {
          method: 'POST',
          body: JSON.stringify({ notes: snapshot.notes }),
        })
        const hasNewEdits = revision !== sentRevision
        if (!hasNewEdits) dirty = false
        emit({ saving: false, savedAt: body.savedAt ?? nowIso(), saveError: null })
        if (hasNewEdits) scheduleSave(0)
      } catch (error) {
        emit({ saving: false, saveError: String(error?.message ?? error) })
      } finally {
        saving = false
      }
    }

    function setNotes(notes, options = {}) {
      revision += 1
      dirty = true
      emit({ notes })
      if (options.immediate === true) {
        if (saveTimer !== null) {
          clearTimeout(saveTimer)
          saveTimer = null
        }
        void persist()
      } else {
        scheduleSave()
      }
    }

    async function loadState(force = false) {
      if (dirty && !force) return
      try {
        const body = await fetchJson('state')
        if (dirty && !force) return
        const notes = Array.isArray(body.notes) ? body.notes.map(sanitizeNote).filter(Boolean) : []
        dirty = false
        loadRetry = 0
        emit({ status: 'ready', notes, savedAt: body.savedAt ?? null, error: null })
        pruneFloat(notes)
        scanDue()
      } catch (error) {
        emit({
          status: snapshot.notes.length > 0 ? 'ready' : 'error',
          error: String(error?.message ?? error),
        })
        // The Host route may be a moment behind the Client during boot.
        if (snapshot.notes.length === 0 && loadRetry < 5) {
          loadRetry += 1
          window.setTimeout(() => {
            void loadState(true)
          }, 800 * loadRetry)
        }
      }
    }

    function noteById(id) {
      return snapshot.notes.find(note => note.id === id) ?? null
    }

    function createNote(draft) {
      const now = nowIso()
      const note = {
        id: typeof draft.id === 'string' && NOTE_ID_RE.test(draft.id) ? draft.id : uid(),
        text: typeof draft.text === 'string' ? draft.text : '',
        color: COLORS.includes(draft.color) ? draft.color : 'amber',
        createdAt: now,
        updatedAt: now,
        dueAt: isoOr(draft.dueAt),
        done: draft.done === true,
        doneAt: draft.done === true ? now : null,
        remindedAt: null,
        order: null,
        images: Array.isArray(draft.images) ? draft.images.map(sanitizeImage).filter(Boolean) : [],
      }
      setNotes([note, ...snapshot.notes], { immediate: true })
      return note
    }

    function updateNote(id, patch) {
      const current = noteById(id)
      if (current === null) return
      const updatedAt = nowIso()
      const next = { ...current, ...patch, updatedAt }
      if (Object.prototype.hasOwnProperty.call(patch, 'done')) {
        next.doneAt = patch.done === true ? (current.done === true && current.doneAt ? current.doneAt : updatedAt) : null
        if (patch.done !== true && current.done === true) next.remindedAt = null
      }
      if (next.done === true) dismissReminder(id)
      setNotes(snapshot.notes.map(note => (note.id === id ? next : note)), { immediate: true })
    }

    function toggleDone(id) {
      const current = noteById(id)
      if (current === null) return
      updateNote(id, { done: !current.done })
    }

    /** Manual order first, then newest first for notes that never got an index. */
    function orderNotesManually(notes) {
      return [...notes].sort((left, right) => {
        const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER
        const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER
        if (leftOrder !== rightOrder) return leftOrder - rightOrder
        return (parseTime(right.createdAt) ?? 0) - (parseTime(left.createdAt) ?? 0)
      })
    }

    /** Move one note beside another and renumber every note so the order is stable. */
    function reorderNotes(draggedId, targetId, placeAfter) {
      if (draggedId === targetId) return
      const ordered = orderNotesManually(snapshot.notes)
      const from = ordered.findIndex(note => note.id === draggedId)
      if (from < 0) return
      const [moved] = ordered.splice(from, 1)
      let to = ordered.findIndex(note => note.id === targetId)
      if (to < 0) return
      if (placeAfter) to += 1
      ordered.splice(to, 0, moved)
      const positions = new Map(ordered.map((note, index) => [note.id, index]))
      setNotes(
        snapshot.notes.map(note => {
          const next = positions.get(note.id)
          if (next === undefined || note.order === next) return note
          return { ...note, order: next }
        }),
        { immediate: true },
      )
    }

    function removeNote(id) {
      dismissReminder(id)
      unpinNote(id)
      setNotes(snapshot.notes.filter(note => note.id !== id), { immediate: true })
    }

    function dismissReminder(id) {
      if (!snapshot.reminders.some(reminder => reminder.noteId === id)) return
      emit({ reminders: snapshot.reminders.filter(reminder => reminder.noteId !== id) })
    }

    function snoozeReminder(id) {
      const current = noteById(id)
      dismissReminder(id)
      if (current === null) return
      updateNote(id, {
        dueAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        remindedAt: null,
      })
    }

    function requestNewNote() {
      emit({ pendingNew: true })
      try {
        runtime?.ctx?.layout?.selectPanel?.(PANEL_ID)
      } catch {
        // navigation is best effort
      }
    }

    function takeNewRequest() {
      if (!snapshot.pendingNew) return
      emit({ pendingNew: false })
    }

    function openPanel(noteId) {
      try {
        runtime?.ctx?.layout?.selectPanel?.(PANEL_ID)
      } catch {
        // navigation is best effort
      }
      if (typeof noteId === 'string') {
        emit({ focusNoteId: noteId })
        dismissReminder(noteId)
      }
    }

    function clearFocus() {
      if (snapshot.focusNoteId === null) return
      emit({ focusNoteId: null })
    }

    function readNotificationPermission() {
      try {
        if (typeof Notification !== 'function') return 'unsupported'
        return Notification.permission
      } catch {
        return 'unsupported'
      }
    }

    async function enableDesktopNotifications() {
      try {
        if (typeof Notification !== 'function' || typeof Notification.requestPermission !== 'function') {
          return 'unsupported'
        }
        return await Notification.requestPermission()
      } catch {
        return 'denied'
      }
    }

    function notifyDesktop(note) {
      try {
        if (typeof Notification !== 'function' || Notification.permission !== 'granted') return
        const body = note.text.trim().length > 0 ? note.text.trim().slice(0, 160) : tr('reminderImageOnly')
        const notification = new Notification(tr('reminderTitle'), {
          body,
          tag: `dsh-sticky-note-${note.id}`,
        })
        notification.onclick = () => {
          try {
            window.focus()
          } catch {
            // ignore
          }
          openPanel(note.id)
          notification.close?.()
        }
      } catch {
        // notifications are best effort
      }
    }

    /** Fire the in-app and desktop reminders for notes whose due time passed. */
    function scanDue() {
      const now = Date.now()
      const due = snapshot.notes.filter(note => {
        if (note.done) return false
        const dueTime = parseTime(note.dueAt)
        if (dueTime === null || dueTime > now) return false
        const reminded = parseTime(note.remindedAt)
        return reminded === null || reminded < dueTime
      })
      if (due.length === 0) return
      const known = new Set(snapshot.reminders.map(reminder => reminder.noteId))
      const fresh = due.filter(note => !known.has(note.id))
      if (fresh.length > 0) {
        emit({
          reminders: [
            ...snapshot.reminders,
            ...fresh.map(note => ({ noteId: note.id, firedAt: now })),
          ],
        })
        for (const note of fresh) notifyDesktop(note)
      }
      const ids = new Set(due.map(note => note.id))
      const remindedAt = new Date(now).toISOString()
      setNotes(
        snapshot.notes.map(note => (ids.has(note.id) ? { ...note, remindedAt } : note)),
        { immediate: false },
      )
    }

    // ---------------------------------------------------------------------
    // Icons
    // ---------------------------------------------------------------------

    function SvgIcon({ size = 16, viewBox = '0 0 24 24', children }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        children,
      )
    }

    function NoteIcon({ size = 16 }) {
      return h(
        SvgIcon,
        { size },
        h('path', { d: 'M6 3.5h8.2L19.5 8.7v11.3a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 6 3.5Z' }),
        h('path', { d: 'M14 3.7v5h5' }),
        h('path', { d: 'M8 12h7M8 15.5h4.5' }),
      )
    }

    function ClockIcon({ size = 14 }) {
      return h(
        SvgIcon,
        { size },
        h('circle', { cx: 12, cy: 12, r: 8 }),
        h('path', { d: 'M12 7.5V12l3 1.8' }),
      )
    }

    function BellIcon({ size = 16 }) {
      return h(
        SvgIcon,
        { size },
        h('path', { d: 'M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z' }),
        h('path', { d: 'M10 18a2.2 2.2 0 0 0 4 0' }),
      )
    }

    function CheckIcon({ size = 14 }) {
      return h(SvgIcon, { size }, h('path', { d: 'm5 12.5 4.2 4.2L19 7' }))
    }

    function PencilIcon({ size = 14 }) {
      return h(
        SvgIcon,
        { size },
        h('path', { d: 'm4.5 19.5 4.4-1 10-10a2 2 0 0 0-2.8-2.8l-10 10-1.6 3.8Z' }),
        h('path', { d: 'm13.7 7.3 3 3' }),
      )
    }

    function TrashIcon({ size = 14 }) {
      return h(
        SvgIcon,
        { size },
        h('path', { d: 'M4.5 7h15' }),
        h('path', { d: 'M9.5 7V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7' }),
        h('path', { d: 'm6.5 7 .8 12.1c.05.8.7 1.4 1.5 1.4h6.4c.8 0 1.45-.6 1.5-1.4L17.5 7' }),
      )
    }

    function SearchIcon({ size = 14 }) {
      return h(
        SvgIcon,
        { size },
        h('circle', { cx: 11, cy: 11, r: 6.5 }),
        h('path', { d: 'm16 16 4 4' }),
      )
    }

    function CloseIcon({ size = 14 }) {
      return h(SvgIcon, { size }, h('path', { d: 'M6 6l12 12M18 6 6 18' }))
    }

    function PlusIcon({ size = 14 }) {
      return h(SvgIcon, { size }, h('path', { d: 'M12 5v14M5 12h14' }))
    }

    function ImageIcon({ size = 14 }) {
      return h(
        SvgIcon,
        { size },
        h('rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 2 }),
        h('circle', { cx: 9, cy: 10, r: 1.4 }),
        h('path', { d: 'm5 17 5-4.5 4 3.5 2-1.8 3 2.8' }),
      )
    }

    function PaperclipIcon({ size = 14 }) {
      return h(
        SvgIcon,
        { size },
        h('path', { d: 'M20 11.5 12.6 19a4.6 4.6 0 0 1-6.5-6.5l7.8-7.8a3.1 3.1 0 0 1 4.4 4.4l-7.7 7.7a1.6 1.6 0 0 1-2.3-2.3l7-7' }),
      )
    }

    function KeyboardIcon({ size = 16 }) {
      return h(
        SvgIcon,
        { size },
        h('rect', { x: 2.5, y: 6, width: 19, height: 12, rx: 2 }),
        h('path', { d: 'M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M6.5 13.5h.01M10 13.5h.01M13.5 13.5h.01M17 13.5h.01M8 16.5h8' }),
      )
    }

    function PinIcon({ size = 14 }) {
      return h(
        SvgIcon,
        { size },
        h('path', { d: 'M9.7 3.2h4.6l-.55 3.6 2.35 2.5v1.55H7.9V9.3l2.35-2.5L9.7 3.2Z' }),
        h('path', { d: 'M12 10.8v5.4' }),
        h('path', { d: 'M9.2 19.6h5.6' }),
      )
    }

    function ChevronDownIcon({ size = 14 }) {
      return h(SvgIcon, { size }, h('path', { d: 'm6 9.6 6 6 6-6' }))
    }

    function ChevronUpIcon({ size = 14 }) {
      return h(SvgIcon, { size }, h('path', { d: 'm6 14.4 6-6 6 6' }))
    }

    function DesktopIcon({ size = 14 }) {
      return h(
        SvgIcon,
        { size },
        h('rect', { x: 2.6, y: 4.5, width: 18.8, height: 12, rx: 2 }),
        h('path', { d: 'M9 20.5h6M12 16.5v4' }),
      )
    }

    function StickyMark({ size = 22 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 64 64', 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M14 7h30a6 6 0 0 1 6 6v27L39 52H14a6 6 0 0 1-6-6V13a6 6 0 0 1 6-6Z',
          fill: 'currentColor',
          opacity: 0.9,
        }),
        h('path', { d: 'M50 40 40 50v-8a2 2 0 0 1 2-2h8Z', fill: '#fff', opacity: 0.65 }),
        h('rect', { x: 17, y: 19, width: 19, height: 3.4, rx: 1.7, fill: '#fff', opacity: 0.75 }),
        h('rect', { x: 17, y: 27, width: 14, height: 3.4, rx: 1.7, fill: '#fff', opacity: 0.6 }),
      )
    }

    // ---------------------------------------------------------------------
    // Sidebar entry
    // ---------------------------------------------------------------------

    const ICON_CSS = `
.sn-side { position: relative; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
.sn-side-badge { position: absolute; top: -5px; right: -7px; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 999px; background: var(--dsw-alias-state-error-primary); color: #fff; font-size: 9px; line-height: 14px; font-weight: 700; text-align: center; font-family: inherit; box-shadow: 0 0 0 2px var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base)); }
`

    function SidebarEntry({ size = 18 }) {
      useLocaleTick()
      const state = useSyncExternalStore(subscribe, getSnapshot)
      const now = Date.now()
      const overdue = state.notes.filter(note => {
        if (note.done) return false
        const dueTime = parseTime(note.dueAt)
        return dueTime !== null && dueTime <= now
      }).length
      return h(
        'span',
        { className: 'sn-side', style: { width: size, height: size } },
        h(StickyMark, { size }),
        overdue > 0 ? h('span', { className: 'sn-side-badge', 'aria-label': tr('statDue') }, overdue > 9 ? '9+' : String(overdue)) : null,
        h('style', null, ICON_CSS),
      )
    }

    // ---------------------------------------------------------------------
    // Reminder toasts
    // ---------------------------------------------------------------------

    const TOAST_CSS = `
.sn-toasts { position: fixed; top: 14px; right: 16px; z-index: 1200; display: flex; flex-direction: column; gap: 9px; width: min(342px, calc(100vw - 32px)); pointer-events: none; }
.sn-toast { pointer-events: auto; border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-overlay); border-radius: 11px; box-shadow: 0 12px 34px rgba(0,0,0,0.28); padding: 11px 12px; color: var(--dsw-alias-label-primary); animation: sn-toast-in 160ms ease-out; }
@keyframes sn-toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
.sn-toast-head { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-state-warn-primary); }
.sn-toast-close { margin-left: auto; border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 2px; display: inline-flex; border-radius: 5px; }
.sn-toast-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.sn-toast-text { margin-top: 6px; font-size: 13px; line-height: 1.45; max-height: 3.9em; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.sn-toast-due { margin-top: 4px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.sn-toast-actions { display: flex; align-items: center; gap: 6px; margin-top: 9px; flex-wrap: wrap; }
.sn-toast-actions button { border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); border-radius: 7px; height: 26px; padding: 0 9px; font: inherit; font-size: 12px; cursor: pointer; }
.sn-toast-actions button:hover { background: var(--dsw-alias-bg-layer-2); }
.sn-toast-actions button.is-primary { background: var(--dsw-alias-state-warn-primary); border-color: transparent; color: #fff; font-weight: 600; }
`

    function ReminderToasts() {
      useLocaleTick()
      const state = useSyncExternalStore(subscribe, getSnapshot)
      const items = state.reminders
        .map(reminder => ({ reminder, note: state.notes.find(note => note.id === reminder.noteId) ?? null }))
        .filter(item => item.note !== null)
      return h(
        React.Fragment,
        null,
        h('style', { key: 'sn-toast-css' }, TOAST_CSS),
        items.length === 0
          ? null
          : h(
              'div',
              { className: 'sn-toasts', role: 'region', 'aria-label': tr('reminders') },
              items.map(({ reminder, note }) =>
                h(
                  'div',
                  { key: reminder.noteId, className: 'sn-toast', role: 'status' },
                  h(
                    'div',
                    { className: 'sn-toast-head' },
                    h(BellIcon, { size: 13 }),
                    h('span', null, tr('reminderTitle')),
                    h(
                      'button',
                      {
                        className: 'sn-toast-close',
                        title: tr('reminderDismiss'),
                        'aria-label': tr('reminderDismiss'),
                        onClick: () => dismissReminder(note.id),
                      },
                      h(CloseIcon, { size: 12 }),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'sn-toast-text' },
                    note.text.trim().length > 0 ? note.text.trim() : tr('reminderImageOnly'),
                  ),
                  h('div', { className: 'sn-toast-due' }, formatDue(note.dueAt)),
                  h(
                    'div',
                    { className: 'sn-toast-actions' },
                    h(
                      'button',
                      {
                        className: 'is-primary',
                        onClick: () => openPanel(note.id),
                      },
                      tr('reminderView'),
                    ),
                    h(
                      'button',
                      {
                        onClick: () => {
                          toggleDone(note.id)
                          dismissReminder(note.id)
                        },
                      },
                      tr('reminderDone'),
                    ),
                    h('button', { onClick: () => snoozeReminder(note.id) }, tr('reminderSnooze')),
                  ),
                ),
              ),
            ),
      )
    }

    // ---------------------------------------------------------------------
    // Pinned floating notes
    // ---------------------------------------------------------------------

    const FLOAT_CSS = `
.sn-float { position: fixed; z-index: 940; pointer-events: auto; display: flex; flex-direction: column; width: 326px; max-height: min(66vh, 540px); box-sizing: border-box; border-radius: 14px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 20px 48px rgba(0,0,0,0.34); font-size: 13px; overflow: hidden; }
.sn-float.is-collapsed { width: 226px; }
.sn-float-bar { display: flex; align-items: center; gap: 5px; padding: 8px 7px 8px 10px; flex: none; cursor: grab; user-select: none; touch-action: none; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.sn-float.is-collapsed .sn-float-bar { border-bottom: none; }
.sn-float-bar:active { cursor: grabbing; }
.sn-float-bar.is-locked { cursor: default; }
.sn-float-mark { display: inline-flex; color: var(--dsw-alias-state-warn-primary); }
.sn-float-title { font-size: 12.5px; font-weight: 650; white-space: nowrap; }
.sn-float-count { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.sn-float-spacer { flex: 1; }
.sn-float .sn-float-bar .sn-icon-btn { width: 24px; height: 24px; border-radius: 7px; border-color: transparent; }
.sn-float-body { display: flex; flex-direction: column; gap: 8px; padding: 9px; overflow-y: auto; }
.sn-float-capture { flex: none; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 10px; padding: 7px 8px; }
.sn-float-capture:focus-within { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1)); }
.sn-float-capture textarea { display: block; width: 100%; box-sizing: border-box; min-height: 22px; max-height: 110px; padding: 0; border: none; outline: none; resize: none; background: transparent; color: inherit; font: inherit; font-size: 13px; line-height: 1.5; }
.sn-float-capture textarea::placeholder { color: var(--dsw-alias-label-secondary); }
.sn-float-capture-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.sn-float-capture-row .sn-icon-btn { width: 26px; height: 26px; }
.sn-float-capture-hint { font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin-right: auto; }
.sn-float-captured { display: flex; gap: 4px; margin-top: 6px; }
.sn-float-captured img { width: 42px; height: 34px; object-fit: cover; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1); display: block; }
/* The float lives in the frame-wide overlay, outside the wall page, so it
   carries its own copies of the controls it reuses there. */
.sn-float .sn-icon-btn { width: 26px; height: 26px; padding: 0; border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: none; }
.sn-float .sn-icon-btn:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.sn-float .sn-btn { height: 26px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; flex: none; }
.sn-float .sn-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.sn-float .sn-btn.is-primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; font-weight: 600; }
.sn-float .sn-btn.is-primary:hover { opacity: 0.92; }
.sn-float .sn-btn:disabled { opacity: 0.45; cursor: default; }
.sn-float .sn-check { width: 18px; height: 18px; flex: none; padding: 0; border-radius: 6px; border: 1.5px solid color-mix(in srgb, var(--dsw-alias-label-primary) 30%, transparent); background: transparent; color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.sn-float .sn-check:hover { border-color: var(--dsw-alias-state-success-primary); }
.sn-float .sn-check.is-on { background: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.sn-float .sn-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); background: color-mix(in srgb, var(--dsw-alias-bg-base) 35%, transparent); color: var(--dsw-alias-label-secondary); font-size: 10.5px; white-space: nowrap; }
.sn-float .sn-chip.is-overdue { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.sn-float .sn-chip.is-soon { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.sn-float .sn-card-spacer { flex: 1; }
.sn-float .sn-error-text { margin-top: 6px; font-size: 11.5px; color: var(--dsw-alias-state-error-primary); }
.sn-fcard { --sn-tint: var(--dsw-alias-state-warn-primary); border-radius: min(var(--sn-radius, 12px), 14px); border: 1px solid var(--sn-card-border, color-mix(in srgb, var(--sn-tint) 36%, var(--dsw-alias-border-l1))); background: var(--sn-card-bg, color-mix(in srgb, var(--sn-tint) 20%, var(--dsw-alias-bg-layer-1))); color: var(--sn-card-fg, var(--dsw-alias-label-primary)); padding: 8px 9px 9px; }
.sn-fcard.is-done { opacity: 0.62; }
.sn-fcard-top { display: flex; align-items: center; gap: 6px; }
.sn-fcard-top .sn-check { width: 18px; height: 18px; margin-top: 0; }
.sn-fcard-top .sn-icon-btn { width: 23px; height: 23px; border-color: transparent; }
.sn-float .sn-fcard-top .sn-icon-btn { width: 23px; height: 23px; }
.sn-fcard-text { display: -webkit-box; margin: 6px 0 0; font-size: calc(var(--sn-font-size, 13px) - 1px); line-height: var(--sn-line-height, 1.5); white-space: pre-wrap; overflow-wrap: anywhere; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; cursor: text; }
.sn-fcard-text.is-empty { color: var(--sn-muted, var(--dsw-alias-label-secondary)); font-style: italic; }
.sn-fcard-text.is-done { text-decoration: line-through; }
.sn-fcard-textarea { display: block; width: 100%; box-sizing: border-box; min-height: 58px; margin-top: 6px; padding: 7px 8px; resize: vertical; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay); color: inherit; font: inherit; font-size: 13px; line-height: 1.5; outline: none; }
.sn-fcard-textarea:focus { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1)); }
.sn-fcard-thumbs { display: flex; gap: 4px; margin-top: 7px; }
.sn-fcard-thumbs img { width: 46px; height: 36px; object-fit: cover; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1); display: block; cursor: zoom-in; }
.sn-fcard-hint { margin-top: 6px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.sn-fcard-empty { padding: 13px 11px; border-radius: 10px; border: 1px dashed var(--dsw-alias-border-l2); text-align: center; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.sn-float-foot { flex: none; padding: 6px 10px 7px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
@media (max-width: 560px) { .sn-float { width: calc(100vw - 24px); } }
`

    function clampNumber(value, min, max) {
      return Math.min(Math.max(value, min), max)
    }

    /** Quick capture that pins what it saves, so the float fills itself. */
    function FloatCapture() {
      useLocaleTick()
      const [text, setText] = useState('')
      const [images, setImages] = useState([])
      const textRef = useRef(null)
      const fileRef = useRef(null)
      const drop = useImageDrop(image => setImages(list => [...list, image]))
      const canSave = (text.trim().length > 0 || images.length > 0) && drop.pending === 0

      const save = () => {
        if (!canSave) {
          textRef.current?.focus()
          return
        }
        const note = createNote({ text, images, color: snapshot.prefs.appearance.accent })
        pinNote(note.id)
        setText('')
        setImages([])
        if (textRef.current !== null) textRef.current.style.height = 'auto'
      }

      return h(
        'div',
        {
          className: 'sn-float-capture',
          onDrop: event => drop.onDrop(event),
          onDragOver: event => {
            if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
          },
        },
        h('textarea', {
          ref: textRef,
          value: text,
          rows: 1,
          placeholder: tr('floatCapture'),
          'aria-label': tr('floatCapture'),
          onChange: event => {
            setText(event.target.value)
            autoGrow(event.target)
          },
          onPaste: event => drop.onPaste(event),
          onKeyDown: event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              save()
            }
          },
        }),
        images.length > 0
          ? h(
              'div',
              { className: 'sn-float-captured' },
              images.map((image, index) =>
                h('img', {
                  key: `${image.file}-${index}`,
                  src: imageSrc(image),
                  alt: tr('imageAlt'),
                  onClick: () => setImages(list => list.filter((_, position) => position !== index)),
                  title: tr('removeImage'),
                }),
              ),
            )
          : null,
        drop.error !== null ? h('div', { className: 'sn-error-text' }, `${tr('imageFailed')}: ${drop.error}`) : null,
        h(
          'div',
          { className: 'sn-float-capture-row' },
          h(
            'button',
            {
              className: 'sn-icon-btn',
              title: tr('addImage'),
              'aria-label': tr('addImage'),
              onClick: () => fileRef.current?.click(),
            },
            h(ImageIcon, { size: 14 }),
          ),
          h('input', {
            ref: fileRef,
            type: 'file',
            accept: 'image/*',
            multiple: true,
            style: { display: 'none' },
            onChange: event => {
              void drop.addFiles(event.target.files)
              event.target.value = ''
            },
          }),
          h('span', { className: 'sn-float-capture-hint' }, tr('quickHint')),
          h(
            'button',
            { className: 'sn-btn is-primary', style: { height: 26, padding: '0 10px' }, disabled: !canSave, onClick: save },
            tr('quickSave'),
          ),
        ),
      )
    }

    function FloatCard({ note }) {
      useLocaleTick()
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState(note.text)
      const textRef = useRef(null)

      useEffect(() => {
        if (!editing) setDraft(note.text)
      }, [note.text, editing])

      useEffect(() => {
        if (!editing) return
        const element = textRef.current
        if (element === null) return
        element.focus()
        try {
          element.setSelectionRange(element.value.length, element.value.length)
        } catch {
          // ignore
        }
      }, [editing])

      const commit = () => {
        setEditing(false)
        if (draft !== note.text) updateNote(note.id, { text: draft })
      }

      const cancel = () => {
        setDraft(note.text)
        setEditing(false)
      }

      return h(
        'div',
        { className: `sn-fcard sn-color-${note.color}${note.done ? ' is-done' : ''}` },
        h(
          'div',
          { className: 'sn-fcard-top' },
          h(
            'button',
            {
              className: `sn-check${note.done ? ' is-on' : ''}`,
              title: note.done ? tr('markUndone') : tr('markDone'),
              'aria-label': note.done ? tr('markUndone') : tr('markDone'),
              'aria-pressed': note.done,
              onClick: () => toggleDone(note.id),
            },
            note.done ? h(CheckIcon, { size: 12 }) : null,
          ),
          note.dueAt ? h('span', { className: `sn-chip${dueChipClass(note)}` }, h(ClockIcon, { size: 10 }), formatDue(note.dueAt, note.done)) : null,
          h('span', { className: 'sn-card-spacer' }),
          h(
            'button',
            {
              className: 'sn-icon-btn',
              title: tr('floatOpenWall'),
              'aria-label': tr('floatOpenWall'),
              onClick: () => openPanel(note.id),
            },
            h(NoteIcon, { size: 13 }),
          ),
          h(
            'button',
            {
              className: 'sn-icon-btn',
              title: tr('unpin'),
              'aria-label': tr('unpin'),
              onClick: () => unpinNote(note.id),
            },
            h(PinIcon, { size: 13 }),
          ),
        ),
        editing
          ? h('textarea', {
              ref: textRef,
              className: 'sn-fcard-textarea',
              value: draft,
              onChange: event => setDraft(event.target.value),
              onBlur: commit,
              onKeyDown: event => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  event.stopPropagation()
                  commit()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  cancel()
                }
              },
            })
          : h(
              'p',
              {
                className: `sn-fcard-text${note.text.trim().length === 0 ? ' is-empty' : ''}${note.done ? ' is-done' : ''}`,
                title: tr('editNote'),
                onClick: () => setEditing(true),
              },
              note.text.trim().length > 0 ? note.text : tr('emptyNote'),
            ),
        note.images.length > 0
          ? h(
              'div',
              { className: 'sn-fcard-thumbs' },
              note.images.slice(0, 4).map((image, index) =>
                h('img', {
                  key: `${image.file}-${index}`,
                  src: imageSrc(image),
                  alt: tr('imageAlt'),
                  loading: 'lazy',
                  onClick: () => openPanel(note.id),
                }),
              ),
            )
          : null,
        editing ? h('div', { className: 'sn-fcard-hint' }, tr('floatEditHint')) : null,
      )
    }

    /**
     * The always-on-top note window: it is registered into `shell.overlay`,
     * the frame-wide floating layer above every column and panel, so pinned
     * notes stay readable while the user browses sessions or chats.
     */
    function FloatWindow() {
      useLocaleTick()
      const state = useSyncExternalStore(subscribe, getSnapshot)
      const float = state.float
      const rootRef = useRef(null)
      const [pos, setPos] = useState(() => ({ x: float.x, y: float.y }))

      useEffect(() => {
        setPos({ x: float.x, y: float.y })
      }, [float.x, float.y])

      useEffect(() => {
        const onResize = () => {
          const box = rootRef.current
          if (box === null || pos.x === null || pos.y === null) return
          const maxX = Math.max(6, window.innerWidth - box.offsetWidth - 6)
          const maxY = Math.max(6, window.innerHeight - 48)
          if (pos.x <= maxX && pos.y <= maxY) return
          const next = { x: clampNumber(pos.x, 6, maxX), y: clampNumber(pos.y, 6, maxY) }
          setPos(next)
          setFloat({ x: next.x, y: next.y })
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [pos.x, pos.y])

      const startDrag = event => {
        if (event.button !== 0) return
        if (state.prefs.float.locked) return
        if (typeof event.target?.closest === 'function' && event.target.closest('button') !== null) return
        const box = rootRef.current
        if (box === null) return
        const rect = box.getBoundingClientRect()
        const startX = event.clientX
        const startY = event.clientY
        let last = { x: Math.round(rect.left), y: Math.round(rect.top) }
        const move = moveEvent => {
          const maxX = Math.max(6, window.innerWidth - rect.width - 6)
          const maxY = Math.max(6, window.innerHeight - 48)
          last = {
            x: clampNumber(Math.round(rect.left + moveEvent.clientX - startX), 6, maxX),
            y: clampNumber(Math.round(rect.top + moveEvent.clientY - startY), 6, maxY),
          }
          box.style.left = `${last.x}px`
          box.style.top = `${last.y}px`
          box.style.right = 'auto'
          box.style.bottom = 'auto'
        }
        const finish = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          // Snap to the nearest side so the window never ends up half off-screen.
          const edge = 26
          const rightGap = window.innerWidth - (last.x + rect.width)
          if (last.x <= edge) last = { ...last, x: 8 }
          else if (rightGap <= edge) last = { ...last, x: Math.max(8, window.innerWidth - rect.width - 8) }
          if (last.y <= edge) last = { ...last, y: 8 }
          else if (window.innerHeight - (last.y + rect.height) <= edge) {
            last = { ...last, y: Math.max(8, window.innerHeight - rect.height - 8) }
          }
          setPos(last)
          setFloat({ x: last.x, y: last.y })
        }
        event.preventDefault()
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
      }

      const pinned = useMemo(
        () => float.ids.map(id => state.notes.find(note => note.id === id)).filter(Boolean),
        [float.ids, state.notes],
      )

      const prefs = state.prefs
      if (!float.visible || state.modalOpen) return null
      const style = {
        ...appearanceVars(prefs),
        ...(pos.x === null || pos.y === null ? { right: 18, bottom: 22 } : { left: pos.x, top: pos.y }),
        opacity: prefs.float.opacity,
        ...(float.collapsed ? {} : { width: prefs.float.width }),
      }

      return h(
        'aside',
        {
          ref: rootRef,
          className: `sn-float${float.collapsed ? ' is-collapsed' : ''} ${appearanceClass(prefs)}`,
          style,
          role: 'complementary',
          'aria-label': tr('floatTitle'),
        },
        h('style', null, THEME_CSS),
        h('style', null, FLOAT_CSS),
        h(
          'div',
          { className: `sn-float-bar${prefs.float.locked ? ' is-locked' : ''}`, onPointerDown: startDrag },
          h('span', { className: 'sn-float-mark' }, h(StickyMark, { size: 15 })),
          h('span', { className: 'sn-float-title' }, tr('floatTitle')),
          h('span', { className: 'sn-float-count' }, tr('floatCount', { n: pinned.length })),
          h('span', { className: 'sn-float-spacer' }),
          h(
            'button',
            {
              className: 'sn-icon-btn',
              title: float.collapsed ? tr('floatExpand') : tr('floatCollapse'),
              'aria-label': float.collapsed ? tr('floatExpand') : tr('floatCollapse'),
              'aria-expanded': !float.collapsed,
              onClick: () => setFloat({ collapsed: !float.collapsed }),
            },
            float.collapsed ? h(ChevronDownIcon, { size: 14 }) : h(ChevronUpIcon, { size: 14 }),
          ),
          h(
            'button',
            {
              className: 'sn-icon-btn',
              title: tr('floatOpenWall'),
              'aria-label': tr('floatOpenWall'),
              onClick: () => openPanel(),
            },
            h(NoteIcon, { size: 14 }),
          ),
          h(
            'button',
            {
              className: 'sn-icon-btn',
              title: tr('floatHide'),
              'aria-label': tr('floatHide'),
              onClick: () => setFloat({ visible: false }),
            },
            h(CloseIcon, { size: 13 }),
          ),
        ),
        h(
          'div',
          { className: 'sn-float-body' },
          h(FloatCapture),
          pinned.length === 0
            ? h('div', { className: 'sn-fcard-empty' }, tr('floatEmpty'))
            : pinned.map(note => h(FloatCard, { key: note.id, note })),
        ),
        float.collapsed ? null : h('div', { className: 'sn-float-foot' }, tr('floatHint')),
      )
    }

    // ---------------------------------------------------------------------
    // Wall styles
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Appearance theme (shared by the wall, the float and the settings page)
    // ---------------------------------------------------------------------

    const THEME_CSS = `
/* The paper colour is chosen rather than inherited, so a note stays readable
   on light themes, dark themes and wallpaper backgrounds alike. */
.sn-scheme-auto :is(.sn-card, .sn-fcard, .sn-preview) { --sn-card-bg: color-mix(in srgb, var(--sn-tint) 26%, var(--dsw-alias-bg-layer-1)); --sn-card-fg: var(--dsw-alias-label-primary); --sn-card-border: color-mix(in srgb, var(--sn-tint) 38%, var(--dsw-alias-border-l1)); --sn-muted: var(--dsw-alias-label-secondary); }
.sn-scheme-light :is(.sn-card, .sn-fcard, .sn-preview) { --sn-card-bg: color-mix(in srgb, var(--sn-tint) 15%, #fffdf7); --sn-card-fg: #23252b; --sn-card-border: color-mix(in srgb, var(--sn-tint) 34%, #d6cfbd); --sn-muted: rgba(35,37,43,0.62); }
.sn-scheme-dark :is(.sn-card, .sn-fcard, .sn-preview) { --sn-card-bg: color-mix(in srgb, var(--sn-tint) 17%, #23252d); --sn-card-fg: #f3f4f6; --sn-card-border: color-mix(in srgb, var(--sn-tint) 30%, #3b3e48); --sn-muted: rgba(243,244,246,0.66); }
.sn-surface-glass :is(.sn-card, .sn-fcard, .sn-preview) { backdrop-filter: blur(9px) saturate(1.12); -webkit-backdrop-filter: blur(9px) saturate(1.12); }
.sn-surface-glass.sn-scheme-auto :is(.sn-card, .sn-fcard, .sn-preview) { --sn-card-bg: color-mix(in srgb, var(--sn-tint) 32%, transparent); }
.sn-surface-solid.sn-scheme-auto :is(.sn-card, .sn-fcard, .sn-preview) { --sn-card-bg: color-mix(in srgb, var(--sn-tint) 17%, var(--dsw-alias-bg-layer-1)); }
.sn-contrast-high :is(.sn-card, .sn-fcard, .sn-preview) { border-width: 1.5px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); }
.sn-contrast-high .sn-text { font-weight: 500; }
.sn-density-compact .sn-card { padding: 9px 10px 8px; }
.sn-density-compact .sn-text { -webkit-line-clamp: 9; }
.sn-color-amber { --sn-tint: var(--dsw-alias-state-warn-primary); }
.sn-color-rose { --sn-tint: var(--dsw-alias-state-error-primary); }
.sn-color-mint { --sn-tint: var(--dsw-alias-state-success-primary); }
.sn-color-sky { --sn-tint: var(--dsw-alias-brand-primary); }
.sn-color-violet { --sn-tint: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-state-error-primary)); }
.sn-color-slate { --sn-tint: var(--dsw-alias-state-idle-primary); }
`

    const WALL_CSS = `
.sn-page { height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; box-sizing: border-box; padding: var(--sn-pad, 22px 26px 84px); color: var(--dsw-alias-label-primary); font-size: var(--sn-font-size, 14px); font-family: var(--sn-font-family, inherit); }
.sn-inner { max-width: 1180px; margin: 0 auto; }
.sn-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.sn-head-main { min-width: 0; }
.sn-title { display: flex; align-items: center; gap: 10px; font-size: 22px; line-height: 1.2; font-weight: 650; letter-spacing: 0.01em; }
.sn-title-mark { display: inline-flex; color: var(--dsw-alias-state-warn-primary); }
.sn-sub { margin-top: 5px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.sn-head-actions { display: flex; align-items: center; gap: 7px; flex: none; }
.sn-icon-btn { width: 30px; height: 30px; padding: 0; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.sn-icon-btn:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.sn-status { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border-radius: 7px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.sn-status.is-error { color: var(--dsw-alias-state-error-primary); }
.sn-status.is-ok { color: var(--dsw-alias-state-success-primary); }
.sn-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.sn-stats { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.sn-stat { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.sn-stat strong { color: var(--dsw-alias-label-primary); font-weight: 650; font-size: 12px; }
.sn-stat.is-due { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 36%, var(--dsw-alias-border-l1)); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, var(--dsw-alias-bg-layer-1)); }
.sn-stat.is-done { color: var(--dsw-alias-state-success-primary); }
.sn-stat.is-done strong { color: inherit; }

.sn-quick { margin-top: 16px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 14px; padding: 10px 12px; transition: border-color 140ms ease, box-shadow 140ms ease; }
.sn-quick:focus-within { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 58%, var(--dsw-alias-border-l1)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent); }
.sn-quick textarea { display: block; width: 100%; box-sizing: border-box; border: none; outline: none; resize: none; background: transparent; color: inherit; font: inherit; line-height: 1.55; min-height: 24px; max-height: 200px; padding: 0; }
.sn-quick textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.85; }
.sn-quick-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.sn-quick-hint { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: 0.85; white-space: nowrap; }
.sn-toolbar { position: sticky; top: -1px; z-index: 4; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 18px 0 6px; padding: 9px 0; background: color-mix(in srgb, var(--dsw-alias-bg-base) 88%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.sn-search { position: relative; flex: 1 1 190px; max-width: 330px; }
.sn-search input { width: 100%; box-sizing: border-box; height: 32px; padding: 0 30px 0 30px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; font-size: 13px; outline: none; }
.sn-search input:focus { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1)); }
.sn-search .sn-search-icon { position: absolute; left: 9px; top: 9px; color: var(--dsw-alias-label-secondary); pointer-events: none; display: inline-flex; }
.sn-search-clear { position: absolute; right: 6px; top: 7px; width: 18px; height: 18px; padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.sn-search-clear:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.sn-filters { display: inline-flex; gap: 2px; padding: 2px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
.sn-filter { border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; height: 28px; padding: 0 10px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
.sn-filter:hover { color: var(--dsw-alias-label-primary); }
.sn-filter.is-active { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
.sn-filter-count { font-size: 10.5px; opacity: 0.75; }
.sn-new-btn { margin-left: auto; height: 32px; padding: 0 13px; border: 1px solid transparent; border-radius: 9px; background: var(--dsw-alias-brand-primary); color: #fff; font: inherit; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; }
.sn-new-btn:hover { opacity: 0.92; }
.sn-sort-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }

.sn-banner-error { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 8px 11px; border-radius: 9px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, var(--dsw-alias-border-l1)); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, var(--dsw-alias-bg-layer-1)); color: var(--dsw-alias-state-error-primary); font-size: 12.5px; }
.sn-banner-error button { margin-left: auto; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 6px; height: 24px; padding: 0 8px; font: inherit; font-size: 12px; cursor: pointer; }

.sn-wall { columns: 3 280px; column-gap: var(--sn-gap, 14px); }
.sn-card { --sn-tint: var(--dsw-alias-state-warn-primary); break-inside: avoid; position: relative; margin: 0 0 var(--sn-gap, 14px); padding: 12px 13px 10px; border-radius: var(--sn-radius, 12px); border: 1px solid var(--sn-card-border, color-mix(in srgb, var(--sn-tint) 38%, var(--dsw-alias-border-l1))); background: var(--sn-card-bg, color-mix(in srgb, var(--sn-tint) 26%, var(--dsw-alias-bg-layer-1))); color: var(--sn-card-fg, var(--dsw-alias-label-primary)); box-shadow: 0 1px 2px rgba(0,0,0,0.06); cursor: pointer; transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease; }
.sn-card:hover { transform: translateY(-1px); box-shadow: 0 7px 20px rgba(0,0,0,0.11); }
.sn-card.is-manual { cursor: grab; }
.sn-card.is-manual:active { cursor: grabbing; }
.sn-card.is-dragging { opacity: 0.45; transform: scale(0.99); }
.sn-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sn-card.is-done { opacity: 0.64; }
.sn-card.is-overdue { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 52%, var(--dsw-alias-border-l1)); }
.sn-card.is-flash { animation: sn-flash 1.3s ease; }
@keyframes sn-flash { 0%, 100% { box-shadow: 0 1px 2px rgba(0,0,0,0.06); } 28% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent); } }
.sn-card::before { content: ""; position: absolute; top: -6px; left: 50%; width: 54px; height: 12px; transform: translateX(-50%) rotate(-2deg); border-radius: 2px; background: color-mix(in srgb, var(--sn-tint) 50%, var(--dsw-alias-bg-base)); opacity: 0.42; pointer-events: none; }
.sn-card-top { display: flex; align-items: flex-start; gap: 8px; }
.sn-check { width: 20px; height: 20px; flex: none; margin-top: 1px; padding: 0; border-radius: 6px; border: 1.5px solid color-mix(in srgb, var(--sn-card-fg, var(--dsw-alias-label-primary)) 32%, transparent); background: transparent; color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 120ms ease, border-color 120ms ease; }
.sn-check:hover { border-color: var(--dsw-alias-state-success-primary); }
.sn-check.is-on { background: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.sn-card-spacer { flex: 1; }
.sn-card-edit { width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--sn-muted, var(--dsw-alias-label-secondary)); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; transition: opacity 120ms ease, background 120ms ease; }
.sn-card:hover .sn-card-edit, .sn-card-edit:focus-visible { opacity: 1; }
.sn-card-edit:hover { background: color-mix(in srgb, currentColor 14%, transparent); color: var(--sn-card-fg, var(--dsw-alias-label-primary)); }
.sn-card-pin.is-on { opacity: 1; color: var(--dsw-alias-brand-primary); }
.sn-btn.is-on { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1)); color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent); }
.sn-text { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: var(--sn-line-height, 1.5); font-size: calc(var(--sn-font-size, 14px) - 0.5px); display: -webkit-box; -webkit-line-clamp: 12; -webkit-box-orient: vertical; overflow: hidden; }
.sn-text.is-empty { color: var(--sn-muted, var(--dsw-alias-label-secondary)); font-style: italic; }
.sn-card.is-done .sn-text { text-decoration: line-through; text-decoration-thickness: 1px; text-decoration-color: color-mix(in srgb, var(--sn-card-fg, var(--dsw-alias-label-primary)) 45%, transparent); }
.sn-img-grid { margin-top: 9px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.sn-img-grid.is-one { grid-template-columns: 1fr; }
.sn-thumb { position: relative; border-radius: 7px; overflow: hidden; background: color-mix(in srgb, var(--dsw-alias-bg-base) 30%, transparent); aspect-ratio: 4 / 3; }
.sn-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sn-thumb-more { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); color: #fff; font-weight: 650; font-size: 13px; }
.sn-card-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 9px; font-size: 11.5px; color: var(--sn-muted, var(--dsw-alias-label-secondary)); }
.sn-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--sn-card-fg, var(--dsw-alias-label-primary)) 18%, transparent); background: color-mix(in srgb, var(--sn-card-bg, var(--dsw-alias-bg-base)) 55%, transparent); }
.sn-chip.is-overdue { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.sn-chip.is-soon { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.sn-chip.is-done { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.sn-time { margin-left: auto; opacity: 0.8; }

.sn-empty { margin: 42px auto 0; max-width: 430px; text-align: center; color: var(--dsw-alias-label-secondary); }
.sn-empty-art { position: relative; width: 92px; height: 82px; margin: 0 auto 16px; }
.sn-empty-art i { position: absolute; display: block; width: 66px; height: 58px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.sn-empty-art i:nth-child(1) { left: 2px; top: 16px; transform: rotate(-9deg); opacity: 0.55; }
.sn-empty-art i:nth-child(2) { left: 13px; top: 9px; transform: rotate(4deg); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 26%, var(--dsw-alias-bg-layer-1)); opacity: 0.8; }
.sn-empty-art i:nth-child(3) { left: 24px; top: 2px; transform: rotate(-2deg); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 38%, var(--dsw-alias-bg-layer-1)); }
.sn-empty-art i:nth-child(3)::before { content: ""; position: absolute; left: 12px; top: 14px; width: 42px; height: 3px; border-radius: 2px; background: var(--dsw-alias-label-secondary); opacity: 0.4; box-shadow: 0 9px 0 var(--dsw-alias-label-secondary), 0 18px 0 var(--dsw-alias-label-secondary); }
.sn-empty-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.sn-empty-body { margin-top: 6px; font-size: 13px; line-height: 1.55; }
.sn-loading { padding: 56px 0; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; }

.sn-flash { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 1250; padding: 8px 14px; border-radius: 999px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); font-size: 12.5px; box-shadow: 0 8px 26px rgba(0,0,0,0.22); pointer-events: none; animation: sn-flash-in 160ms ease-out; }
@keyframes sn-flash-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
.sn-busy { position: fixed; left: 50%; bottom: 74px; transform: translateX(-50%); z-index: 1250; padding: 7px 12px; border-radius: 999px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 12px; box-shadow: 0 8px 22px rgba(0,0,0,0.18); display: flex; align-items: center; gap: 7px; pointer-events: none; }
.sn-spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 35%, transparent); border-top-color: var(--dsw-alias-brand-primary); animation: sn-spin 700ms linear infinite; }
@keyframes sn-spin { to { transform: rotate(360deg); } }

.sn-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 22px; background: rgba(15, 18, 24, 0.44); backdrop-filter: blur(2px); }
.sn-dialog { width: min(680px, 100%); max-height: min(88vh, 840px); overflow: auto; box-sizing: border-box; padding: 18px; border-radius: 16px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 24px 70px rgba(0,0,0,0.35); animation: sn-dialog-in 150ms ease-out; }
@keyframes sn-dialog-in { from { opacity: 0; transform: translateY(8px) scale(0.99); } to { opacity: 1; transform: none; } }
.sn-dialog.is-help { width: min(560px, 100%); }
.sn-dialog-head { display: flex; align-items: center; gap: 8px; }
.sn-dialog-title { font-size: 16px; font-weight: 650; }
.sn-dialog-head .sn-icon-btn { margin-left: auto; }
.sn-dialog textarea { display: block; width: 100%; box-sizing: border-box; min-height: 148px; margin-top: 14px; resize: vertical; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; line-height: 1.55; outline: none; }
.sn-dialog textarea:focus { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1)); }
.sn-field-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.sn-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.sn-input { height: 32px; box-sizing: border-box; padding: 0 9px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; font-size: 13px; outline: none; }
.sn-input:focus { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1)); }
.sn-color-row { display: flex; align-items: center; gap: 7px; }
.sn-swatch { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid transparent; background: var(--sn-tint); cursor: pointer; box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 12%, transparent); }
.sn-swatch.is-active { border-color: var(--dsw-alias-label-primary); }
.sn-attach-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.sn-attach { position: relative; width: 92px; height: 72px; border-radius: 8px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); flex: none; }
.sn-attach img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sn-attach-remove { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; padding: 0; border: none; border-radius: 50%; background: rgba(0,0,0,0.55); color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.sn-attach-remove:hover { background: rgba(0,0,0,0.75); }
.sn-drop-hint { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 10px; border-radius: 9px; border: 1px dashed var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sn-error-text { margin-top: 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary); }
.sn-hint-text { margin-top: 10px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.sn-dialog-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.sn-dialog-foot .sn-hint-text { margin: 0 auto 0 0; }
.sn-btn { height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.sn-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.sn-btn.is-primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; font-weight: 600; }
.sn-btn.is-primary:hover { opacity: 0.92; }
.sn-btn.is-danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l1)); }
.sn-btn.is-danger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.sn-btn.is-quiet { border-color: transparent; color: var(--dsw-alias-label-secondary); }
.sn-btn:disabled { opacity: 0.5; cursor: default; }
.sn-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); cursor: pointer; user-select: none; }
.sn-toggle input { accent-color: var(--dsw-alias-state-success-primary); }
.sn-preset { height: 27px; padding: 0 9px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.sn-preset:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.sn-help-section { margin-top: 16px; }
.sn-help-title { font-size: 12px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.sn-help-row { display: flex; align-items: baseline; gap: 12px; padding: 7px 0; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 65%, transparent); font-size: 13px; }
.sn-help-row:last-child { border-bottom: none; }
.sn-help-row .sn-keys { flex: none; min-width: 152px; display: flex; gap: 4px; flex-wrap: wrap; }
.sn-help-row .sn-help-desc { color: var(--dsw-alias-label-secondary); line-height: 1.45; }
.sn-kbd { display: inline-flex; align-items: center; height: 21px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; white-space: nowrap; }
.sn-lightbox { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center; padding: 28px; background: rgba(0,0,0,0.84); cursor: zoom-out; }
.sn-lightbox img { max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.sn-lightbox-close { position: absolute; top: 16px; right: 18px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.25); background: rgba(0,0,0,0.35); color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }

@media (max-width: 720px) {
  .sn-page { padding: 16px 14px 70px; }
  .sn-title { font-size: 20px; }
  .sn-head { flex-direction: column; gap: 10px; }
  .sn-head-actions { align-self: flex-start; }
  .sn-wall { columns: 1; }
  .sn-search { max-width: none; }
  .sn-new-btn { margin-left: 0; }
  .sn-quick-hint { display: none; }
  .sn-dialog { padding: 14px; }
  .sn-help-row { flex-direction: column; gap: 4px; }
  .sn-help-row .sn-keys { min-width: 0; }
}
@media (min-width: 721px) and (max-width: 1050px) {
  .sn-wall { columns: 2; }
}
`

    function subscribeLocale(callback) {
      try {
        return runtime.ctx.locale.subscribe(callback)
      } catch {
        return () => {}
      }
    }

    function getLocaleId() {
      return activeLocale()
    }

    function useLocaleTick() {
      return useSyncExternalStore(subscribeLocale, getLocaleId)
    }

    function autoGrow(element) {
      if (element === null || element === undefined) return
      element.style.height = 'auto'
      element.style.height = `${Math.min(element.scrollHeight, 200)}px`
    }

    /**
     * Give a panel page its own bounded scrollport.
     *
     * The main column does not always hand a slot a definite height, so
     * `height: 100%` can collapse to `auto`; the page then grows past the
     * column, gets clipped by an ancestor with `overflow: hidden`, and the
     * last rows become unreachable. Measuring the space between the page's top
     * edge and the viewport bottom and applying it as `max-height` keeps the
     * scrollbar (and every note) within reach.
     */
    function useScrollFit(ref) {
      useEffect(() => {
        const element = ref.current
        if (element === null || element === undefined) return undefined
        /** The visible bottom edge: the nearest clipping ancestor, or the viewport. */
        const bottomLimit = rect => {
          let limit = window.innerHeight
          let node = element.parentElement
          while (node !== null && node !== document.body && node !== document.documentElement) {
            const style = window.getComputedStyle(node)
            const clips = style.overflowY !== 'visible' || style.overflowX !== 'visible'
            if (clips) {
              const box = node.getBoundingClientRect()
              const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
              if (box.height > 0) limit = Math.min(limit, box.bottom - paddingBottom)
              break
            }
            node = node.parentElement
          }
          return limit
        }
        const fit = () => {
          if (!element.isConnected) return
          const rect = element.getBoundingClientRect()
          const available = bottomLimit(rect) - rect.top - 4
          element.style.maxHeight = `${Math.max(240, Math.round(available))}px`
        }
        fit()
        let frame = 0
        const schedule = () => {
          if (frame !== 0) return
          frame = window.requestAnimationFrame(() => {
            frame = 0
            fit()
          })
        }
        window.addEventListener('resize', schedule)
        const settle = window.setTimeout(schedule, 260)
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
        observer?.observe(document.documentElement)
        return () => {
          window.clearTimeout(settle)
          window.removeEventListener('resize', schedule)
          if (frame !== 0) window.cancelAnimationFrame(frame)
          observer?.disconnect()
        }
      }, [ref])
    }

    // ---------------------------------------------------------------------
    // Quick capture
    // ---------------------------------------------------------------------

    function QuickCapture({ onSaved }) {
      useLocaleTick()
      const [text, setText] = useState('')
      const [expanded, setExpanded] = useState(false)
      const [images, setImages] = useState([])
      const [dueInput, setDueInput] = useState('')
      const [color, setColor] = useState(() => snapshot.prefs.appearance.accent)
      const textareaRef = useRef(null)
      const fileRef = useRef(null)
      const drop = useImageDrop(image => setImages(list => [...list, image]))

      const canSave = text.trim().length > 0 || images.length > 0 || dueInput.length > 0

      const save = () => {
        if (drop.pending > 0) return
        if (!canSave) {
          setExpanded(true)
          textareaRef.current?.focus()
          return
        }
        const note = createNote({
          text,
          color,
          dueAt: fromLocalInput(dueInput),
          images,
        })
        setText('')
        setImages([])
        setDueInput('')
        setColor(snapshot.prefs.appearance.accent)
        setExpanded(false)
        if (textareaRef.current !== null) textareaRef.current.style.height = 'auto'
        onSaved?.(note)
      }

      const onKeyDown = event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          save()
        } else if (event.key === 'Escape') {
          event.stopPropagation()
          setExpanded(false)
          textareaRef.current?.blur()
        }
      }

      return h(
        'div',
        {
          className: 'sn-quick',
          onDragOver: event => {
            if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
          },
          onDrop: event => {
            drop.onDrop(event)
            setExpanded(true)
          },
        },
        h('textarea', {
          ref: textareaRef,
          value: text,
          rows: 1,
          placeholder: tr('quickPlaceholder'),
          'aria-label': tr('quickPlaceholder'),
          onFocus: () => setExpanded(true),
          onChange: event => {
            setText(event.target.value)
            autoGrow(event.target)
          },
          onKeyDown,
          onPaste: event => {
            drop.onPaste(event)
            setExpanded(true)
          },
        }),
        images.length > 0
          ? h(
              'div',
              { className: 'sn-attach-list' },
              images.map((image, index) =>
                h(
                  'div',
                  { key: `${image.file}-${index}`, className: 'sn-attach' },
                  h('img', { src: imageSrc(image), alt: tr('imageAlt') }),
                  h(
                    'button',
                    {
                      className: 'sn-attach-remove',
                      title: tr('removeImage'),
                      'aria-label': tr('removeImage'),
                      onClick: () => setImages(list => list.filter((_, position) => position !== index)),
                    },
                    h(CloseIcon, { size: 10 }),
                  ),
                ),
              ),
            )
          : null,
        drop.pending > 0 ? h('div', { className: 'sn-hint-text' }, tr('uploading')) : null,
        drop.error !== null ? h('div', { className: 'sn-error-text' }, `${tr('imageFailed')}: ${drop.error}`) : null,
        expanded || canSave
          ? h(
              'div',
              { className: 'sn-quick-row' },
              h(
                'button',
                {
                  className: 'sn-icon-btn',
                  title: tr('addImage'),
                  'aria-label': tr('addImage'),
                  onClick: () => fileRef.current?.click(),
                },
                h(PaperclipIcon, { size: 15 }),
              ),
              h('input', {
                ref: fileRef,
                type: 'file',
                accept: 'image/*',
                multiple: true,
                style: { display: 'none' },
                onChange: event => {
                  void drop.addFiles(event.target.files)
                  event.target.value = ''
                },
              }),
              h(
                'button',
                {
                  className: 'sn-preset',
                  onClick: () => {
                    setDueInput(presetInHour())
                    setExpanded(true)
                  },
                },
                tr('dueInOneHour'),
              ),
              h(
                'button',
                {
                  className: 'sn-preset',
                  onClick: () => {
                    setDueInput(presetTomorrowMorning())
                    setExpanded(true)
                  },
                },
                tr('dueTomorrowMorning'),
              ),
              dueInput
                ? h(
                    'button',
                    {
                      className: 'sn-preset',
                      title: tr('clearDue'),
                      onClick: () => setDueInput(''),
                    },
                    `${tr('due')}: ${formatDue(fromLocalInput(dueInput))} ×`,
                  )
                : null,
              h(
                'div',
                { className: 'sn-color-row' },
                COLORS.map(name =>
                  h('button', {
                    key: name,
                    className: `sn-swatch sn-color-${name}${color === name ? ' is-active' : ''}`,
                    title: tr(`color${name[0].toUpperCase()}${name.slice(1)}`),
                    'aria-label': tr(`color${name[0].toUpperCase()}${name.slice(1)}`),
                    'aria-pressed': color === name,
                    onClick: () => setColor(name),
                  }),
                ),
              ),
              h(
                'button',
                {
                  className: 'sn-btn is-primary',
                  disabled: !canSave || drop.pending > 0,
                  onClick: save,
                },
                tr('quickSave'),
              ),
              h('span', { className: 'sn-quick-hint' }, tr('quickHint')),
            )
          : null,
      )
    }

    // ---------------------------------------------------------------------
    // Editor
    // ---------------------------------------------------------------------

    function NoteEditor({ note, initial, onClose }) {
      useLocaleTick()
      const editing = note !== null && note !== undefined
      const [text, setText] = useState(() => (editing ? note.text : (initial?.text ?? '')))
      const [images, setImages] = useState(() => (editing ? note.images : (initial?.images ?? [])))
      const [color, setColor] = useState(() => (editing ? note.color : snapshot.prefs.appearance.accent))
      const [dueInput, setDueInput] = useState(() =>
        editing ? toLocalInput(note.dueAt) : initial?.dueAt ? toLocalInput(initial.dueAt) : '',
      )
      const [done, setDone] = useState(() => (editing ? note.done : false))
      const [keepPinned, setKeepPinned] = useState(() => (editing ? snapshot.float.ids.includes(note.id) : false))
      const [confirmDelete, setConfirmDelete] = useState(false)
      const textRef = useRef(null)
      const fileRef = useRef(null)
      const deleteTimer = useRef(null)
      const drop = useImageDrop(image => setImages(list => [...list, image]))

      useEffect(() => {
        const element = textRef.current
        if (element !== null) {
          element.focus()
          try {
            element.setSelectionRange(element.value.length, element.value.length)
          } catch {
            // ignore
          }
        }
        return () => {
          if (deleteTimer.current !== null) clearTimeout(deleteTimer.current)
        }
      }, [])

      const commit = () => {
        if (drop.pending > 0) return
        const dueAt = fromLocalInput(dueInput)
        if (editing) {
          const changed =
            text !== note.text ||
            color !== note.color ||
            (dueAt ?? null) !== (note.dueAt ?? null) ||
            done !== note.done ||
            images.length !== note.images.length ||
            images.some((image, index) => image.file !== note.images[index]?.file)
          if (!changed) {
            onClose()
            return
          }
          const patch = { text, color, dueAt, done, images }
          if ((dueAt ?? null) !== (note.dueAt ?? null)) patch.remindedAt = null
          updateNote(note.id, patch)
          applyPin(note.id)
        } else if (text.trim().length > 0 || images.length > 0 || dueAt !== null) {
          const created = createNote({ text, color, dueAt, done, images })
          applyPin(created.id)
        }
        onClose()
      }

      function applyPin(id) {
        if (keepPinned) pinNote(id)
        else unpinNote(id)
      }

      const onKeyDown = event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          commit()
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          commit()
        }
      }

      const requestDelete = () => {
        if (!editing) return
        if (!confirmDelete) {
          setConfirmDelete(true)
          if (deleteTimer.current !== null) clearTimeout(deleteTimer.current)
          deleteTimer.current = setTimeout(() => setConfirmDelete(false), 3200)
          return
        }
        removeNote(note.id)
        onClose()
      }

      return h(
        'div',
        {
          className: 'sn-overlay',
          onPointerDown: event => {
            if (event.target === event.currentTarget) commit()
          },
          onKeyDown,
          onDragOver: event => {
            if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
          },
          onDrop: drop.onDrop,
          onPaste: drop.onPaste,
        },
        h(
          'div',
          {
            className: 'sn-dialog',
            role: 'dialog',
            'aria-modal': true,
            'aria-label': editing ? tr('editorEdit') : tr('editorNew'),
          },
          h(
            'div',
            { className: 'sn-dialog-head' },
            h('span', { className: 'sn-title-mark' }, h(StickyMark, { size: 20 })),
            h('div', { className: 'sn-dialog-title' }, editing ? tr('editorEdit') : tr('editorNew')),
            h(
              'button',
              { className: 'sn-icon-btn', title: tr('close'), 'aria-label': tr('close'), onClick: commit },
              h(CloseIcon, { size: 14 }),
            ),
          ),
          h('textarea', {
            ref: textRef,
            value: text,
            placeholder: tr('notePlaceholder'),
            onChange: event => setText(event.target.value),
          }),
          images.length > 0
            ? h(
                'div',
                { className: 'sn-attach-list' },
                images.map((image, index) =>
                  h(
                    'div',
                    { key: `${image.file}-${index}`, className: 'sn-attach' },
                    h('img', { src: imageSrc(image), alt: tr('imageAlt') }),
                    h(
                      'button',
                      {
                        className: 'sn-attach-remove',
                        title: tr('removeImage'),
                        'aria-label': tr('removeImage'),
                        onClick: () => setImages(list => list.filter((_, position) => position !== index)),
                      },
                      h(CloseIcon, { size: 10 }),
                    ),
                  ),
                ),
              )
            : null,
          drop.pending > 0 ? h('div', { className: 'sn-hint-text' }, tr('uploading')) : null,
          drop.error !== null ? h('div', { className: 'sn-error-text' }, `${tr('imageFailed')}: ${drop.error}`) : null,
          h(
            'div',
            { className: 'sn-field-row' },
            h('span', { className: 'sn-label' }, tr('due')),
            h('input', {
              className: 'sn-input',
              type: 'datetime-local',
              value: dueInput,
              onChange: event => setDueInput(event.target.value),
            }),
            h(
              'button',
              {
                className: 'sn-preset',
                onClick: () => setDueInput(presetInHour()),
              },
              tr('dueInOneHour'),
            ),
            h(
              'button',
              {
                className: 'sn-preset',
                onClick: () => setDueInput(presetTomorrowMorning()),
              },
              tr('dueTomorrowMorning'),
            ),
            dueInput
              ? h(
                  'button',
                  { className: 'sn-preset', onClick: () => setDueInput('') },
                  tr('clearDue'),
                )
              : null,
          ),
          h(
            'div',
            { className: 'sn-field-row' },
            h('span', { className: 'sn-label' }, tr('color')),
            h(
              'div',
              { className: 'sn-color-row' },
              COLORS.map(name =>
                h('button', {
                  key: name,
                  className: `sn-swatch sn-color-${name}${color === name ? ' is-active' : ''}`,
                  title: tr(`color${name[0].toUpperCase()}${name.slice(1)}`),
                  'aria-label': tr(`color${name[0].toUpperCase()}${name.slice(1)}`),
                  'aria-pressed': color === name,
                  onClick: () => setColor(name),
                }),
              ),
            ),
            editing
              ? h(
                  'label',
                  { className: 'sn-toggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: done,
                    onChange: event => setDone(event.target.checked),
                  }),
                  tr('doneLabel'),
                )
              : null,
            h(
              'label',
              { className: 'sn-toggle' },
              h('input', {
                type: 'checkbox',
                checked: keepPinned,
                onChange: event => setKeepPinned(event.target.checked),
              }),
              tr('pinInEditor'),
            ),
          ),
          h(
            'div',
            { className: 'sn-field-row' },
            h(
              'button',
              {
                className: 'sn-btn',
                onClick: () => fileRef.current?.click(),
              },
              h(PaperclipIcon, { size: 14 }),
              tr('addImage'),
            ),
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'image/*',
              multiple: true,
              style: { display: 'none' },
              onChange: event => {
                void drop.addFiles(event.target.files)
                event.target.value = ''
              },
            }),
            h('span', { className: 'sn-drop-hint', style: { marginTop: 0, border: 'none', padding: 0 } }, tr('pasteHint')),
          ),
          h(
            'div',
            { className: 'sn-dialog-foot' },
            editing
              ? h(
                  'button',
                  { className: 'sn-btn is-danger', onClick: requestDelete },
                  h(TrashIcon, { size: 14 }),
                  confirmDelete ? tr('confirmDelete') : tr('deleteNote'),
                )
              : null,
            h('span', { className: 'sn-hint-text' }, tr('escSaves')),
            h('button', { className: 'sn-btn is-primary', disabled: drop.pending > 0, onClick: commit }, tr('save')),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Card
    // ---------------------------------------------------------------------

    function dueChipClass(note) {
      const dueTime = parseTime(note.dueAt)
      if (dueTime === null) return ''
      if (!note.done && dueTime < Date.now()) return ' is-overdue'
      if (!note.done && startOfDay(dueTime) === startOfDay(Date.now())) return ' is-soon'
      return ''
    }

    function NoteCard({
      note,
      pinned,
      manual = false,
      dragging = false,
      onEdit,
      onToggle,
      onPreview,
      onPin,
      onDragStartNote,
      onDropNote,
      onDragEndNote,
    }) {
      const images = note.images
      const visible = images.slice(0, 4)
      const extra = images.length - visible.length
      return h(
        'article',
        {
          id: `sn-note-${note.id}`,
          className: `sn-card sn-color-${note.color}${note.done ? ' is-done' : ''}${!note.done && parseTime(note.dueAt) !== null && parseTime(note.dueAt) < Date.now() ? ' is-overdue' : ''}${dragging ? ' is-dragging' : ''}${manual ? ' is-manual' : ''}`,
          tabIndex: 0,
          role: 'button',
          draggable: manual,
          'aria-label': note.text.trim().length > 0 ? note.text.trim().slice(0, 80) : tr('emptyNote'),
          onClick: () => onEdit(note),
          onDragStart: event => {
            if (!manual) return
            try {
              event.dataTransfer?.setData('text/plain', note.id)
            } catch {
              // draggable data is best effort
            }
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
            onDragStartNote?.(note.id)
          },
          onDragOver: event => {
            if (!manual) return
            event.preventDefault()
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
          },
          onDrop: event => {
            if (!manual) return
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            onDropNote?.(note.id, event.clientY > rect.top + rect.height / 2)
          },
          onDragEnd: () => onDragEndNote?.(),
          onKeyDown: event => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onEdit(note)
            }
          },
        },
        h(
          'div',
          { className: 'sn-card-top' },
          h(
            'button',
            {
              className: `sn-check${note.done ? ' is-on' : ''}`,
              title: note.done ? tr('markUndone') : tr('markDone'),
              'aria-label': note.done ? tr('markUndone') : tr('markDone'),
              'aria-pressed': note.done,
              onClick: event => {
                event.stopPropagation()
                onToggle(note)
              },
            },
            note.done ? h(CheckIcon, { size: 13 }) : null,
          ),
          h('span', { className: 'sn-card-spacer' }),
          h(
            'button',
            {
              className: `sn-card-edit sn-card-pin${pinned ? ' is-on' : ''}`,
              title: pinned ? tr('unpin') : tr('pinToFloat'),
              'aria-label': pinned ? tr('unpin') : tr('pinToFloat'),
              'aria-pressed': pinned,
              onClick: event => {
                event.stopPropagation()
                onPin(note)
              },
            },
            h(PinIcon, { size: 14 }),
          ),
          h(
            'button',
            {
              className: 'sn-card-edit',
              title: tr('editNote'),
              'aria-label': tr('editNote'),
              onClick: event => {
                event.stopPropagation()
                onEdit(note)
              },
            },
            h(PencilIcon, { size: 14 }),
          ),
        ),
        visible.length > 0
          ? h(
              'div',
              { className: `sn-img-grid${visible.length === 1 ? ' is-one' : ''}` },
              visible.map((image, index) =>
                h(
                  'div',
                  {
                    key: `${image.file}-${index}`,
                    className: 'sn-thumb',
                    onClick: event => {
                      event.stopPropagation()
                      onPreview(image)
                    },
                  },
                  h('img', { src: imageSrc(image), alt: tr('imageAlt'), loading: 'lazy' }),
                  extra > 0 && index === visible.length - 1
                    ? h('div', { className: 'sn-thumb-more' }, `+${extra}`)
                    : null,
                ),
              ),
            )
          : null,
        h(
          'p',
          { className: `sn-text${note.text.trim().length === 0 ? ' is-empty' : ''}` },
          note.text.trim().length > 0 ? note.text : tr('emptyNote'),
        ),
        h(
          'div',
          { className: 'sn-card-foot' },
          note.dueAt
            ? h(
                'span',
                { className: `sn-chip${dueChipClass(note)}` },
                h(ClockIcon, { size: 11 }),
                formatDue(note.dueAt, note.done),
              )
            : null,
          note.done
            ? h('span', { className: 'sn-chip is-done' }, h(CheckIcon, { size: 10 }), tr('doneLabel'))
            : null,
          pinned ? h('span', { className: 'sn-chip' }, h(PinIcon, { size: 10 }), tr('pin')) : null,
          images.length > 0
            ? h('span', { className: 'sn-chip' }, h(ImageIcon, { size: 10 }), tr('attachments', { n: images.length }))
            : null,
          h('span', { className: 'sn-time' }, relativeTime(note.updatedAt)),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Help sheet
    // ---------------------------------------------------------------------

    function Key({ children }) {
      return h('kbd', { className: 'sn-kbd' }, children)
    }

    function ShortcutHelp({ onClose }) {
      useLocaleTick()
      const rows = [
        { keys: [h(Key, { key: 'a' }, 'Ctrl/Cmd'), h(Key, { key: 'b' }, 'Shift'), h(Key, { key: 'c' }, 'N')], text: tr('helpNewGlobal') },
        { keys: [h(Key, { key: 'a' }, 'Ctrl/Cmd'), h(Key, { key: 'b' }, 'Shift'), h(Key, { key: 'c' }, 'P')], text: tr('helpFloat') },
        { keys: [h(Key, { key: 'a' }, 'N')], text: tr('helpNewLocal') },
        { keys: [h(Key, { key: 'a' }, 'Ctrl/Cmd'), h(Key, { key: 'b' }, 'Enter')], text: tr('helpSave') },
        { keys: [h(Key, { key: 'a' }, 'Esc')], text: tr('helpEsc') },
        { keys: [h(Key, { key: 'a' }, '/')], text: tr('helpSearch') },
        { keys: [h(Key, { key: 'a' }, '?')], text: tr('helpHelp') },
      ]
      const tips = [tr('helpPaste'), tr('helpDrop'), tr('helpClick'), tr('helpPin'), tr('helpNotify')]
      return h(
        'div',
        {
          className: 'sn-overlay',
          onClick: event => {
            if (event.target === event.currentTarget) onClose()
          },
          onKeyDown: event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
          },
        },
        h(
          'div',
          { className: 'sn-dialog is-help', role: 'dialog', 'aria-modal': true, 'aria-label': tr('helpTitle') },
          h(
            'div',
            { className: 'sn-dialog-head' },
            h(KeyboardIcon, { size: 17 }),
            h('div', { className: 'sn-dialog-title' }, tr('helpTitle')),
            h(
              'button',
              { className: 'sn-icon-btn', title: tr('close'), 'aria-label': tr('close'), onClick: onClose },
              h(CloseIcon, { size: 14 }),
            ),
          ),
          h(
            'div',
            { className: 'sn-help-section' },
            h('div', { className: 'sn-help-title' }, tr('shortcutKey')),
            rows.map((row, index) =>
              h(
                'div',
                { key: index, className: 'sn-help-row' },
                h('span', { className: 'sn-keys' }, row.keys),
                h('span', { className: 'sn-help-desc' }, row.text),
              ),
            ),
          ),
          h(
            'div',
            { className: 'sn-help-section' },
            h('div', { className: 'sn-help-title' }, tr('helpTips')),
            tips.map((tip, index) =>
              h('div', { key: index, className: 'sn-help-row' }, h('span', { className: 'sn-help-desc' }, tip)),
            ),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Settings section
    // ---------------------------------------------------------------------

    const SETTINGS_CSS = `
.sn-settings { height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; padding: var(--sn-pad, 20px 24px 64px); color: var(--dsw-alias-label-primary); font-size: var(--sn-font-size, 14px); font-family: var(--sn-font-family, inherit); }
.sn-set-inner { max-width: 760px; margin: 0 auto; }
.sn-set-head { margin-bottom: 4px; }
.sn-set-head-title { display: flex; align-items: center; gap: 9px; font-size: 20px; font-weight: 650; line-height: 1.2; }
.sn-set-head-mark { display: inline-flex; color: var(--dsw-alias-state-warn-primary); }
.sn-set-sub { margin-top: 5px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.sn-set-group { margin-top: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--sn-radius, 12px); background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.sn-set-group-title { padding: 8px 13px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); font-size: 11.5px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.sn-set-row { display: flex; align-items: center; gap: 14px; padding: 10px 13px; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent); }
.sn-set-row:last-child { border-bottom: none; }
.sn-set-row.is-stacked { flex-direction: column; align-items: stretch; gap: 8px; }
.sn-set-label { flex: 1; min-width: 0; font-size: 13px; }
.sn-set-hint { margin-top: 3px; font-size: 11.5px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }
.sn-set-control { flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.sn-seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); }
.sn-seg-btn { border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; height: 26px; padding: 0 9px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
.sn-seg-btn:hover { color: var(--dsw-alias-label-primary); }
.sn-seg-btn.is-active { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
.sn-range { display: inline-flex; align-items: center; gap: 9px; }
.sn-range input { width: 138px; accent-color: var(--dsw-alias-brand-primary); }
.sn-range-value { min-width: 44px; text-align: right; font-size: 11.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.sn-select { height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
.sn-switch { position: relative; display: inline-block; width: 38px; height: 22px; flex: none; }
.sn-switch input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
.sn-switch-track { position: absolute; inset: 0; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); transition: background 130ms ease; pointer-events: none; }
.sn-switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-label-secondary); transition: transform 130ms ease, background 130ms ease; }
.sn-switch input:checked + .sn-switch-track { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 72%, transparent); border-color: transparent; }
.sn-switch input:checked + .sn-switch-track::after { transform: translateX(16px); background: #fff; }
.sn-switch input:disabled + .sn-switch-track { opacity: 0.42; }
.sn-preview { --sn-tint: var(--dsw-alias-state-warn-primary); width: 232px; padding: 11px 12px; border-radius: var(--sn-radius, 12px); border: 1px solid var(--sn-card-border, var(--dsw-alias-border-l1)); background: var(--sn-card-bg, var(--dsw-alias-bg-layer-1)); color: var(--sn-card-fg, var(--dsw-alias-label-primary)); }
.sn-preview-text { font-size: calc(var(--sn-font-size, 14px) - 0.5px); line-height: var(--sn-line-height, 1.5); white-space: pre-wrap; overflow-wrap: anywhere; }
.sn-preview-meta { display: flex; align-items: center; gap: 6px; margin-top: 9px; font-size: 11px; color: var(--sn-muted, var(--dsw-alias-label-secondary)); }
.sn-set-note { font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.sn-set-error { font-size: 11.5px; color: var(--dsw-alias-state-error-primary); }
.sn-set-ok { font-size: 11.5px; color: var(--dsw-alias-state-success-primary); }
.sn-settings .sn-color-row { display: flex; align-items: center; gap: 7px; }
.sn-settings .sn-swatch { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid transparent; background: var(--sn-tint); cursor: pointer; box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 12%, transparent); }
.sn-settings .sn-swatch.is-active { border-color: var(--dsw-alias-label-primary); }
.sn-settings .sn-btn { height: 28px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.sn-settings .sn-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.sn-settings .sn-btn.is-on { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1)); color: var(--dsw-alias-brand-primary); }
`

    function Segmented({ value, options, onChange }) {
      return h(
        'div',
        { className: 'sn-seg', role: 'group' },
        options.map(option =>
          h(
            'button',
            {
              key: option.value,
              className: `sn-seg-btn${value === option.value ? ' is-active' : ''}`,
              'aria-pressed': value === option.value,
              onClick: () => onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    function RangeControl({ value, min, max, step = 1, unit = '', onChange }) {
      return h(
        'div',
        { className: 'sn-range' },
        h('input', {
          type: 'range',
          min,
          max,
          step,
          value,
          onChange: event => onChange(Number(event.target.value)),
        }),
        h('span', { className: 'sn-range-value' }, `${value}${unit}`),
      )
    }

    function Toggle({ checked, disabled = false, onChange }) {
      return h(
        'label',
        { className: 'sn-switch' },
        h('input', {
          type: 'checkbox',
          checked,
          disabled,
          onChange: event => onChange(event.target.checked),
        }),
        h('span', { className: 'sn-switch-track' }),
      )
    }

    function SettingsGroup({ title, children }) {
      return h(
        'section',
        { className: 'sn-set-group' },
        h('div', { className: 'sn-set-group-title' }, title),
        children,
      )
    }

    function SettingsRow({ label, hint, stacked = false, children }) {
      return h(
        'div',
        { className: `sn-set-row${stacked ? ' is-stacked' : ''}` },
        h(
          'div',
          { className: 'sn-set-label' },
          label,
          hint !== undefined && hint !== null ? h('div', { className: 'sn-set-hint' }, hint) : null,
        ),
        children === undefined ? null : h('div', { className: 'sn-set-control' }, children),
      )
    }

    function StickySettings() {
      useLocaleTick()
      const state = useSyncExternalStore(subscribe, getSnapshot)
      const prefs = state.prefs
      const appearance = prefs.appearance
      const float = prefs.float
      const autostart = state.autostart
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [flash, setFlash] = useState(false)
      const settingsRef = useRef(null)
      useScrollFit(settingsRef)

      const setAppearance = patch => patchPrefs({ appearance: patch })
      const setFloatPrefs = patch => patchPrefs({ float: patch })

      const autostartHint =
        autostart === null
          ? tr('loading')
          : !autostart.supported
            ? autostart.reason === 'platform'
              ? tr('autostartUnsupportedPlatform')
              : tr('autostartUnsupportedHost')
            : autostart.enabled
              ? tr('autostartOn')
              : tr('autostartOff')

      const toggleAutostart = async next => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
          await setAutostart(next)
          setFlash(true)
          window.setTimeout(() => setFlash(false), 1600)
        } catch (cause) {
          setError(`${tr('autostartFailed')}: ${String(cause?.message ?? cause)}`)
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        {
          className: `sn-settings ${appearanceClass(prefs)}`,
          style: appearanceVars(prefs),
          ref: settingsRef,
        },
        h('style', null, THEME_CSS),
        h('style', null, SETTINGS_CSS),
        h(
          'div',
          { className: 'sn-set-inner' },
          h(
            'div',
            { className: 'sn-set-head' },
            h(
              'div',
              { className: 'sn-set-head-title' },
              h('span', { className: 'sn-set-head-mark' }, h(StickyMark, { size: 22 })),
              tr('settingsTitle'),
            ),
            h('div', { className: 'sn-set-sub' }, tr('settingsSub')),
          ),
          h(
            SettingsGroup,
            { title: tr('secAppearance') },
            h(
              SettingsRow,
              { label: tr('schemeLabel') },
              h(Segmented, {
                value: appearance.scheme,
                options: [
                  { value: 'auto', label: tr('schemeAuto') },
                  { value: 'light', label: tr('schemeLight') },
                  { value: 'dark', label: tr('schemeDark') },
                ],
                onChange: value => setAppearance({ scheme: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('surfaceLabel') },
              h(Segmented, {
                value: appearance.surface,
                options: [
                  { value: 'auto', label: tr('surfaceAuto') },
                  { value: 'solid', label: tr('surfaceSolid') },
                  { value: 'glass', label: tr('surfaceGlass') },
                ],
                onChange: value => setAppearance({ surface: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('contrastLabel') },
              h(Segmented, {
                value: appearance.contrast,
                options: [
                  { value: 'normal', label: tr('contrastNormal') },
                  { value: 'high', label: tr('contrastHigh') },
                ],
                onChange: value => setAppearance({ contrast: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('accentLabel') },
              h(
                'div',
                { className: 'sn-color-row' },
                COLORS.map(name =>
                  h('button', {
                    key: name,
                    className: `sn-swatch sn-color-${name}${appearance.accent === name ? ' is-active' : ''}`,
                    title: tr(`color${name[0].toUpperCase()}${name.slice(1)}`),
                    'aria-label': tr(`color${name[0].toUpperCase()}${name.slice(1)}`),
                    'aria-pressed': appearance.accent === name,
                    onClick: () => setAppearance({ accent: name }),
                  }),
                ),
              ),
            ),
            h(
              SettingsRow,
              { label: tr('fontLabel') },
              h(
                'select',
                {
                  className: 'sn-select',
                  value: appearance.fontFamily,
                  onChange: event => setAppearance({ fontFamily: event.target.value }),
                },
                [
                  ['system', tr('fontSystem')],
                  ['sans', tr('fontSans')],
                  ['serif', tr('fontSerif')],
                  ['mono', tr('fontMono')],
                  ['rounded', tr('fontRounded')],
                ].map(([value, label]) => h('option', { key: value, value }, label)),
              ),
            ),
            h(
              SettingsRow,
              { label: tr('fontSizeLabel') },
              h(RangeControl, {
                value: appearance.fontSize,
                min: 12,
                max: 20,
                unit: 'px',
                onChange: value => setAppearance({ fontSize: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('lineHeightLabel') },
              h(RangeControl, {
                value: appearance.lineHeight,
                min: 1.25,
                max: 1.9,
                step: 0.05,
                onChange: value => setAppearance({ lineHeight: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('radiusLabel') },
              h(RangeControl, {
                value: appearance.radius,
                min: 6,
                max: 22,
                unit: 'px',
                onChange: value => setAppearance({ radius: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('densityLabel') },
              h(Segmented, {
                value: appearance.density,
                options: [
                  { value: 'cozy', label: tr('densityCozy') },
                  { value: 'compact', label: tr('densityCompact') },
                ],
                onChange: value => setAppearance({ density: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('previewLabel'), stacked: true },
              h(
                'div',
                { className: 'sn-preview-wrap' },
                h(
                  'div',
                  { className: `sn-preview sn-color-${appearance.accent}` },
                  h('div', { className: 'sn-preview-text' }, tr('previewText')),
                  h(
                    'div',
                    { className: 'sn-preview-meta' },
                    h(ClockIcon, { size: 11 }),
                    tr('today'),
                    ' 18:00 · ',
                    tr('pin'),
                  ),
                ),
              ),
            ),
          ),
          h(
            SettingsGroup,
            { title: tr('secFloat') },
            h(
              SettingsRow,
              { label: tr('floatWidthLabel') },
              h(RangeControl, {
                value: float.width,
                min: 260,
                max: 460,
                step: 4,
                unit: 'px',
                onChange: value => setFloatPrefs({ width: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('floatOpacityLabel') },
              h(RangeControl, {
                value: Math.round(float.opacity * 100),
                min: 60,
                max: 100,
                unit: '%',
                onChange: value => setFloatPrefs({ opacity: value / 100 }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('floatLockLabel') },
              h(Toggle, {
                checked: float.locked,
                onChange: value => setFloatPrefs({ locked: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('floatAutoOpenLabel') },
              h(Toggle, {
                checked: float.autoOpen,
                onChange: value => setFloatPrefs({ autoOpen: value }),
              }),
            ),
            h(
              SettingsRow,
              { label: tr('floatToggle') },
              h(
                'button',
                { className: `sn-btn${state.float.visible ? ' is-on' : ''}`, onClick: () => toggleFloat() },
                h(PinIcon, { size: 13 }),
                state.float.visible ? tr('floatHide') : tr('floatToggle'),
              ),
            ),
            h(
              SettingsRow,
              { label: tr('floatDesktopLabel'), hint: tr('floatDesktopBody') },
              h('span', { className: 'sn-set-note' }, tr('notSupported')),
            ),
          ),
          h(
            SettingsGroup,
            { title: tr('secDesktop') },
            h(
              SettingsRow,
              { label: tr('desktopWidgetLabel'), hint: state.desktop.running ? tr('desktopRunning') : tr('desktopWidgetBody') },
              h(
                'button',
                {
                  className: `sn-btn${state.desktop.running ? ' is-on' : ''}`,
                  disabled: state.desktop.supported === false || state.desktop.busy,
                  onClick: () => void toggleDesktop(),
                },
                h(DesktopIcon, { size: 13 }),
                state.desktop.busy
                  ? tr('desktopCompiling')
                  : state.desktop.running
                    ? tr('desktopStop')
                    : state.desktop.supported === false
                      ? tr('desktopUnsupported')
                      : tr('desktopStart'),
              ),
            ),
            state.desktop.error !== null
              ? h(SettingsRow, { label: '' }, h('span', { className: 'sn-set-error' }, state.desktop.error))
              : null,
            h(
              SettingsRow,
              { label: tr('autostartLabel'), hint: autostartHint },
              h(Toggle, {
                checked: autostart?.enabled === true,
                disabled: autostart === null || !autostart.supported || busy,
                onChange: value => void toggleAutostart(value),
              }),
            ),
            error !== null ? h(SettingsRow, { label: '' }, h('span', { className: 'sn-set-error' }, error)) : null,
            flash ? h(SettingsRow, { label: '' }, h('span', { className: 'sn-set-ok' }, tr('settingsSaved'))) : null,
            h(
              SettingsRow,
              { label: tr('sortLabel') },
              h(Segmented, {
                value: prefs.sort,
                options: [
                  { value: 'auto', label: tr('sortAuto') },
                  { value: 'manual', label: tr('sortManual') },
                ],
                onChange: value => patchPrefs({ sort: value }),
              }),
            ),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------------
    // Wall page
    // ---------------------------------------------------------------------

    function StickyWallPage() {
      useLocaleTick()
      const state = useSyncExternalStore(subscribe, getSnapshot)
      const [filter, setFilter] = useState('all')
      const [query, setQuery] = useState('')
      const [editor, setEditor] = useState(null)
      const [lightbox, setLightbox] = useState(null)
      const [helpOpen, setHelpOpen] = useState(false)
      const [permission, setPermission] = useState(readNotificationPermission)
      const [flash, setFlash] = useState(null)
      const [busyText, setBusyText] = useState(null)
      const [dragId, setDragId] = useState(null)
      const searchRef = useRef(null)
      const pageRef = useRef(null)
      const flashTimer = useRef(null)
      useScrollFit(pageRef)

      const showFlash = useCallback(message => {
        setFlash(message)
        if (flashTimer.current !== null) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlash(null), 2200)
      }, [])

      useEffect(() => {
        return () => {
          if (flashTimer.current !== null) clearTimeout(flashTimer.current)
        }
      }, [])

      useEffect(() => {
        setModalOpen(editor !== null || helpOpen || lightbox !== null)
      }, [editor, helpOpen, lightbox])

      useEffect(() => () => setModalOpen(false), [])

      useEffect(() => {
        if (!state.pendingNew) return
        takeNewRequest()
        setEditor({ mode: 'new' })
      }, [state.pendingNew])

      useEffect(() => {
        if (state.focusNoteId === null) return
        const noteId = state.focusNoteId
        const frame = requestAnimationFrame(() => {
          const element = document.getElementById(`sn-note-${noteId}`)
          if (element !== null) {
            element.scrollIntoView({ block: 'center', behavior: 'smooth' })
            element.classList.add('is-flash')
            setTimeout(() => element.classList.remove('is-flash'), 1400)
          }
        })
        clearFocus()
        return () => cancelAnimationFrame(frame)
      }, [state.focusNoteId])

      useEffect(() => {
        const onKeyDown = event => {
          if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
          if (isEditableTarget(event.target)) return
          if (editor !== null) return
          if (event.key === 'n' || event.key === 'N') {
            event.preventDefault()
            setEditor({ mode: 'new' })
          } else if (event.key === '?') {
            event.preventDefault()
            setHelpOpen(true)
          } else if (event.key === '/') {
            event.preventDefault()
            searchRef.current?.focus()
          } else if (event.key === 'Escape') {
            if (lightbox !== null) setLightbox(null)
            else if (helpOpen) setHelpOpen(false)
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [editor, lightbox, helpOpen])

      const activeCount = state.notes.filter(note => !note.done).length
      const dueCount = state.notes.filter(note => {
        if (note.done) return false
        const dueTime = parseTime(note.dueAt)
        return dueTime !== null && dueTime <= endOfToday()
      }).length
      const doneCount = state.notes.filter(note => note.done).length

      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        const now = Date.now()
        const rows = state.notes.filter(note => {
          if (needle.length > 0 && !note.text.toLowerCase().includes(needle)) return false
          if (filter === 'active') return !note.done
          if (filter === 'done') return note.done
          if (filter === 'due') {
            if (note.done) return false
            const dueTime = parseTime(note.dueAt)
            return dueTime !== null && dueTime <= endOfToday()
          }
          return true
        })
        if (state.prefs.sort === 'manual') return orderNotesManually(rows)
        const rank = note => {
          if (note.done) return 2
          const dueTime = parseTime(note.dueAt)
          return dueTime !== null && dueTime <= now ? 0 : 1
        }
        return [...rows].sort((left, right) => {
          const leftRank = rank(left)
          const rightRank = rank(right)
          if (leftRank !== rightRank) return leftRank - rightRank
          if (leftRank === 0) return (parseTime(left.dueAt) ?? 0) - (parseTime(right.dueAt) ?? 0)
          if (leftRank === 2) {
            return (parseTime(right.doneAt ?? right.updatedAt) ?? 0) - (parseTime(left.doneAt ?? left.updatedAt) ?? 0)
          }
          return (parseTime(right.updatedAt) ?? 0) - (parseTime(left.updatedAt) ?? 0)
        })
      }, [state.notes, query, filter, state.prefs.sort])

      const manualSort = state.prefs.sort === 'manual'
      const canDrag = manualSort && filter === 'all' && query.trim().length === 0

      const editorNote = editor !== null && editor.mode === 'edit' ? state.notes.find(note => note.id === editor.noteId) ?? null : null

      useEffect(() => {
        if (editor !== null && editor.mode === 'edit' && editorNote === null) setEditor(null)
      }, [editor, editorNote])

      const handleEnable = async () => {
        const result = await enableDesktopNotifications()
        setPermission(result)
        if (result === 'granted') showFlash(tr('desktopNotifyOn'))
      }

      const openDraftFromClipboard = async (files, text, reason) => {
        const images = []
        const failures = []
        if (files.length > 0) {
          setBusyText(reason)
          for (const file of files) {
            try {
              images.push(await uploadImageFile(file))
            } catch (error) {
              failures.push(String(error?.message ?? error))
            }
          }
          setBusyText(null)
        }
        if (failures.length > 0) showFlash(`${tr('imageFailed')}: ${failures[0]}`)
        if (images.length === 0 && text.trim().length === 0) return
        setEditor({ mode: 'new', initial: { text, images } })
      }

      const handlePagePaste = event => {
        if (isEditableTarget(event.target)) return
        if (editor !== null) return
        const clipboard = event.clipboardData
        if (clipboard === null || clipboard === undefined) return
        const files = []
        for (const item of clipboard.items ?? []) {
          if (item.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file !== null) files.push(file)
          }
        }
        const text = clipboard.getData('text/plain') ?? ''
        if (files.length === 0 && text.trim().length === 0) return
        event.preventDefault()
        void openDraftFromClipboard(files, text, tr('clipboardBusy'))
      }

      const handlePageDrop = event => {
        if (isEditableTarget(event.target)) return
        if (editor !== null) return
        const transfer = event.dataTransfer
        if (transfer === null || transfer === undefined) return
        const files = Array.from(transfer.files ?? []).filter(
          file => typeof file.type === 'string' && file.type.startsWith('image/'),
        )
        const text = transfer.getData('text/plain') ?? ''
        if (files.length === 0 && text.trim().length === 0) return
        event.preventDefault()
        void openDraftFromClipboard(files, text, tr('dropBusy'))
      }

      const filterItems = [
        { id: 'all', label: tr('filterAll'), count: state.notes.length },
        { id: 'active', label: tr('filterActive'), count: activeCount },
        { id: 'due', label: tr('filterDue'), count: dueCount },
        { id: 'done', label: tr('filterDone'), count: doneCount },
      ]

      return h(
        'div',
        {
          className: `sn-page ${appearanceClass(state.prefs)}`,
          style: appearanceVars(state.prefs),
          ref: pageRef,
          onPaste: handlePagePaste,
          onDragOver: event => {
            if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
          },
          onDrop: handlePageDrop,
        },
        h('style', null, THEME_CSS),
        h('style', null, WALL_CSS),
        h(
          'div',
          { className: 'sn-inner' },
          h(
            'div',
            { className: 'sn-head' },
            h(
              'div',
              { className: 'sn-head-main' },
              h(
                'div',
                { className: 'sn-title' },
                h('span', { className: 'sn-title-mark' }, h(StickyMark, { size: 24 })),
                tr('title'),
                state.saving
                  ? h('span', { className: 'sn-status' }, h('span', { className: 'sn-spinner' }), tr('saving'))
                  : state.saveError !== null
                    ? h('span', { className: 'sn-status is-error' }, tr('saveFailed'))
                    : state.savedAt !== null
                      ? h('span', { className: 'sn-status is-ok' }, h('span', { className: 'sn-dot' }), tr('saved'))
                      : null,
              ),
              h('div', { className: 'sn-sub' }, tr('subtitle')),
              h(
                'div',
                { className: 'sn-stats' },
                h('span', { className: 'sn-stat' }, tr('statActive'), ' ', h('strong', null, String(activeCount))),
                h(
                  'span',
                  { className: `sn-stat${dueCount > 0 ? ' is-due' : ''}` },
                  tr('statDue'),
                  ' ',
                  h('strong', null, String(dueCount)),
                ),
                h('span', { className: 'sn-stat is-done' }, tr('statDone'), ' ', h('strong', null, String(doneCount))),
              ),
            ),
            h(
              'div',
              { className: 'sn-head-actions' },
              permission === 'default'
                ? h(
                    'button',
                    { className: 'sn-btn', onClick: handleEnable },
                    h(BellIcon, { size: 14 }),
                    tr('desktopNotify'),
                  )
                : permission === 'granted'
                  ? h('span', { className: 'sn-status is-ok' }, h('span', { className: 'sn-dot' }), tr('desktopNotifyOn'))
                  : permission === 'denied'
                    ? h('span', { className: 'sn-status is-error' }, tr('desktopNotifyDenied'))
                    : h('span', { className: 'sn-status' }, tr('desktopNotifyUnsupported')),
              h(
                'button',
                {
                  className: `sn-btn${state.float.visible ? ' is-on' : ''}`,
                  title: tr('helpFloat'),
                  'aria-pressed': state.float.visible,
                  onClick: () => toggleFloat(),
                },
                h(PinIcon, { size: 14 }),
                tr('floatToggle'),
              ),
              h(
                'button',
                {
                  className: 'sn-icon-btn',
                  title: tr('shortcuts'),
                  'aria-label': tr('shortcuts'),
                  onClick: () => setHelpOpen(true),
                },
                h(KeyboardIcon, { size: 15 }),
              ),
            ),
          ),
          h(QuickCapture, { onSaved: () => showFlash(tr('savedToast')) }),
          h(
            'div',
            { className: 'sn-toolbar' },
            h(
              'div',
              { className: 'sn-search' },
              h('span', { className: 'sn-search-icon' }, h(SearchIcon, { size: 14 })),
              h('input', {
                ref: searchRef,
                value: query,
                placeholder: tr('searchPlaceholder'),
                'aria-label': tr('searchPlaceholder'),
                onChange: event => setQuery(event.target.value),
              }),
              query.length > 0
                ? h(
                    'button',
                    {
                      className: 'sn-search-clear',
                      title: tr('close'),
                      'aria-label': tr('close'),
                      onClick: () => setQuery(''),
                    },
                    h(CloseIcon, { size: 11 }),
                  )
                : null,
            ),
            h(
              'div',
              { className: 'sn-filters', role: 'tablist' },
              filterItems.map(item =>
                h(
                  'button',
                  {
                    key: item.id,
                    className: `sn-filter${filter === item.id ? ' is-active' : ''}`,
                    role: 'tab',
                    'aria-selected': filter === item.id,
                    onClick: () => setFilter(item.id),
                  },
                  item.label,
                  h('span', { className: 'sn-filter-count' }, String(item.count)),
                ),
              ),
            ),
            h(
              'button',
              { className: 'sn-new-btn', onClick: () => setEditor({ mode: 'new' }) },
              h(PlusIcon, { size: 14 }),
              tr('newNote'),
            ),
          ),
          h(
            'div',
            { className: 'sn-toolbar' },
            h(
              'div',
              { className: 'sn-filters', role: 'group', title: tr('sortLabel'), 'aria-label': tr('sortLabel') },
              h(
                'button',
                {
                  className: `sn-filter${manualSort ? '' : ' is-active'}`,
                  'aria-pressed': !manualSort,
                  onClick: () => patchPrefs({ sort: 'auto' }),
                },
                tr('sortAuto'),
              ),
              h(
                'button',
                {
                  className: `sn-filter${manualSort ? ' is-active' : ''}`,
                  'aria-pressed': manualSort,
                  onClick: () => patchPrefs({ sort: 'manual' }),
                },
                tr('sortManual'),
              ),
            ),
            manualSort
              ? h(
                  'span',
                  { className: 'sn-sort-hint' },
                  canDrag ? tr('sortManualHint') : tr('dragToSort'),
                )
              : null,
          ),
          state.saveError !== null
            ? h(
                'div',
                { className: 'sn-banner-error' },
                `${tr('saveFailed')}: ${state.saveError}`,
                h('button', { onClick: () => void persist() }, tr('retry')),
              )
            : null,
          state.error !== null && state.notes.length === 0
            ? h(
                'div',
                { className: 'sn-empty' },
                h('div', { className: 'sn-empty-title' }, tr('loadFailed')),
                h('div', { className: 'sn-empty-body' }, state.error),
                h(
                  'button',
                  { className: 'sn-btn is-primary', style: { marginTop: 14 }, onClick: () => void loadState(true) },
                  tr('retry'),
                ),
              )
            : state.status === 'loading' && state.notes.length === 0
              ? h('div', { className: 'sn-loading' }, tr('loading'))
              : filtered.length === 0
                ? h(
                    'div',
                    { className: 'sn-empty' },
                    h('div', { className: 'sn-empty-art' }, h('i'), h('i'), h('i')),
                    h(
                      'div',
                      { className: 'sn-empty-title' },
                      state.notes.length === 0 ? tr('emptyTitle') : tr('emptyFilterTitle'),
                    ),
                    h(
                      'div',
                      { className: 'sn-empty-body' },
                      state.notes.length === 0 ? tr('emptyBody') : tr('emptyFilterBody'),
                    ),
                    h(
                      'button',
                      { className: 'sn-btn is-primary', style: { marginTop: 16 }, onClick: () => setEditor({ mode: 'new' }) },
                      h(PlusIcon, { size: 14 }),
                      tr('newNote'),
                    ),
                  )
                : h(
                    'div',
                    { className: 'sn-wall' },
                    filtered.map(note =>
                      h(NoteCard, {
                        key: note.id,
                        note,
                        pinned: state.float.ids.includes(note.id),
                        manual: canDrag,
                        dragging: dragId === note.id,
                        onEdit: target => setEditor({ mode: 'edit', noteId: target.id }),
                        onToggle: target => toggleDone(target.id),
                        onPin: target => togglePin(target.id),
                        onPreview: image => setLightbox(imageSrc(image)),
                        onDragStartNote: id => setDragId(id),
                        onDropNote: (targetId, after) => {
                          if (dragId !== null) reorderNotes(dragId, targetId, after)
                          setDragId(null)
                        },
                        onDragEndNote: () => setDragId(null),
                      }),
                    ),
                  ),
        ),
        editor !== null
          ? h(NoteEditor, {
              note: editor.mode === 'edit' ? editorNote : null,
              initial: editor.mode === 'new' ? editor.initial : undefined,
              onClose: () => setEditor(null),
            })
          : null,
        helpOpen ? h(ShortcutHelp, { onClose: () => setHelpOpen(false) }) : null,
        lightbox !== null
          ? h(
              'div',
              {
                className: 'sn-lightbox',
                onClick: () => setLightbox(null),
                onKeyDown: event => {
                  if (event.key === 'Escape') setLightbox(null)
                },
              },
              h('img', {
                src: lightbox,
                alt: tr('imageAlt'),
                onClick: event => event.stopPropagation(),
              }),
              h(
                'button',
                {
                  className: 'sn-lightbox-close',
                  title: tr('close'),
                  'aria-label': tr('close'),
                  onClick: event => {
                    event.stopPropagation()
                    setLightbox(null)
                  },
                },
                h(CloseIcon, { size: 16 }),
              ),
            )
          : null,
        flash !== null ? h('div', { className: 'sn-flash' }, flash) : null,
        busyText !== null
          ? h('div', { className: 'sn-busy' }, h('span', { className: 'sn-spinner' }), busyText)
          : null,
      )
    }

    // ---------------------------------------------------------------------
    // Plugin body
    // ---------------------------------------------------------------------

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        runtime = { ctx }
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'sticky-notes: locale')

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: PANEL_ID,
                  order: 20,
                  label: () => tr('panel'),
                  locale: NS,
                },
                SidebarEntry,
              ),
            ),
          'sticky-notes: sidebar entry',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('main', () =>
              ctx.slots.register(
                {
                  name: 'main',
                  key: PANEL_ID,
                  locale: NS,
                },
                StickyWallPage,
              ),
            ),
          'sticky-notes: wall panel',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('shell.overlay', () =>
              ctx.slots.register(
                {
                  name: 'shell.overlay',
                  id: 'sticky-notes.reminders',
                  order: 860,
                  locale: NS,
                },
                ReminderToasts,
              ),
            ),
          'sticky-notes: reminder overlay',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('shell.overlay', () =>
              ctx.slots.register(
                {
                  name: 'shell.overlay',
                  id: 'sticky-notes.float',
                  order: 850,
                  locale: NS,
                },
                FloatWindow,
              ),
            ),
          'sticky-notes: pinned float',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'sticky-notes',
                  order: 30,
                  label: () => tr('settingsTitle'),
                  locale: NS,
                },
                StickySettings,
              ),
            ),
          'sticky-notes: settings section',
        )

        ctx.effect(() => {
          const onKeyDown = event => {
            if (event.repeat) return
            const mod = event.ctrlKey || event.metaKey
            if (!mod || !event.shiftKey || event.altKey) return
            const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''
            if (key === 'n' || event.code === 'KeyN') {
              event.preventDefault()
              event.stopPropagation()
              requestNewNote()
              return
            }
            if (key === 'p' || event.code === 'KeyP') {
              event.preventDefault()
              event.stopPropagation()
              toggleFloat()
            }
          }
          window.addEventListener('keydown', onKeyDown, true)
          return () => window.removeEventListener('keydown', onKeyDown, true)
        }, 'sticky-notes: global shortcut')

        ctx.effect(() => {
          const onVisible = () => {
            if (document.visibilityState !== 'visible') return
            scanDue()
            if (!dirty) void loadState()
          }
          document.addEventListener('visibilitychange', onVisible)
          return () => document.removeEventListener('visibilitychange', onVisible)
        }, 'sticky-notes: visibility refresh')

        ctx.effect(() => {
          const timer = window.setInterval(() => {
            if (snapshot.saveError !== null && !snapshot.saving) {
              void persist()
              scanDue()
              return
            }
            scanDue()
            if (!dirty) void loadState()
          }, 30_000)
          return () => window.clearInterval(timer)
        }, 'sticky-notes: reminder poll')

        ctx.effect(() => {
          let timer = null
          const unsubscribe = subscribe(() => {
            if (timer !== null) return
            timer = window.setTimeout(() => {
              timer = null
              void syncDesktopNow()
            }, 700)
          })
          return () => {
            unsubscribe()
            if (timer !== null) window.clearTimeout(timer)
          }
        }, 'sticky-notes: desktop payload sync')

        void loadState()
        void loadPrefs()
        void loadDesktopStatus()
      },
    }
  },
})