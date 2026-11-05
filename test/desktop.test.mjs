// Desktop companion test (Windows only): mount the Host half against a fake
// web server, push a payload, compile + launch the native window, confirm it
// stays alive, then shut it down and clean up the temporary data directory.
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

if (process.platform !== 'win32') {
  console.log('SKIP: the desktop companion is Windows only')
  process.exit(0)
}

const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-sticky-desktop-'))
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
  logger: { info() {}, warn() {} },
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

const parse = response => JSON.parse(String(response.body))

try {
  apply(ctx, { root })
  if (route === null) throw new Error('web route was not registered')

  let response = await request('POST', '/sticky-notes/api/desktop/sync', {
    notes: [
      { id: 'desktop-note-1', text: '桌面置顶窗口的测试便签', color: 'amber', dueAt: new Date(Date.now() + 3_600_000).toISOString(), done: false, images: [] },
      { id: 'desktop-note-2', text: '第二条置顶便签', color: 'mint', dueAt: null, done: true, images: [] },
    ],
    appearance: { scheme: 'dark', fontSize: 15, radius: 14 },
  })
  if (response.status !== 200 || parse(response).count !== 2) throw new Error(`desktop sync failed: ${String(response.body)}`)

  response = await request('GET', '/sticky-notes/api/desktop/status')
  const before = parse(response)
  if (before.supported !== true) throw new Error('desktop companion reports unsupported on Windows')
  if (before.compiler !== true) throw new Error('csc.exe was not detected')

  console.log('compiling and launching the desktop window (this takes a few seconds)…')
  response = await request('POST', '/sticky-notes/api/desktop/start')
  const started = parse(response)
  if (response.status !== 200 || started.running !== true) {
    throw new Error(`desktop start failed: ${String(response.body)}`)
  }
  console.log(`desktop window running (pid ${started.pid}), compiled=${started.compiled}`)

  await new Promise(resolve => setTimeout(resolve, 2500))
  response = await request('GET', '/sticky-notes/api/desktop/status')
  const alive = parse(response)
  if (alive.running !== true) throw new Error('desktop window exited early; see the plugin data directory native.log')

  response = await request('POST', '/sticky-notes/api/desktop/stop')
  if (parse(response).running !== false) throw new Error('desktop window did not stop')
  console.log('OK: desktop companion compiled, launched, reported running and stopped')
} finally {
  for (const disposer of disposers.reverse()) {
    if (typeof disposer === 'function') await disposer()
  }
  await rm(root, { recursive: true, force: true })
}