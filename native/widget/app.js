/* Desktop sticky-note widget: renders the pinned notes the Host half writes
   into notes.json beside this file, and reports window intents back to the
   WinForms frame through WebView2 messages. */
;(function () {
  'use strict'

  var COLORS = {
    amber: '#f2b53d',
    rose: '#ef7c8e',
    mint: '#5fd08a',
    sky: '#4f9dff',
    violet: '#a78bfa',
    slate: '#9aa3af',
  }
  var PANEL = '置顶便签'
  var root = document.getElementById('root')
  var bar = document.getElementById('bar')
  var list = document.getElementById('list')
  var count = document.getElementById('count')
  var grip = document.getElementById('grip')
  var foot = document.getElementById('foot')
  var lastStamp = null
  var collapsed = false

  function post(message) {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(message))
      }
    } catch (error) {
      /* the frame is gone */
    }
  }

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function formatDue(value, done) {
    if (!value) return ''
    var time = Date.parse(value)
    if (!Number.isFinite(time)) return ''
    var date = new Date(time)
    var now = new Date()
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    var startDue = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    var dayDiff = Math.round((startDue - startToday) / 86400000)
    var day =
      dayDiff === 0
        ? '今天'
        : dayDiff === 1
          ? '明天'
          : dayDiff === -1
            ? '昨天'
            : pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    var label = day + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    return !done && time < Date.now() ? '已逾期 · ' + label : label
  }

  function dueClass(note) {
    if (!note.dueAt || note.done) return ''
    var time = Date.parse(note.dueAt)
    if (!Number.isFinite(time)) return ''
    if (time < Date.now()) return 'overdue'
    var date = new Date(time)
    var now = new Date()
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
      ? 'soon'
      : ''
  }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = text
    return node
  }

  function buildCard(note) {
    var card = el('div', 'card' + (note.done ? ' is-done' : ''))
    var tint = COLORS[note.color] || COLORS.amber
    card.style.background = 'color-mix(in srgb, ' + tint + ' 20%, var(--card-bg))'
    card.style.borderColor = 'color-mix(in srgb, ' + tint + ' 40%, var(--card-border))'
    card.title = '在便签墙中打开'

    var top = el('div', 'card-top')
    var chipClass = dueClass(note)
    if (note.dueAt) top.appendChild(el('span', 'chip' + (chipClass ? ' ' + chipClass : ''), formatDue(note.dueAt, note.done)))
    if (note.done) top.appendChild(el('span', 'chip done', '已完成'))
    card.appendChild(top)

    var text = String(note.text || '').trim()
    card.appendChild(el('div', 'card-text' + (text ? '' : ' is-empty'), text || '（空便签）'))

    var images = Array.isArray(note.images) ? note.images.slice(0, 4) : []
    if (images.length > 0) {
      var thumbs = el('div', 'thumbs')
      images.forEach(function (image) {
        if (!image || typeof image.file !== 'string') return
        var img = document.createElement('img')
        img.src = 'img/' + encodeURIComponent(image.file)
        img.alt = ''
        img.loading = 'lazy'
        thumbs.appendChild(img)
      })
      card.appendChild(thumbs)
    }

    card.addEventListener('click', function () {
      post({ type: 'focus-host' })
    })
    return card
  }

  function render(payload) {
    var appearance = payload.appearance || {}
    document.body.dataset.scheme = appearance.scheme || 'auto'
    root.style.setProperty('--radius', (appearance.radius || 12) + 'px')
    root.style.setProperty('--font-size', (appearance.fontSize || 14) + 'px')
    root.style.setProperty('--line-height', String(appearance.lineHeight || 1.55))
    root.style.setProperty('--gap', appearance.density === 'compact' ? '8px' : '12px')
    document.getElementById('title').textContent = PANEL

    var notes = Array.isArray(payload.notes) ? payload.notes : []
    count.textContent = String(notes.length)
    list.textContent = ''
    if (notes.length === 0) {
      list.appendChild(el('div', 'empty', '还没有置顶便签。\n在便签墙里点图钉，就会出现在这里。'))
      return
    }
    notes.forEach(function (note) {
      list.appendChild(buildCard(note))
    })
  }

  function poll() {
    fetch('notes.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (response) {
        return response.ok ? response.json() : null
      })
      .then(function (payload) {
        if (!payload) return
        if (payload.updatedAt === lastStamp) return
        lastStamp = payload.updatedAt
        render(payload)
      })
      .catch(function () {
        /* the file is rewritten atomically; the next tick retries */
      })
  }

  bar.addEventListener('mousedown', function (event) {
    if (event.button !== 0) return
    if (event.target.closest('button')) return
    post({ type: 'drag' })
  })

  bar.addEventListener('dblclick', function (event) {
    if (event.target.closest('button')) return
    collapsed = !collapsed
    root.classList.toggle('is-collapsed', collapsed)
    foot.textContent = collapsed ? '双击标题展开' : '拖动标题移动 · 双击标题折叠'
  })

  document.getElementById('btn-hide').addEventListener('click', function () {
    post({ type: 'close' })
  })
  document.getElementById('btn-reload').addEventListener('click', function () {
    lastStamp = null
    poll()
    post({ type: 'reload' })
  })
  document.getElementById('btn-host').addEventListener('click', function () {
    post({ type: 'focus-host' })
  })

  grip.addEventListener('pointerdown', function (event) {
    event.preventDefault()
    var startX = event.screenX
    var startY = event.screenY
    var startW = window.outerWidth || window.innerWidth
    var startH = window.outerHeight || window.innerHeight
    var frame = 0
    var pending = null
    function flush() {
      frame = 0
      if (pending) post(pending)
    }
    function move(moveEvent) {
      pending = {
        type: 'resize',
        width: Math.round(startW + (moveEvent.screenX - startX)),
        height: Math.round(startH + (moveEvent.screenY - startY)),
      }
      if (frame === 0) frame = requestAnimationFrame(flush)
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (pending) post(pending)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })

  poll()
  window.setInterval(poll, 2000)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') poll()
  })
})()