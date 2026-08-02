const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fw', {
  // 类别定义走 IPC 从主进程取（预加载脚本在沙箱里不能 require 任意文件），保证与主进程同一份
  getCategories: () => ipcRenderer.invoke('app:categories'),
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
