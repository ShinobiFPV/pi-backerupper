const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { execFile, spawn } = require('child_process')
const Store = require('electron-store')
const schedule = require('node-schedule')
const path = require('path')
const fs = require('fs')
const os = require('os')

const PI_NAME = 'shinobi'

const schema = {
  host: { type: 'string', default: '192.168.1.203' },
  user: { type: 'string', default: 'shinobi' },
  dest: { type: 'string', default: '' },
  scheduleTime: { type: 'string', default: '03:00' },
  scheduleEnabled: { type: 'boolean', default: true },
  sources: {
    type: 'object',
    default: { home: true, website: true, nginx: true, systemd: true },
    properties: {
      home: { type: 'boolean' },
      website: { type: 'boolean' },
      nginx: { type: 'boolean' },
      systemd: { type: 'boolean' },
    },
  },
  lastBackup: {
    type: 'object',
    default: {},
    properties: {
      timestamp: { type: 'string' },
      sizeMB: { type: 'number' },
      duration: { type: 'number' },
      success: { type: 'boolean' },
    },
  },
  scriptPath: { type: 'string', default: '' },
}

const store = new Store({ schema })

function detectDefaultScriptPath() {
  const existing = store.get('scriptPath', '')
  if (existing && fs.existsSync(existing)) return existing

  const candidate = path.join(
    os.homedir(),
    'Projects', 'ShinTech', 'shintech-backup', 'shintech-backup', 'shintech-backup.ps1'
  )
  if (fs.existsSync(candidate)) return candidate
  return existing
}

let mainWindow = null
let backupJob = null
let backupProc = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 620,
    resizable: false,
    frame: false,
    backgroundColor: '#000000',
    title: 'Pi BackerUpper — ShinTech Electronics',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile('renderer/index.html')
}

app.whenReady().then(() => {
  const detected = detectDefaultScriptPath()
  if (detected) store.set('scriptPath', detected)

  createWindow()
  scheduleBackup()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC handlers ──────────────────────────────────────

ipcMain.handle('get-settings', () => store.store)

ipcMain.handle('save-settings', (_, settings) => {
  store.set(settings)
  scheduleBackup() // reschedule if time changed
  return true
})

ipcMain.handle('browse-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose backup destination',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('browse-script', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PowerShell', extensions: ['ps1'] }],
    title: 'Locate shintech-backup.ps1',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('test-connection', async () => {
  const host = store.get('host', '192.168.1.203')
  return new Promise((resolve) => {
    execFile('ping', ['-n', '1', '-w', '2000', host], (err) => resolve(!err))
  })
})

function readManifest(dest) {
  try {
    const manifestPath = path.join(dest, `Pi-${PI_NAME}`, 'rsync', 'manifest.json')
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return { sizeMB: raw.size_mb, duration: raw.duration_s }
  } catch {
    return { sizeMB: null, duration: null }
  }
}

function runBackup(opts = {}) {
  if (backupProc) return { ok: false, error: 'Backup already running' }

  const dest = store.get('dest', '')
  const script = store.get('scriptPath', '')

  if (!dest || !script) {
    return { ok: false, error: 'Set destination and script path first' }
  }

  const args = [
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-Auto',
    '-Dest', dest,
  ]
  if (opts.fullImage) args.push('-FullImage')

  const sources = store.get('sources', {})
  if (!sources.home) args.push('-SkipHome')
  if (!sources.website) args.push('-SkipWebsite')
  if (!sources.nginx) args.push('-SkipNginx')
  if (!sources.systemd) args.push('-SkipSystemd')

  backupProc = spawn('powershell.exe', args)

  backupProc.stdout.on('data', (data) => {
    mainWindow?.webContents.send('backup-log', data.toString())
  })
  backupProc.stderr.on('data', (data) => {
    mainWindow?.webContents.send('backup-log', '[ERR] ' + data.toString())
  })
  backupProc.on('close', (code) => {
    backupProc = null
    const success = code === 0
    const now = new Date().toISOString()
    const { sizeMB, duration } = readManifest(dest)
    store.set('lastBackup', { timestamp: now, sizeMB, duration, success })
    mainWindow?.webContents.send('backup-done', { success, code })
  })

  return { ok: true }
}

ipcMain.handle('run-backup', (_, opts) => runBackup(opts))

ipcMain.handle('cancel-backup', () => {
  if (backupProc) {
    backupProc.kill()
    backupProc = null
    return true
  }
  return false
})

ipcMain.handle('open-logs', () => {
  const logsDir = path.join(process.env.LOCALAPPDATA, 'ShinTech', 'backup-logs')
  shell.openPath(logsDir)
})

ipcMain.handle('minimize', () => mainWindow?.minimize())
ipcMain.handle('close', () => mainWindow?.close())

// ── Scheduler ─────────────────────────────────────────

function scheduleBackup() {
  if (backupJob) {
    backupJob.cancel()
    backupJob = null
  }
  if (!store.get('scheduleEnabled', true)) return

  const time = store.get('scheduleTime', '03:00')
  const [h, m] = time.split(':').map(Number)

  backupJob = schedule.scheduleJob({ hour: h, minute: m }, () => {
    mainWindow?.webContents.send('backup-log', '[SCHEDULED] Daily backup started\n')
    runBackup({})
  })
}
