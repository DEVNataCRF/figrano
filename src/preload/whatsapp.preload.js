'use strict';

// Preload da visão do WhatsApp Web. Roda isolado da página: só repassa ao
// processo principal os eventos que o bridge.js publica via postMessage.
const { ipcRenderer } = require('electron');

const ALLOWED = new Set(['state', 'message', 'active_chat', 'error']);

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.__figrano !== true || !ALLOWED.has(data.type)) return;
  ipcRenderer.send('wa:event', { type: data.type, payload: data.payload });
});
