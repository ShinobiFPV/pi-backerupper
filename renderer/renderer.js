let settings = {}
let running = false

const $ = (id) => document.getElementById(id)

// ── Titlebar ─────────────────────────────────────────

$('btn-min').addEventListener('click', () => window.api.minimize())
$('btn-close').addEventListener('click', () => window.api.close())

// ── Init ─────────────────────────────────────────────

function populateTimeSelects() {
  const hourSel = $('hour')
  const minSel = $('minute')
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement('option')
    opt.value = String(h).padStart(2, '0')
    opt.textContent = String(h).padStart(2, '0')
    hourSel.appendChild(opt)
  }
  for (let m = 0; m < 60; m++) {
    const opt = document.createElement('option')
    opt.value = String(m).padStart(2, '0')
    opt.textContent = String(m).padStart(2, '0')
    minSel.appendChild(opt)
  }
}

function applySettingsToForm() {
  $('host').value = settings.host || '192.168.1.203'
  $('user').value = settings.user || 'shinobi'
  $('dest').value = settings.dest || ''
  $('scriptPath').value = settings.scriptPath || ''
  $('scheduleEnabled').checked = settings.scheduleEnabled !== false

  const [h, m] = (settings.scheduleTime || '03:00').split(':')
  $('hour').value = h
  $('minute').value = m

  const src = settings.sources || {}
  $('src-home').checked = src.home !== false
  $('src-website').checked = src.website !== false
  $('src-nginx').checked = src.nginx !== false
  $('src-systemd').checked = src.systemd !== false
}

function collectFormSettings() {
  return {
    host: $('host').value.trim(),
    user: $('user').value.trim(),
    dest: $('dest').value,
    scriptPath: $('scriptPath').value,
    scheduleEnabled: $('scheduleEnabled').checked,
    scheduleTime: `${$('hour').value}:${$('minute').value}`,
    sources: {
      home: $('src-home').checked,
      website: $('src-website').checked,
      nginx: $('src-nginx').checked,
      systemd: $('src-systemd').checked,
    },
  }
}

async function saveForm() {
  settings = { ...settings, ...collectFormSettings() }
  await window.api.saveSettings(collectFormSettings())
  updateCards()
}

async function init() {
  populateTimeSelects()
  settings = await window.api.getSettings()
  applySettingsToForm()
  updateCards()
  wireEvents()
  pollConnection()
  setInterval(pollConnection, 30000)
  setInterval(updateNextBackup, 30000)
}

function wireEvents() {
  ;['host', 'user'].forEach((id) => $(id).addEventListener('change', saveForm))
  ;['scheduleEnabled', 'hour', 'minute', 'src-home', 'src-website', 'src-nginx', 'src-systemd'].forEach(
    (id) => $(id).addEventListener('change', saveForm)
  )

  $('btn-browse-dest').addEventListener('click', async () => {
    const folder = await window.api.browseFolder()
    if (folder) {
      $('dest').value = folder
      saveForm()
    }
  })

  $('btn-browse-script').addEventListener('click', async () => {
    const file = await window.api.browseScript()
    if (file) {
      $('scriptPath').value = file
      saveForm()
    }
  })

  $('btn-test').addEventListener('click', () => pollConnection())

  $('btn-clear-log').addEventListener('click', () => {
    $('log').innerHTML = ''
  })

  $('btn-run').addEventListener('click', onRunOrCancel)

  $('btn-image').addEventListener('click', async () => {
    if (running) return
    const proceed = confirm(
      'Creating a full SD card image takes 20-60 minutes and will keep the Pi busy the whole time. Continue?'
    )
    if (!proceed) return
    startBackup({ fullImage: true })
  })

  $('btn-logs').addEventListener('click', () => window.api.openLogs())
}

// ── Connection status ────────────────────────────────

async function pollConnection() {
  const dot = $('conn-dot')
  const text = $('conn-text')
  const online = await window.api.testConnection()
  dot.className = 'dot ' + (online ? 'online' : 'offline')
  text.textContent = online ? 'ONLINE' : 'OFFLINE'
  $('card-pi-status').textContent = online ? 'ONLINE' : 'OFFLINE'
  $('card-pi-status').style.color = online ? 'var(--green)' : 'var(--red)'
  $('card-pi-host').textContent = settings.host || $('host').value || '--'
}

// ── Status cards ─────────────────────────────────────

function updateCards() {
  const last = settings.lastBackup || {}
  if (last.timestamp) {
    const d = new Date(last.timestamp)
    $('card-last-time').textContent = formatDateTime(d)
    const size = last.sizeMB != null ? `${last.sizeMB} MB` : '--'
    const dur = last.duration != null ? `${last.duration}s` : '--'
    const status = last.success === false ? ' (FAILED)' : ''
    $('card-last-detail').textContent = `${size} · ${dur}${status}`
    $('card-last-detail').style.color = last.success === false ? 'var(--red)' : ''
  } else {
    $('card-last-time').textContent = 'Never'
    $('card-last-detail').textContent = '--'
  }

  updateNextBackup()
}

function updateNextBackup() {
  if (!settings.scheduleEnabled) {
    $('card-next-time').textContent = 'Disabled'
    $('card-next-detail').textContent = '--'
    return
  }
  const time = settings.scheduleTime || '03:00'
  const [h, m] = time.split(':').map(Number)
  const now = new Date()
  const next = new Date(now)
  next.setHours(h, m, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)

  $('card-next-time').textContent = formatDateTime(next)
  const diffMs = next - now
  const hours = Math.floor(diffMs / 3600000)
  const mins = Math.round((diffMs % 3600000) / 60000)
  $('card-next-detail').textContent = `in ${hours}h ${mins}m`
}

function formatDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Backup run ───────────────────────────────────────

function setRunning(isRunning) {
  running = isRunning
  const btn = $('btn-run')
  if (isRunning) {
    btn.textContent = '■ CANCEL'
    btn.classList.remove('btn-primary')
    btn.classList.add('btn-cancel')
    $('btn-image').disabled = true
  } else {
    btn.textContent = '▶ RUN NOW'
    btn.classList.add('btn-primary')
    btn.classList.remove('btn-cancel')
    $('btn-image').disabled = false
  }
}

async function onRunOrCancel() {
  if (running) {
    await window.api.cancelBackup()
    return
  }
  startBackup({})
}

async function startBackup(opts) {
  const result = await window.api.runBackup(opts)
  if (!result.ok) {
    appendLog('[ERR] ' + result.error + '\n')
    return
  }
  setRunning(true)
}

function appendLog(text) {
  const log = $('log')
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  for (const line of lines) {
    const div = document.createElement('div')
    div.className = 'log-line ' + classifyLine(line)
    div.textContent = line
    log.appendChild(div)
  }
  log.scrollTop = log.scrollHeight
}

function classifyLine(line) {
  if (/FAIL|ERR/i.test(line)) return 'fail'
  if (/WARN/i.test(line)) return 'warn'
  if (/OK/.test(line)) return 'ok'
  return 'info'
}

window.api.onLog((data) => appendLog(data))

window.api.onDone(async ({ success }) => {
  setRunning(false)
  appendLog(success ? '[OK] Backup finished successfully\n' : '[FAIL] Backup failed\n')
  settings = await window.api.getSettings()
  updateCards()
})

init()
