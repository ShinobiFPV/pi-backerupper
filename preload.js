const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  browseFolder: () => ipcRenderer.invoke('browse-folder'),
  browseScript: () => ipcRenderer.invoke('browse-script'),
  testConnection: () => ipcRenderer.invoke('test-connection'),
  runBackup: (o) => ipcRenderer.invoke('run-backup', o),
  cancelBackup: () => ipcRenderer.invoke('cancel-backup'),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  minimize: () => ipcRenderer.invoke('minimize'),
  close: () => ipcRenderer.invoke('close'),
  onLog: (cb) => ipcRenderer.on('backup-log', (_, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on('backup-done', (_, data) => cb(data)),
})
