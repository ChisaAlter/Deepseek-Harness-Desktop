'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { PREVIEW_PIP_FRAME_CHANNEL } = require('./preview-pip-protocol');

contextBridge.exposeInMainWorld('previewPictureInPicture', {
  onFrame(listener) {
    const wrappedListener = (_event, frame) => {
      if (typeof frame !== 'object' || frame === null) return;
      listener(frame);
    };
    ipcRenderer.on(PREVIEW_PIP_FRAME_CHANNEL, wrappedListener);
    return () => ipcRenderer.removeListener(PREVIEW_PIP_FRAME_CHANNEL, wrappedListener);
  },
});
