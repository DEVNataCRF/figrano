'use strict';

const { randomBytes } = require('node:crypto');

const POLL_MS = 5000;
const SYNC_DEBOUNCE_MS = 1500;
const LINK_TTL_MS = 3 * 24 * 60 * 60e3;

/**
 * Ligação entre o app desktop e a página de pedido online.
 * O app é quem fala com o servidor: envia o cardápio, busca os pedidos novos
 * (o servidor não tem como chegar até este computador) e avisa os status.
 */
class OnlineSync {
  /**
   * @param {object} deps
   * @param {import('./store').Store} deps.store
   * @param {() => string} deps.getToken token da loja em texto, ou ''
   * @param {(order: object) => Promise<object>} deps.importOrder cria o pedido local e devolve-o
   * @param {() => string} [deps.getWhatsapp] telefone da loja conectado no WhatsApp
   * @param {(hash: string) => Buffer|null} [deps.readImage] bytes de uma foto salva
   * @param {typeof fetch} [deps.fetch]
   */
  constructor({
    store, getToken, importOrder, getWhatsapp = () => '', readImage = () => null, fetch: fetchImpl = globalThis.fetch,
  }) {
    this.store = store;
    this.getToken = getToken;
    this.importOrder = importOrder;
    this.getWhatsapp = getWhatsapp;
    this.readImage = readImage;
    this.fetch = fetchImpl;
    this.pollTimer = null;
    this.syncTimer = null;
    this.polling = false;
    this.lastError = '';
    this.lastOkAt = 0;
  }

  get settings() { return this.store.settings.online; }

  active() {
    return Boolean(this.settings.enabled && this.settings.apiUrl && this.getToken());
  }

  async request(method, pathname, body, token = this.getToken()) {
    let response;
    try {
      response = await this.fetch(`${this.settings.apiUrl.replace(/\/+$/, '')}${pathname}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('Sem conexão com o servidor de pedidos online.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erro do servidor (${response.status}).`);
    return data;
  }

  /** Cadastra a loja no servidor e devolve { token, url, slug }. */
  async register(apiUrl, slug) {
    this.store.updateSettings('online', { apiUrl: String(apiUrl).trim().replace(/\/+$/, '') });
    const data = await this.request('POST', '/api/stores', { slug, name: this.store.settings.store.name }, '');
    return data;
  }

  start() {
    this.stop();
    if (!this.active()) return;
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
    this.sync();
    this.poll();
  }

  stop() {
    clearInterval(this.pollTimer);
    clearTimeout(this.syncTimer);
    this.pollTimer = null;
  }

  /** Agenda o envio do cardápio (várias mudanças seguidas viram um envio só). */
  scheduleSync() {
    if (!this.active()) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), SYNC_DEBOUNCE_MS);
  }

  snapshot() {
    const s = this.store.settings.store;
    return {
      info: {
        name: s.name, address: s.address, phone: s.phone, hours: s.hours, deliveryFee: s.deliveryFee,
        minOrder: s.minOrder, prepMinutes: s.prepMinutes, payments: s.payments, delivery: s.delivery,
        pickup: s.pickup, whatsapp: this.getWhatsapp() || s.phone || '', logo: s.logo || '', cover: s.cover || '',
      },
      menu: this.store.menu.categories.map((category) => ({
        id: category.id,
        name: category.name,
        items: category.items.map(({ id, name, description, price, available, photo }) => ({
          id, name, description, price, available, photo: photo || '',
        })),
      })),
    };
  }

  async sync() {
    if (!this.active()) return;
    try {
      const data = await this.request('PUT', '/api/store/sync', this.snapshot());
      if (data.url && data.url !== this.settings.url) this.store.updateSettings('online', { url: data.url });
      // O servidor diz quais fotos ainda não tem; manda só essas.
      for (const hash of data.missingImages || []) await this.uploadImage(hash);
      this.ok();
    } catch (error) {
      this.fail(error);
    }
  }

  async uploadImage(hash) {
    const bytes = this.readImage(hash);
    if (!bytes) return;
    let response;
    try {
      response = await this.fetch(`${this.settings.apiUrl.replace(/\/+$/, '')}/api/store/images/${hash}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${this.getToken()}` },
        body: bytes,
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error('Sem conexão com o servidor de pedidos online.');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Falha ao enviar foto (${response.status}).`);
    }
  }

  /** Busca pedidos novos e traz cada um para o painel. */
  async poll() {
    if (!this.active() || this.polling) return;
    this.polling = true;
    try {
      const { orders = [] } = await this.request('GET', '/api/store/orders');
      for (const remote of orders) {
        // Se a confirmação falhou da outra vez, o pedido já existe aqui: só confirma de novo.
        const local = this.store.orderByOnlineId(remote.id) || await this.importOrder(remote);
        await this.request('PATCH', `/api/store/orders/${remote.id}`, { status: local.status, number: local.number });
      }
      this.ok();
    } catch (error) {
      this.fail(error);
    } finally {
      this.polling = false;
    }
  }

  /** Repassa ao servidor a mudança de status de um pedido feito pela página. */
  async pushStatus(order) {
    if (!order?.onlineId || !this.active()) return;
    try {
      await this.request('PATCH', `/api/store/orders/${order.onlineId}`, { status: order.status, number: order.number });
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Link da página para uma conversa. O código no fim do link liga o pedido
   * que voltar à conversa certa do WhatsApp, mesmo que o cliente digite outro número.
   */
  linkFor(chatId) {
    if (!this.active() || !this.settings.url) return null;
    const links = this.store.data.links;
    const now = Date.now();
    let ref = Object.keys(links).find((key) => links[key].chatId === chatId && now - links[key].at < LINK_TTL_MS);
    if (!ref) {
      for (const key of Object.keys(links)) if (now - links[key].at >= LINK_TTL_MS) delete links[key];
      ref = randomBytes(6).toString('hex');
    }
    links[ref] = { chatId, at: now };
    this.store.changed('links');
    return `${this.settings.url}?r=${ref}`;
  }

  chatIdForRef(ref) {
    return (ref && this.store.data.links[ref]?.chatId) || '';
  }

  ok() {
    this.lastOkAt = Date.now();
    if (this.lastError) { this.lastError = ''; this.store.changed('online'); }
  }

  fail(error) {
    const message = error?.message || String(error);
    if (message !== this.lastError) {
      this.lastError = message;
      console.error('[online]', message);
      this.store.changed('online');
    }
  }
}

module.exports = { OnlineSync, POLL_MS };
