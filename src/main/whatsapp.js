'use strict';

const { WebContentsView, ipcMain, shell, session } = require('electron');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const WA_URL = 'https://web.whatsapp.com/';
const PARTITION = 'persist:whatsapp';
const ALLOWED_PERMISSIONS = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write']);

/** Visão embutida do WhatsApp Web e ponte de comandos/eventos com a página. */
class WhatsApp extends EventEmitter {
  /** @param {import('electron').BrowserWindow} window */
  constructor(window) {
    super();
    this.window = window;
    this.view = null;
    this.state = 'loading'; // loading | qr | syncing | ready | error
    this.me = null;
    this.activeChat = null;
    this.visible = false;
    this.bounds = null;
    this.scripts = null;

    ipcMain.on('wa:event', (event, message) => {
      if (!this.view || event.sender !== this.view.webContents) return;
      this.onPageEvent(message);
    });
  }

  loadScripts() {
    if (!this.scripts) {
      // O pacote só expõe a entrada principal, que é o próprio arquivo para navegador.
      const waJs = require.resolve('@wppconnect/wa-js');
      this.scripts = {
        waJs: fs.readFileSync(waJs, 'utf8'),
        bridge: fs.readFileSync(path.join(__dirname, '..', 'inject', 'bridge.js'), 'utf8'),
      };
    }
    return this.scripts;
  }

  create() {
    const waSession = session.fromPartition(PARTITION);
    waSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
    // O WhatsApp Web recusa navegadores que se identificam como Electron.
    const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
    waSession.setUserAgent(userAgent);

    this.view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'whatsapp.preload.js'),
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const wc = this.view.webContents;

    wc.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (!url.startsWith(WA_URL)) event.preventDefault();
    });
    wc.on('did-finish-load', () => this.inject());
    wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.setState('error', description);
    });
    wc.on('render-process-gone', () => {
      this.setState('loading');
      setTimeout(() => this.reload(), 1500);
    });

    this.window.contentView.addChildView(this.view);
    this.view.setVisible(false);
    wc.loadURL(WA_URL);
  }

  async inject() {
    const wc = this.view.webContents;
    if (!wc.getURL().startsWith(WA_URL)) return;
    try {
      const { waJs, bridge } = this.loadScripts();
      await wc.executeJavaScript(`if (!window.WPP) { ${waJs}\n }; true;`);
      await wc.executeJavaScript(`${bridge}\n; true;`);
    } catch (error) {
      this.setState('error', `Falha ao preparar o WhatsApp: ${error.message}`);
    }
  }

  onPageEvent({ type, payload }) {
    if (type === 'state' && payload) {
      this.me = payload.me || null;
      this.setState(payload.state);
    } else if (type === 'active_chat') {
      this.activeChat = payload;
      this.emit('active_chat', payload);
    } else if (type === 'message' && payload) {
      this.emit('message', payload);
    } else if (type === 'error') {
      console.error('[whatsapp] erro na página:', payload);
    }
  }

  setState(state, detail = '') {
    const changed = state !== this.state || detail !== this.detail;
    this.state = state;
    this.detail = detail;
    if (changed) this.emit('state', state);
  }

  get ready() { return this.state === 'ready'; }

  /** Executa uma função de window.__figrano na página e devolve o resultado. */
  async call(fn, ...args) {
    if (!this.view) throw new Error('WhatsApp não iniciado.');
    const code = `window.__figrano.${fn}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`;
    return this.view.webContents.executeJavaScript(code);
  }

  /** @param {{x:number,y:number,width:number,height:number}|null} bounds null esconde a visão */
  layout(bounds) {
    if (!this.view) return;
    if (!bounds) {
      this.visible = false;
      this.view.setVisible(false);
      return;
    }
    this.bounds = {
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)), height: Math.max(0, Math.round(bounds.height)),
    };
    this.view.setBounds(this.bounds);
    this.visible = true;
    this.view.setVisible(true);
  }

  reload() {
    if (!this.view) return;
    this.setState('loading');
    this.view.webContents.loadURL(WA_URL);
  }

  snapshot() {
    return { state: this.state, detail: this.detail || '', me: this.me, activeChat: this.activeChat };
  }
}

module.exports = { WhatsApp };
