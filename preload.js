const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pen', {
  platform: process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux',
  play: (g, install) => ipcRenderer.invoke('play', { game: g, install }),
  cancelDl: () => ipcRenderer.invoke('dl:cancel'),
  setExe: (o) => ipcRenderer.invoke('exe:set', o),
  openFolder: (id) => ipcRenderer.invoke('folder:open', id),
  dataPath: () => ipcRenderer.invoke('data:path'),
  dl: (o) => ipcRenderer.invoke('dl', o),
  ext: (u) => ipcRenderer.invoke('open:ext', u),
  onProgress: (cb) => ipcRenderer.on('dl:progress', (_e, o) => cb(o)),
  page: (u, render) => ipcRenderer.invoke('page', u, !!render),
  img: (u) => ipcRenderer.invoke('img', u),
  inst: () => ipcRenderer.invoke('inst:list'),
  uninstall: (id) => ipcRenderer.invoke('inst:remove', id),
  lib: () => ipcRenderer.invoke('lib:get'),
  libToggle: (g) => ipcRenderer.invoke('lib:toggle', g),
  addUrl: (u) => ipcRenderer.invoke('lib:addurl', u),
  clearSave: (id) => ipcRenderer.invoke('save:clear', id)
});
