'use strict';
// Pont minimal et typé entre la page et l'application (contextIsolation + sandbox : pas d'accès Node côté page).
const { contextBridge, ipcRenderer } = require('electron');

const nativeApi = {
  platform: process.platform,
  pickFolder: initial => ipcRenderer.invoke('asm:pick-folder', typeof initial === 'string' ? initial : ''),
  setAttention: n => ipcRenderer.send('asm:attention', Number(n) || 0),
  focus: () => ipcRenderer.send('asm:focus'),
  notify: (title, body, id) => ipcRenderer.send('asm:notify', { title: String(title || ''), body: String(body || ''), id: String(id || '') }),
  setPrefs: p => ipcRenderer.send('asm:prefs', { minimizeToTray: !!p.minimizeToTray, closeToTray: !!p.closeToTray }),
  appVersion: () => ipcRenderer.sendSync('asm:app-version'),
  restartServer: () => ipcRenderer.invoke('asm:restart-server'),
  relaunchApp: () => ipcRenderer.invoke('asm:relaunch-app'),
  update: action => ipcRenderer.invoke('asm:update', ['check', 'install', 'state'].includes(action) ? action : 'state'),
  onUpdate: cb => { const h = (e, st) => cb(st); ipcRenderer.on('asm:update-state', h); return () => ipcRenderer.removeListener('asm:update-state', h); },
  onAction: cb => {
    const h = (e, action) => { if (typeof action === 'string') cb(action); };
    ipcRenderer.on('asm:action', h);
    return () => ipcRenderer.removeListener('asm:action', h);
  },
};

contextBridge.exposeInMainWorld('smNative', nativeApi);
contextBridge.exposeInMainWorld('asmNative', nativeApi);
contextBridge.exposeInMainWorld('csmNative', nativeApi);
