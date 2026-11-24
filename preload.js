const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pen', {
  search: (o) => ipcRenderer.invoke('search', o),
  play: (g, install) => ipcRenderer.invoke('play', { game: g, install }),
  details: (u) => ipcRenderer.invoke('details', u),
  inst: () => ipcRenderer.invoke('inst:list'),
  uninstall: (id) => ipcRenderer.invoke('inst:remove', id),
  lib: () => ipcRenderer.invoke('lib:get'),
  libToggle: (g) => ipcRenderer.invoke('lib:toggle', g),
  addUrl: (u) => ipcRenderer.invoke('lib:addurl', u),
  clearSave: (id) => ipcRenderer.invoke('save:clear', id)
});
