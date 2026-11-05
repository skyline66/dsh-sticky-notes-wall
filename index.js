/**
 * dsh-sticky-notes-wall — Host half.
 *
 * Owns the durable note document and pasted-image attachments, and exposes
 * them to the Client half over same-origin `/sticky-notes/api/*` routes:
 *
 *   GET  /sticky-notes/api/state      -> { ok, notes, savedAt, version }
 *   POST /sticky-notes/api/save       -> replace the whole note list
 *   POST /sticky-notes/api/upload     -> store one base64 image
 *   GET  /sticky-notes/api/file/<f>   -> serve one stored image
 *
 * Everything lives in the directory configured by `config.root`
 * (the bundle patch passes `<dsh-home>/sticky-notes`). The wall document is
 * written atomically; image files are content-addressed by a generated name,
 * validated by magic bytes, and served with immutable caching.
 */
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))

const API_PREFIX = '/sticky-notes/api'
const DOC_VERSION = 1
const PREFS_VERSION = 1
const NOTE_LIMIT = 5000
const TEXT_LIMIT = 100_000
const IMAGES_PER_NOTE = 12
const NAME_LIMIT = 120
const JSON_BODY_LIMIT = 16 * 1024 * 1024
const IMAGE_BODY_LIMIT = 12 * 1024 * 1024
const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const FILE_RE = /^[a-z0-9][a-z0-9-]*\.(?:png|jpe?g|webp|gif)$/i
const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}
const NOTE_COLORS = new Set(['amber', 'rose', 'mint', 'sky', 'violet', 'slate'])
const NOTE_ID_RE = /^[A-Za-z0-9_-]{6,80}$/
const FONT_FAMILIES = new Set(['system', 'sans', 'serif', 'mono', 'rounded'])
const SCHEMES = new Set(['auto', 'light', 'dark'])
const SURFACES = new Set(['auto', 'glass', 'solid'])
const CONTRASTS = new Set(['normal', 'high'])
const DENSITIES = new Set(['cozy', 'compact'])
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const AUTOSTART_NAME = 'DSH-StickyNotes'
const REG_TIMEOUT_MS = 8000

const DEFAULT_PREFS = {
  version: PREFS_VERSION,
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

class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function sendJson(res, status, body) {
  if (res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } })
}

async function readJsonBody(req, limit = JSON_BODY_LIMIT) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new ApiError(413, 'payload-too-large', 'request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ApiError(400, 'bad-json', 'request body is not valid JSON')
  }
}

function isoOr(value, fallback = null) {
  if (typeof value !== 'string' || value.length === 0) return fallback
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return fallback
  return new Date(time).toISOString()
}

function finiteSize(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 20_000 ? value : 0
}

function clampNumber(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.round(number * 100) / 100, min), max)
}

/** Coerce an untrusted preference payload into the persisted shape. */
function normalizePrefs(raw) {
  const appearance = raw?.appearance ?? {}
  const float = raw?.float ?? {}
  const fallback = DEFAULT_PREFS
  return {
    version: PREFS_VERSION,
    appearance: {
      scheme: SCHEMES.has(appearance.scheme) ? appearance.scheme : fallback.appearance.scheme,
      surface: SURFACES.has(appearance.surface) ? appearance.surface : fallback.appearance.surface,
      accent: NOTE_COLORS.has(appearance.accent) ? appearance.accent : fallback.appearance.accent,
      fontFamily: FONT_FAMILIES.has(appearance.fontFamily)
        ? appearance.fontFamily
        : fallback.appearance.fontFamily,
      fontSize: clampNumber(appearance.fontSize, 12, 20, fallback.appearance.fontSize),
      lineHeight: clampNumber(appearance.lineHeight, 1.25, 1.9, fallback.appearance.lineHeight),
      density: DENSITIES.has(appearance.density) ? appearance.density : fallback.appearance.density,
      radius: clampNumber(appearance.radius, 6, 22, fallback.appearance.radius),
      contrast: CONTRASTS.has(appearance.contrast) ? appearance.contrast : fallback.appearance.contrast,
    },
    float: {
      width: clampNumber(float.width, 260, 460, fallback.float.width),
      opacity: clampNumber(float.opacity, 0.6, 1, fallback.float.opacity),
      autoOpen: float.autoOpen === true,
      locked: float.locked === true,
    },
    sort: raw?.sort === 'manual' ? 'manual' : 'auto',
  }
}

/** The executable to register for login start, or null when this host is not the desktop app. */
function launchCommand() {
  const exe = process.execPath
  if (typeof exe !== 'string' || exe.length === 0) return null
  const base = path.basename(exe).toLowerCase()
  if (base === 'node.exe' || base === 'node') return null
  return exe
}

function runReg(args) {
  return new Promise(resolve => {
    execFile('reg', args, { windowsHide: true, timeout: REG_TIMEOUT_MS }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error?.code === 'number' ? error.code : 1
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/** Report whether the app currently starts with the user's session. */
async function readAutostart() {
  const command = launchCommand()
  if (process.platform !== 'win32') {
    return { supported: false, enabled: false, command, reason: 'platform' }
  }
  if (command === null) {
    return { supported: false, enabled: false, command: null, reason: 'not-desktop' }
  }
  const result = await runReg(['query', RUN_KEY, '/v', AUTOSTART_NAME])
  if (result.code !== 0) return { supported: true, enabled: false, command }
  return { supported: true, enabled: /REG_SZ\s+\S+/m.test(result.stdout), command }
}

/** Add or remove the HKCU Run entry used for login start. */
async function writeAutostart(enabled) {
  const command = launchCommand()
  if (process.platform !== 'win32') {
    throw new ApiError(409, 'unsupported', '开机自启动目前只支持 Windows 桌面端')
  }
  if (command === null) {
    throw new ApiError(409, 'unsupported', '当前 Host 不是桌面应用进程，无法定位可自启动的可执行文件')
  }
  if (enabled) {
    const result = await runReg(['add', RUN_KEY, '/v', AUTOSTART_NAME, '/t', 'REG_SZ', '/d', `"${command}"`, '/f'])
    if (result.code !== 0) {
      throw new ApiError(500, 'autostart-failed', result.stderr.trim() || '写入开机启动项失败')
    }
  } else {
    const result = await runReg(['delete', RUN_KEY, '/v', AUTOSTART_NAME, '/f'])
    if (result.code !== 0) {
      const query = await runReg(['query', RUN_KEY, '/v', AUTOSTART_NAME])
      if (query.code === 0) {
        throw new ApiError(500, 'autostart-failed', result.stderr.trim() || '移除开机启动项失败')
      }
    }
  }
  return readAutostart()
}

function normalizeImage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const file = typeof raw.file === 'string' ? raw.file.trim() : ''
  if (!FILE_RE.test(file)) return null
  return {
    file,
    w: finiteSize(raw.w),
    h: finiteSize(raw.h),
    name: typeof raw.name === 'string' ? raw.name.slice(0, NAME_LIMIT) : '',
  }
}

function normalizeNote(raw, now) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && NOTE_ID_RE.test(raw.id) ? raw.id : randomUUID()
  const text = typeof raw.text === 'string' ? raw.text.slice(0, TEXT_LIMIT) : ''
  const color = NOTE_COLORS.has(raw.color) ? raw.color : 'amber'
  const createdAt = isoOr(raw.createdAt, now)
  const updatedAt = isoOr(raw.updatedAt, createdAt)
  const dueAt = isoOr(raw.dueAt, null)
  const done = raw.done === true
  const doneAt = done ? isoOr(raw.doneAt, updatedAt) : null
  const remindedAt = isoOr(raw.remindedAt, null)
  const order = Number.isFinite(raw.order) ? Math.round(raw.order) : null
  const images = Array.isArray(raw.images)
    ? raw.images.slice(0, IMAGES_PER_NOTE).map(normalizeImage).filter(Boolean)
    : []
  return { id, text, color, createdAt, updatedAt, dueAt, done, doneAt, remindedAt, images, order }
}

/** Coerce an untrusted payload into the persisted document shape. */
function normalizeDoc(payload) {
  const now = new Date().toISOString()
  const rows = Array.isArray(payload?.notes) ? payload.notes.slice(0, NOTE_LIMIT) : []
  const notes = []
  const seen = new Set()
  for (const row of rows) {
    const note = normalizeNote(row, now)
    if (note === null || seen.has(note.id)) continue
    seen.add(note.id)
    notes.push(note)
  }
  return { version: DOC_VERSION, updatedAt: now, notes }
}

function detectImage(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.length >= 6 && buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif'
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw new ApiError(400, 'bad-image', 'dataUrl is required')
  const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (match === null) throw new ApiError(400, 'bad-image', 'dataUrl must be a base64 image')
  let buffer
  try {
    buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64')
  } catch {
    throw new ApiError(400, 'bad-image', 'dataUrl is not valid base64')
  }
  if (buffer.length === 0) throw new ApiError(400, 'bad-image', 'image is empty')
  if (buffer.length > IMAGE_MAX_BYTES) throw new ApiError(413, 'image-too-large', 'image exceeds the 8 MiB limit')
  return buffer
}

export const inject = ['webServer']

export function apply(ctx, config) {
  const configuredRoot = typeof config?.root === 'string' && config.root.trim().length > 0 ? config.root.trim() : undefined
  const root = path.resolve(configuredRoot ?? path.join(os.homedir(), '.dsh', 'sticky-notes'))
  const stateFile = path.join(root, 'wall.json')
  const prefsFile = path.join(root, 'prefs.json')
  const attachmentsDir = path.join(root, 'attachments')
  // Optional Windows desktop companion: a native, always-on-top WebView2 window.
  const nativeDir = path.join(PACKAGE_ROOT, 'native')
  const widgetSourceDir = path.join(nativeDir, 'widget')
  const sdkDir = path.join(nativeDir, 'sdk')
  const desktopRuntimeDir = path.join(root, 'desktop')
  const desktopWidgetDir = path.join(desktopRuntimeDir, 'widget')
  const desktopPayloadFile = path.join(desktopRuntimeDir, 'notes-payload.json')
  const desktopDataDir = path.join(root, 'desktop-data')
  const desktopPidFile = path.join(root, 'desktop-pid.json')
  let desktopChild = null
  const log = (...parts) => {
    try {
      ctx.logger?.info?.(`[sticky-notes] ${parts.join(' ')}`)
    } catch {
      // logging is best effort
    }
  }

  /** Serialize writes so two quick saves cannot interleave their temp files. */
  let writeChain = Promise.resolve()
  function enqueueWrite(operation) {
    const run = writeChain.then(operation, operation)
    writeChain = run.catch(() => {})
    return run
  }

  async function readDoc() {
    let text
    try {
      text = await fs.readFile(stateFile, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: DOC_VERSION, updatedAt: null, notes: [] }
      throw new ApiError(500, 'store-unreadable', `cannot read the note store: ${error?.message ?? error}`)
    }
    try {
      const parsed = JSON.parse(text)
      const normalized = normalizeDoc(parsed)
      // Preserve the stored revision time when the document is otherwise valid.
      normalized.updatedAt = isoOr(parsed?.updatedAt, normalized.updatedAt)
      return normalized
    } catch {
      const backup = `${stateFile}.corrupt-${Date.now()}`
      try {
        await fs.rename(stateFile, backup)
        log(`note store was corrupt; moved it to ${backup}`)
      } catch {
        // best effort
      }
      return { version: DOC_VERSION, updatedAt: null, notes: [] }
    }
  }

  async function writeDoc(doc) {
    await fs.mkdir(root, { recursive: true })
    const tempFile = `${stateFile}.${process.pid}.${Date.now()}.tmp`
    const body = `${JSON.stringify(doc, null, 2)}\n`
    try {
      await fs.writeFile(tempFile, body, 'utf8')
      await fs.rename(tempFile, stateFile)
    } catch (error) {
      try {
        await fs.unlink(tempFile)
      } catch {
        // best effort
      }
      // Some Windows filesystems refuse rename-over-existing; fall back to a
      // direct write, which is still safe for this single-writer store.
      try {
        await fs.writeFile(stateFile, body, 'utf8')
      } catch (fallbackError) {
        throw new ApiError(
          500,
          'store-write-failed',
          `cannot write the note store: ${fallbackError?.message ?? fallbackError} (initial error: ${error?.message ?? error})`,
        )
      }
    }
    return doc
  }

  /** Remove attachments no note references and that are older than a day. */
  async function cleanupOrphans(doc) {
    try {
      const keep = new Set()
      for (const note of doc.notes) {
        for (const image of note.images) keep.add(image.file)
      }
      const entries = await fs.readdir(attachmentsDir, { withFileTypes: true })
      const cutoff = Date.now() - 24 * 60 * 60 * 1000
      for (const entry of entries) {
        if (!entry.isFile() || keep.has(entry.name) || !FILE_RE.test(entry.name)) continue
        const target = path.join(attachmentsDir, entry.name)
        try {
          const stat = await fs.stat(target)
          if (stat.mtimeMs < cutoff) await fs.unlink(target)
        } catch {
          // best effort
        }
      }
    } catch {
      // no attachments directory yet
    }
  }

  async function serveState(res) {
    const doc = await readDoc()
    sendJson(res, 200, {
      ok: true,
      version: doc.version,
      notes: doc.notes,
      savedAt: doc.updatedAt,
      serverTime: new Date().toISOString(),
    })
  }

  // -------------------------------------------------------------------
  // Desktop companion window (Windows only)
  // -------------------------------------------------------------------

  function compilerPath() {
    const candidates = [
      path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
      path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
    ]
    return candidates.find(candidate => existsSync(candidate)) ?? null
  }

  async function nativeStamp() {
    const files = [
      path.join(nativeDir, 'StickyWidget.cs'),
      path.join(sdkDir, 'Microsoft.Web.WebView2.Core.dll'),
      path.join(sdkDir, 'Microsoft.Web.WebView2.WinForms.dll'),
      path.join(sdkDir, 'WebView2Loader.dll'),
      path.join(widgetSourceDir, 'index.html'),
      path.join(widgetSourceDir, 'styles.css'),
      path.join(widgetSourceDir, 'app.js'),
    ]
    const parts = []
    for (const file of files) {
      try {
        const info = await fs.stat(file)
        parts.push(`${file}:${info.size}:${info.mtimeMs}`)
      } catch {
        parts.push(`${file}:missing`)
      }
    }
    return parts.join('|')
  }

  /** Compile the C# companion on first use; the package ships no executable. */
  async function ensureDesktopBuilt() {
    if (process.platform !== 'win32') {
      throw new ApiError(409, 'unsupported', '桌面置顶窗口目前只支持 Windows')
    }
    const csc = compilerPath()
    if (csc === null) {
      throw new ApiError(409, 'no-compiler', '找不到 .NET Framework 编译器 csc.exe，无法构建桌面窗口')
    }
    await fs.mkdir(desktopRuntimeDir, { recursive: true })
    const exe = path.join(desktopRuntimeDir, 'StickyNotesWidget.exe')
    const stampFile = path.join(desktopRuntimeDir, 'build.stamp')
    const stamp = await nativeStamp()
    let previous = ''
    try {
      previous = (await fs.readFile(stampFile, 'utf8')).trim()
    } catch {
      // first build
    }
    if (existsSync(exe) && previous === stamp) {
      await copyWidgetRuntime()
      return exe
    }
    for (const name of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll']) {
      await fs.copyFile(path.join(sdkDir, name), path.join(desktopRuntimeDir, name))
    }
    const framework = path.dirname(csc)
    const args = [
      '/nologo',
      '/target:winexe',
      '/platform:x64',
      '/optimize+',
      `/out:${exe}`,
      '/reference:System.dll',
      '/reference:System.Core.dll',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Drawing.dll',
      `/reference:${path.join(framework, 'System.Web.Extensions.dll')}`,
      `/reference:${path.join(sdkDir, 'Microsoft.Web.WebView2.Core.dll')}`,
      `/reference:${path.join(sdkDir, 'Microsoft.Web.WebView2.WinForms.dll')}`,
      path.join(nativeDir, 'StickyWidget.cs'),
    ]
    try {
      await execFileAsync(csc, args, { windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })
    } catch (error) {
      const detail = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim()
      throw new ApiError(500, 'build-failed', `桌面窗口构建失败${detail ? `：${detail}` : `：${error?.message ?? error}`}`)
    }
    await fs.writeFile(stampFile, stamp, 'utf8')
    await copyWidgetRuntime()
    log('desktop companion compiled')
    return exe
  }

  /** Refresh the widget folder the native window renders from. */
  async function copyWidgetRuntime() {
    await fs.mkdir(desktopWidgetDir, { recursive: true })
    for (const name of ['index.html', 'styles.css', 'app.js']) {
      await fs.copyFile(path.join(widgetSourceDir, name), path.join(desktopWidgetDir, name))
    }
    await publishPayload()
  }

  async function readDesktopPayload() {
    try {
      return JSON.parse(await fs.readFile(desktopPayloadFile, 'utf8'))
    } catch {
      return null
    }
  }

  async function writeJsonAtomic(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    try {
      await fs.rename(temp, file)
    } catch {
      await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await fs.unlink(temp).catch(() => {})
    }
  }

  /** Copy a payload into the widget folder so the window can poll it. */
  async function publishPayload() {
    const payload = await readDesktopPayload()
    if (payload === null) return
    const images = new Set()
    for (const note of payload.notes ?? []) {
      for (const image of note.images ?? []) images.add(image.file)
    }
    const imageDir = path.join(desktopWidgetDir, 'img')
    if (images.size > 0) await fs.mkdir(imageDir, { recursive: true })
    for (const file of images) {
      if (!FILE_RE.test(file)) continue
      try {
        await fs.copyFile(path.join(attachmentsDir, file), path.join(imageDir, file))
      } catch {
        // a missing attachment just leaves an empty thumbnail
      }
    }
    await writeJsonAtomic(path.join(desktopWidgetDir, 'notes.json'), payload)
  }

  async function saveDesktopPayload(payload) {
    const notes = []
    for (const note of Array.isArray(payload?.notes) ? payload.notes.slice(0, 30) : []) {
      if (typeof note?.id !== 'string' || !NOTE_ID_RE.test(note.id)) continue
      const images = (Array.isArray(note.images) ? note.images : [])
        .map(normalizeImage)
        .filter(Boolean)
        .slice(0, 4)
      notes.push({
        id: note.id,
        text: typeof note.text === 'string' ? note.text.slice(0, TEXT_LIMIT) : '',
        color: NOTE_COLORS.has(note.color) ? note.color : 'amber',
        dueAt: isoOr(note.dueAt, null),
        done: note.done === true,
        images,
      })
    }
    const record = {
      updatedAt: new Date().toISOString(),
      appearance: normalizePrefs({ appearance: payload?.appearance }).appearance,
      notes,
    }
    await writeJsonAtomic(desktopPayloadFile, record)
    await publishPayload()
    return record
  }

  async function readDesktopPid() {
    try {
      const parsed = JSON.parse(await fs.readFile(desktopPidFile, 'utf8'))
      return Number.isSafeInteger(parsed?.pid) && parsed.pid > 0 ? parsed : null
    } catch {
      return null
    }
  }

  function pidAlive(pid) {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  async function desktopStatus() {
    const base = {
      ok: true,
      platform: process.platform,
      supported: process.platform === 'win32',
      running: false,
      compiled: existsSync(path.join(desktopRuntimeDir, 'StickyNotesWidget.exe')),
      compiler: process.platform === 'win32' ? compilerPath() !== null : false,
    }
    if (process.platform !== 'win32') return base
    const record = await readDesktopPid()
    if (record === null) return base
    if (!pidAlive(record.pid)) {
      await fs.rm(desktopPidFile, { force: true }).catch(() => {})
      return base
    }
    return { ...base, running: true, pid: record.pid, startedAt: record.startedAt ?? null }
  }

  async function startDesktop() {
    const current = await desktopStatus()
    if (!current.supported) throw new ApiError(409, 'unsupported', '桌面置顶窗口目前只支持 Windows')
    if (current.running) return current
    const exe = await ensureDesktopBuilt()
    await fs.mkdir(desktopDataDir, { recursive: true })
    const child = spawn(exe, ['--data-dir', desktopDataDir, '--parent-pid', String(process.pid)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.unref()
    desktopChild = child
    if (!child.pid) throw new ApiError(500, 'spawn-failed', '桌面窗口没有返回进程号')
    await fs.writeFile(desktopPidFile, JSON.stringify({ pid: child.pid, startedAt: Date.now() }), 'utf8')
    await new Promise(resolve => setTimeout(resolve, 1400))
    if (!pidAlive(child.pid)) {
      await fs.rm(desktopPidFile, { force: true }).catch(() => {})
      throw new ApiError(500, 'crashed', `桌面窗口启动后立即退出，请查看 ${path.join(desktopDataDir, 'native.log')}`)
    }
    log(`desktop companion started (pid ${child.pid})`)
    return desktopStatus()
  }

  async function stopDesktop() {
    const record = await readDesktopPid()
    if (record !== null && pidAlive(record.pid)) {
      try {
        process.kill(record.pid)
      } catch {
        // already gone
      }
      await new Promise(resolve => setTimeout(resolve, 600))
      if (pidAlive(record.pid)) {
        try {
          process.kill(record.pid, 'SIGKILL')
        } catch {
          // best effort
        }
      }
    }
    if (desktopChild !== null && record !== null && desktopChild.pid === record.pid) desktopChild = null
    await fs.rm(desktopPidFile, { force: true }).catch(() => {})
    return desktopStatus()
  }

  /** Appearance and floating-window preferences live beside the notes. */
  async function readPrefs() {
    try {
      const text = await fs.readFile(prefsFile, 'utf8')
      return normalizePrefs(JSON.parse(text))
    } catch {
      return normalizePrefs(DEFAULT_PREFS)
    }
  }

  async function writePrefs(prefs) {
    await fs.mkdir(root, { recursive: true })
    const tempFile = `${prefsFile}.${process.pid}.${Date.now()}.tmp`
    const body = `${JSON.stringify(prefs, null, 2)}\n`
    try {
      await fs.writeFile(tempFile, body, 'utf8')
      await fs.rename(tempFile, prefsFile)
    } catch {
      try {
        await fs.unlink(tempFile)
      } catch {
        // best effort
      }
      await fs.writeFile(prefsFile, body, 'utf8')
    }
    return prefs
  }

  async function servePrefs(res) {
    const prefs = await readPrefs()
    let autostart
    try {
      autostart = await readAutostart()
    } catch {
      autostart = { supported: false, enabled: false, command: null, reason: 'error' }
    }
    sendJson(res, 200, { ok: true, prefs, autostart })
  }

  async function savePrefs(req, res) {
    const payload = await readJsonBody(req, 64 * 1024)
    const prefs = normalizePrefs(payload?.prefs ?? payload)
    await enqueueWrite(() => writePrefs(prefs))
    sendJson(res, 200, { ok: true, prefs })
  }

  async function saveAutostart(req, res) {
    const payload = await readJsonBody(req, 4096)
    if (typeof payload?.enabled !== 'boolean') {
      throw new ApiError(400, 'bad-payload', 'enabled must be a boolean')
    }
    const autostart = await writeAutostart(payload.enabled)
    log(`login start ${autostart.enabled ? 'enabled' : 'disabled'}`)
    sendJson(res, 200, { ok: true, autostart })
  }

  async function saveState(req, res) {
    const payload = await readJsonBody(req)
    if (!Array.isArray(payload?.notes)) throw new ApiError(400, 'bad-payload', 'notes must be an array')
    const doc = normalizeDoc(payload)
    await enqueueWrite(() => writeDoc(doc))
    void cleanupOrphans(doc)
    log(`saved ${doc.notes.length} note(s)`)
    sendJson(res, 200, { ok: true, version: doc.version, savedAt: doc.updatedAt, count: doc.notes.length })
  }

  async function uploadImage(req, res) {
    const payload = await readJsonBody(req, IMAGE_BODY_LIMIT)
    const buffer = decodeImageDataUrl(payload?.dataUrl)
    const ext = detectImage(buffer)
    if (ext === null) throw new ApiError(400, 'bad-image', 'the uploaded bytes are not a PNG, JPEG, WebP, or GIF image')
    const file = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${ext}`
    await fs.mkdir(attachmentsDir, { recursive: true })
    await fs.writeFile(path.join(attachmentsDir, file), buffer)
    sendJson(res, 200, {
      ok: true,
      image: {
        file,
        url: `${API_PREFIX}/file/${file}`,
        w: finiteSize(payload?.width),
        h: finiteSize(payload?.height),
        name: typeof payload?.name === 'string' ? payload.name.slice(0, NAME_LIMIT) : '',
        bytes: buffer.length,
      },
    })
  }

  async function serveFile(res, name) {
    if (!FILE_RE.test(name)) throw new ApiError(404, 'not-found', 'unknown attachment')
    let buffer
    try {
      buffer = await fs.readFile(path.join(attachmentsDir, name))
    } catch (error) {
      if (error?.code === 'ENOENT') throw new ApiError(404, 'not-found', 'unknown attachment')
      throw error
    }
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    res.writeHead(200, {
      'content-type': IMAGE_MIME[ext] ?? 'application/octet-stream',
      'content-length': String(buffer.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    })
    res.end(buffer)
  }

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sub = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : ''
    if (req.method === 'GET' && sub === '/state') return serveState(res)
    if (req.method === 'GET' && sub === '/health') {
      return sendJson(res, 200, { ok: true, root, serverTime: new Date().toISOString() })
    }
    if (req.method === 'POST' && sub === '/save') return saveState(req, res)
    if (req.method === 'POST' && sub === '/upload') return uploadImage(req, res)
    if (req.method === 'GET' && sub === '/prefs') return servePrefs(res)
    if (req.method === 'POST' && sub === '/prefs') return savePrefs(req, res)
    if (req.method === 'POST' && sub === '/autostart') return saveAutostart(req, res)
    if (req.method === 'GET' && sub === '/desktop/status') return sendJson(res, 200, await desktopStatus())
    if (req.method === 'POST' && sub === '/desktop/start') return sendJson(res, 200, await startDesktop())
    if (req.method === 'POST' && sub === '/desktop/stop') return sendJson(res, 200, await stopDesktop())
    if (req.method === 'POST' && sub === '/desktop/toggle') {
      const status = await desktopStatus()
      return sendJson(res, 200, status.running ? await stopDesktop() : await startDesktop())
    }
    if (req.method === 'POST' && sub === '/desktop/sync') {
      const payload = await readJsonBody(req, 2 * 1024 * 1024)
      const saved = await saveDesktopPayload(payload)
      return sendJson(res, 200, { ok: true, updatedAt: saved.updatedAt, count: saved.notes.length })
    }
    if (req.method === 'GET' && sub.startsWith('/file/')) {
      return serveFile(res, decodeURIComponent(sub.slice('/file/'.length)))
    }
    throw new ApiError(404, 'not-found', 'unknown sticky-notes API route')
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          try {
            await route(req, res)
          } catch (error) {
            const status = error instanceof ApiError ? error.status : 500
            const code = error instanceof ApiError ? error.code : 'internal'
            const message = String(error?.message ?? error)
            if (status >= 500) log(`request failed: ${message}`)
            if (!res.writableEnded) sendError(res, status, code, message)
          }
        },
      }),
    'sticky-notes: api routes',
  )

  ctx.effect(
    () => () => {
      void stopDesktop()
    },
    'sticky-notes: stop the desktop companion',
  )

  log(`store ready at ${stateFile}`)
}