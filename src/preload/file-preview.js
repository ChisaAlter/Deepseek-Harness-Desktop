'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('filePreview', {
  getState: () => ipcRenderer.invoke('shell:file-preview-state'),
  onTheme(handler) {
    const listener = (_event, theme) => handler(theme);
    ipcRenderer.on('shell:theme', listener);
    return () => ipcRenderer.removeListener('shell:theme', listener);
  },
});
