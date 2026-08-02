const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fw', {
  showPlatform: (id) => ipcRenderer.invoke('platform:show', id),
  getProfile: () => ipcRenderer.invoke('profile:get'),
  setProfile: (profile) => ipcRenderer.invoke('profile:set', profile),
  listPackages: () => ipcRenderer.invoke('package:list'),
  pickImages: (kind) => ipcRenderer.invoke('package:pick-images', kind),
  createPackage: (data, imagePaths, scenePaths) => ipcRenderer.invoke('package:create', { data, imagePaths, scenePaths }),
  previewPackage: (args) => ipcRenderer.invoke('package:preview', args),
  updatePackage: (args) => ipcRenderer.invoke('package:update', args),
  savePackageFull: (args) => ipcRenderer.invoke('package:save', args),
  deletePackage: (id) => ipcRenderer.invoke('package:delete', id),
  runPublish: (args) => ipcRenderer.invoke('publish:run', args),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  pausePublish: (paused) => ipcRenderer.invoke('publish:pause', paused),
  abortPublish: () => ipcRenderer.invoke('publish:abort'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openMiniapp: (args) => ipcRenderer.invoke('miniapp:open', args),
  onLog: (cb) => ipcRenderer.on('log', (_e, msg) => cb(msg)),
});
