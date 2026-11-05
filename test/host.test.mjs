// Host API test: mount the plugin against a fake web server and a temporary
// data directory, then exercise state, save validation, upload and serving.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-sticky-notes-'))
let route = null
const disposers = []
const ctx = {
  effect(callback) {
    const disposer = callback()
    disposers.push(disposer)
    return disposer
  },
  webServer: {
    register(candidate) {
      route = candidate
      return () => {}
    },
  },
  logger: {
    info() {},
    warn() {},
  },
}

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = Readable.from(payload)
    req.method = method
    req.url = url
    req.headers = {}
    const res = {
      writableEnded: false,
      status: 0,
      headers: {},
      body: null,
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(data) {
        this.body = data
        this.writableEnded = true
        resolve(this)
      },
    }
    route.handler(req, res).catch(reject)
  })
}

function parse(response) {
  return JSON.parse(String(response.body))
}

try {
  apply(ctx, { root })
  if (route === null) throw new Error('web route was not registered')

  let response = await request('GET', '/sticky-notes/api/state')
  if (response.status !== 200 || parse(response).notes.length !== 0) throw new Error('empty state failed')

  const note = {
    id: 'test-note-1',
    text: 'hello',
    color: 'amber',
    dueAt: null,
    done: false,
    images: [],
  }
  response = await request('POST', '/sticky-notes/api/save', { notes: [note] })
  if (response.status !== 200 || parse(response).count !== 1) throw new Error('save failed')

  response = await request('GET', '/sticky-notes/api/state')
  const state = parse(response)
  if (state.notes.length !== 1 || state.notes[0].text !== 'hello') throw new Error('state round-trip failed')

  response = await request('POST', '/sticky-notes/api/save', {})
  if (response.status !== 400) throw new Error(`missing notes must be rejected, got ${response.status}`)

  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3M2wAAAABJRU5ErkJggg=='
  response = await request('POST', '/sticky-notes/api/upload', { dataUrl: png, name: 'pixel.png' })
  const upload = parse(response)
  if (response.status !== 200 || !upload.image?.file) throw new Error('upload failed')

  response = await request('GET', `/sticky-notes/api/file/${upload.image.file}`)
  if (response.status !== 200 || response.headers['content-type'] !== 'image/png') throw new Error('file serving failed')

  const wall = JSON.parse(await readFile(path.join(root, 'wall.json'), 'utf8'))
  if (wall.notes.length !== 1) throw new Error('persisted document is wrong')

  response = await request('GET', '/sticky-notes/api/prefs')
  const prefsBody = parse(response)
  if (response.status !== 200 || prefsBody.prefs?.appearance?.fontSize !== 14) {
    throw new Error('default preferences were not served')
  }
  if (typeof prefsBody.autostart?.supported !== 'boolean') throw new Error('autostart state is missing')

  response = await request('POST', '/sticky-notes/api/prefs', {
    prefs: { appearance: { scheme: 'neon', fontSize: 99, radius: 4 }, float: { width: 9999, opacity: 0 }, sort: 'manual' },
  })
  const savedPrefs = parse(response).prefs
  if (savedPrefs.appearance.scheme !== 'auto') throw new Error('unknown scheme must fall back to auto')
  if (savedPrefs.appearance.fontSize !== 20) throw new Error('font size must clamp to 20')
  if (savedPrefs.appearance.radius !== 6) throw new Error('radius must clamp to 6')
  if (savedPrefs.float.width !== 460) throw new Error('float width must clamp to 460')
  if (savedPrefs.float.opacity !== 0.6) throw new Error('float opacity must clamp to 0.6')
  if (savedPrefs.sort !== 'manual') throw new Error('sort mode was not stored')

  response = await request('GET', '/sticky-notes/api/prefs')
  if (parse(response).prefs.appearance.fontSize !== 20) throw new Error('preferences did not persist')

  response = await request('POST', '/sticky-notes/api/autostart', { enabled: 'yes' })
  if (response.status !== 400) throw new Error('non-boolean autostart must be rejected')

  // This test process is plain node, so enabling login start must be refused
  // rather than writing to the real Run key.
  response = await request('POST', '/sticky-notes/api/autostart', { enabled: true })
  if (response.status !== 409) throw new Error(`autostart must be unsupported here, got ${response.status}`)

  response = await request('POST', '/sticky-notes/api/save', {
    notes: [{ ...note, order: 3 }],
  })
  if (response.status !== 200) throw new Error('ordered save failed')
  response = await request('GET', '/sticky-notes/api/state')
  if (parse(response).notes[0].order !== 3) throw new Error('note order was not persisted')

  const stored = await readFile(path.join(root, 'attachments', upload.image.file))
  if (stored.length === 0) throw new Error('attachment was not written')
  console.log('OK: host state, prefs clamping, save validation, upload and file serving')
} finally {
  for (const disposer of disposers.reverse()) {
    if (typeof disposer === 'function') disposer()
  }
  await rm(root, { recursive: true, force: true })
}