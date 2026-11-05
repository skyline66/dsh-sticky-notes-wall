// Temporary preview helper: launch the desktop companion against the real data
// directory with a demo payload so the rendered window can be inspected.
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

const root = path.join(os.homedir(), '.dsh', 'sticky-notes')
let route = null
const ctx = {
  effect(callback) {
    callback()
    return () => {}
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

const hour = 3_600_000
apply(ctx, { root })
if (route === null) throw new Error('route not registered')
await request('POST', '/sticky-notes/api/desktop/sync', {
  notes: [
    {
      id: 'preview-note-1',
      text: '把灵感钉在桌面上：开会时随手记，抬头就能看见。',
      color: 'amber',
      dueAt: new Date(Date.now() + 2 * hour).toISOString(),
      done: false,
      images: [],
    },
    {
      id: 'preview-note-2',
      text: '深色纸面 + 毛玻璃，任何壁纸下都读得清。',
      color: 'mint',
      dueAt: null,
      done: false,
      images: [],
    },
    {
      id: 'preview-note-3',
      text: '这条已经完成，会自动变淡并加删除线。',
      color: 'rose',
      dueAt: new Date(Date.now() - hour).toISOString(),
      done: true,
      images: [],
    },
  ],
  appearance: { scheme: 'dark', fontSize: 15, lineHeight: 1.6, radius: 14, density: 'cozy', contrast: 'normal' },
})

const started = JSON.parse(String((await request('POST', '/sticky-notes/api/desktop/start')).body))
console.log(JSON.stringify(started))
// Keep the Host "alive" so the companion's parent watchdog does not close it.
await new Promise(resolve => setTimeout(resolve, 60_000))
await request('POST', '/sticky-notes/api/desktop/stop')
process.exit(0)