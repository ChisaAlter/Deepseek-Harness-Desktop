'use strict';

/** Localized welcome copy and write-only credential actions (upstream preload-welcome). */

const { contextBridge, ipcRenderer } = require('electron');
const { resolveDesktopLocale } = require('../main/desktop-locale');

const IPC = {
  saveApiKey: 'dsh-welcome:save-api-key',
  skip: 'dsh-welcome:skip',
  start: 'dsh-welcome:start',
  cancel: 'dsh-welcome:cancel',
  copyLink: 'dsh-welcome:copy-link',
  state: 'dsh-welcome:state',
  takeNotice: 'dsh-welcome:take-notice',
};

const prefix = '--dsh-welcome-locale=';
const locale = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
if (locale === undefined) throw new Error('dshd welcome: missing window locale');
const api = {
  ...resolveDesktopLocale(locale),
  takeNotice: () => ipcRenderer.invoke(IPC.takeNotice),
  startSignIn: () => ipcRenderer.invoke(IPC.start),
  cancelSignIn: (id) => ipcRenderer.invoke(IPC.cancel, id),
  copySignInLink: (id) => ipcRenderer.invoke(IPC.copyLink, id),
  onAccountState: (listener) => {
    const receive = (_event, state) => { listener(state); };
    ipcRenderer.on(IPC.state, receive);
    return () => { ipcRenderer.removeListener(IPC.state, receive); };
  },
  saveApiKey: (value) => ipcRenderer.invoke(IPC.saveApiKey, value),
  skip: () => ipcRenderer.invoke(IPC.skip),
};
contextBridge.exposeInMainWorld('dshWelcome', api);
