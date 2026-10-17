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
  chooseLibraryFolder: () => ipcRenderer.invoke('library:choose-folder'),
  scanLibraryFolders: () => ipcRenderer.invoke('library:scan-folders'),
  scanLibraryFolder: folderId => ipcRenderer.invoke('library:scan-folder', folderId),
  readLibraryPdf: fileId => ipcRenderer.invoke('library:read-pdf', fileId),
  removeLibraryFolder: folderId => ipcRenderer.invoke('library:remove-folder', folderId),
});
