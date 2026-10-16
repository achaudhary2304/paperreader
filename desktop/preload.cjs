const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paperlensDesktop', {
  setWebpageAnnotations: payload => ipcRenderer.invoke('webpage:annotations', payload),
  showWebpage: options => ipcRenderer.invoke('webpage:show', options),
  hideWebpage: () => ipcRenderer.invoke('webpage:hide'),
  onWebpageEvent: callback => { const handler = (_event, data) => callback(data); ipcRenderer.on('webpage:event', handler); return () => ipcRenderer.removeListener('webpage:event', handler); },
  getProviderSettings: () => ipcRenderer.invoke('provider-settings:get'),
  saveProviderSettings: changes => ipcRenderer.invoke('provider-settings:save', changes),
  setZenMode: active => ipcRenderer.invoke('reader:zen', active),
  onOpenProviderSettings: callback => ipcRenderer.on('provider-settings:open', () => callback()),
});
