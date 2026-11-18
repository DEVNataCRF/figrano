'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('figrano', {
  /** Chama um método do processo principal. Rejeita com a mensagem de erro em português. */
  call: (method, ...args) => ipcRenderer.invoke('api', { method, args }),

  /** Avisa quando algum dado mudou; devolve a função para cancelar a inscrição. */
  onChange: (listener) => {
    const handler = (_event, topic) => listener(topic);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },

  /** Alerta sonoro: 'pedido' ou 'sil'. */
  onAlert: (listener) => {
    const handler = (_event, kind) => listener(kind);
    ipcRenderer.on('alert', handler);
    return () => ipcRenderer.removeListener('alert', handler);
  },

  /** O processo principal pede para abrir uma seção (ex.: clique numa notificação). */
  onNavigate: (listener) => {
    const handler = (_event, target) => listener(target);
    ipcRenderer.on('navigate', handler);
    return () => ipcRenderer.removeListener('navigate', handler);
  },
});
