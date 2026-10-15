const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paperlensDesktop', {
  getProviderSettings: () => ipcRenderer.invoke('provider-settings:get'),
  saveProviderSettings: changes => ipcRenderer.invoke('provider-settings:save', changes),
  setZenMode: active => ipcRenderer.invoke('reader:zen', active),
  onOpenProviderSettings: callback => ipcRenderer.on('provider-settings:open', () => callback()),
});
