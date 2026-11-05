// Headless smoke test: load the Client module and exercise its apply-time
// registrations without a browser. This catches module/registration errors
// and verifies the localized sidebar label; it is not a rendering test.
import { readFile } from 'node:fs/promises'

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useState: value => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useRef: value => ({ current: value }),
  useMemo: factory => factory(),
  useCallback: factory => factory,
  useSyncExternalStore: () => 'zh',
}

let moduleSpec = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      moduleSpec = spec
    },
  },
  addEventListener() {},
  removeEventListener() {},
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  focus() {},
}
globalThis.document = {
  baseURI: 'http://127.0.0.1:57253/',
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
  getElementById() {
    return null
  },
}
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ ok: true, notes: [], savedAt: null }),
})
globalThis.Notification = undefined

await import('../client.js')
if (moduleSpec === null) throw new Error('client module did not call __ModuleLoader__.load')
if (moduleSpec.id !== 'dsh-sticky-notes-wall') throw new Error(`unexpected module id: ${moduleSpec.id}`)

const plugin = moduleSpec.factory(name => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
if (!Array.isArray(plugin.inject)) throw new Error('client module has no inject list')
if (typeof plugin.apply !== 'function') throw new Error('client module has no apply')

const registrations = []
const effects = []
const dicts = {}
const ctx = {
  effect(callback) {
    const disposer = callback()
    effects.push(disposer)
    return disposer
  },
  slots: {
    inject(key, callback) {
      return callback()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  locale: {
    register(namespace, dictionaries) {
      dicts[namespace] = dictionaries
      return () => {}
    },
    bind(namespace) {
      return (key, params) => {
        const template = dicts[namespace]?.zh?.[key] ?? key
        if (params === undefined) return template
        return String(template).replace(/\{(\w+)\}/g, (match, name) =>
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
        )
      }
    },
    subscribe() {
      return () => {}
    },
    getSnapshot() {
      return { active: 'zh', revision: 1 }
    },
    getLocale() {
      return { active: 'zh', revision: 1 }
    },
  },
  layout: {
    selectPanel() {},
  },
  logger: {
    info() {},
    warn() {},
  },
}

plugin.apply(ctx)
await new Promise(resolve => setTimeout(resolve, 30))

if (registrations.length !== 5) throw new Error(`expected 5 slot registrations, got ${registrations.length}`)
const sidebar = registrations.find(entry => entry.options.name === 'sidebar.panellist')
const main = registrations.find(entry => entry.options.name === 'main')
const settings = registrations.find(entry => entry.options.name === 'settings.section')
const overlays = registrations.filter(entry => entry.options.name === 'shell.overlay')
const overlay = overlays.find(entry => entry.options.id === 'sticky-notes.reminders')
const floatOverlay = overlays.find(entry => entry.options.id === 'sticky-notes.float')
if (sidebar === undefined || typeof sidebar.options.label !== 'function') throw new Error('sidebar entry missing')
if (sidebar.options.label() !== '便签墙') throw new Error(`sidebar label is ${sidebar.options.label()}`)
if (main === undefined || main.options.key !== 'sticky-notes') throw new Error('main panel missing')
if (overlay === undefined || overlay.options.id !== 'sticky-notes.reminders') throw new Error('reminder overlay missing')
if (floatOverlay === undefined) throw new Error('pinned float overlay missing')
if (settings === undefined || settings.options.id !== 'sticky-notes') throw new Error('settings section missing')

const zhKeys = Object.keys(dicts['sticky-notes']?.zh ?? {})
const enKeys = Object.keys(dicts['sticky-notes']?.en ?? {})
if (zhKeys.length === 0 || enKeys.length === 0) throw new Error('locale dictionaries missing')
const zhOnly = zhKeys.filter(key => !enKeys.includes(key))
const enOnly = enKeys.filter(key => !zhKeys.includes(key))
if (zhOnly.length > 0) throw new Error(`keys missing in en: ${zhOnly.join(', ')}`)
if (enOnly.length > 0) throw new Error(`keys missing in zh: ${enOnly.join(', ')}`)

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const usedKeys = [...source.matchAll(/tr\('([^']+)'/g)].map(match => match[1])
const missingUsed = usedKeys.filter(key => !(key in dicts['sticky-notes'].zh))
if (missingUsed.length > 0) throw new Error(`keys used but not defined: ${[...new Set(missingUsed)].join(', ')}`)
for (const color of ['Amber', 'Rose', 'Mint', 'Sky', 'Violet', 'Slate']) {
  if (!(`color${color}` in dicts['sticky-notes'].zh)) throw new Error(`missing color key color${color}`)
}

for (const disposer of effects.reverse()) {
  if (typeof disposer === 'function') disposer()
}
console.log(`OK: ${registrations.length} registrations, ${zhKeys.length} locale keys, sidebar label = ${sidebar.options.label()}`)