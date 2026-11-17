// Roda dentro da página do WhatsApp Web (mundo principal), depois da
// biblioteca wa-js (global WPP). Expõe window.__figrano para o processo
// principal chamar e publica eventos via postMessage, que o preload repassa.
(() => {
  if (window.__figrano) return;

  const post = (type, payload) => {
    window.postMessage({ __figrano: true, type, payload: payload ?? null }, window.location.origin);
  };
  const wid = (id) => (id && (id._serialized || String(id))) || '';

  const chatInfo = (chat) => {
    if (!chat) return null;
    const chatId = wid(chat.id);
    const contact = chat.contact || {};
    return {
      chatId,
      name: contact.name || contact.pushname || chat.formattedTitle || chat.name || '',
      isGroup: chatId.endsWith('@g.us'),
    };
  };

  const connState = () => {
    try {
      // A ordem importa: na tela do QR code isMainReady() já devolve true.
      if (!WPP.conn.isAuthenticated()) return 'qr';
      return WPP.conn.isMainReady() ? 'ready' : 'syncing';
    } catch {
      return 'loading';
    }
  };

  const me = () => {
    try {
      const id = WPP.conn.getMyUserId();
      return id ? { chatId: wid(id), phone: String(id.user || '') } : null;
    } catch {
      return null;
    }
  };

  const publishState = () => post('state', { state: connState(), me: me() });

  const start = () => {
    WPP.on('conn.require_auth', publishState);
    WPP.on('conn.authenticated', publishState);
    WPP.on('conn.main_loaded', publishState);
    WPP.on('conn.main_ready', publishState);
    WPP.on('conn.logout', () => post('state', { state: 'qr', me: null }));

    WPP.on('chat.active_chat', (chat) => post('active_chat', chatInfo(chat)));

    WPP.on('chat.new_message', (msg) => {
      try {
        const fromMe = Boolean(msg.id && msg.id.fromMe);
        const chatId = wid(fromMe ? msg.to : msg.from);
        post('message', {
          id: wid(msg.id),
          chatId,
          fromMe,
          type: msg.type,
          text: msg.type === 'chat' ? (msg.body || '') : (msg.caption || ''),
          name: msg.notifyName || (msg.senderObj && msg.senderObj.pushname) || '',
          timestamp: Number(msg.t) || 0,
          isNew: msg.isNewMsg !== false,
          location: msg.type === 'location' ? { lat: Number(msg.lat), lng: Number(msg.lng) } : null,
        });
      } catch (error) {
        post('error', { where: 'new_message', message: String(error && error.message) });
      }
    });

    publishState();
    post('active_chat', chatInfo(WPP.chat.getActiveChat()));
  };

  window.__figrano = {
    state: () => ({ state: connState(), me: me() }),

    async sendText(chatId, text) {
      await WPP.chat.sendTextMessage(chatId, text, { createChat: true });
      return true;
    },

    async typing(chatId, ms) {
      await WPP.chat.markIsComposing(chatId, ms);
      return true;
    },

    activeChat: () => chatInfo(WPP.chat.getActiveChat()),

    async openChat(chatId) {
      await WPP.chat.openChatBottom(chatId);
      return true;
    },

    /** Arquiva conversas individuais sem atividade há mais de `days` dias. */
    async archiveOld(days, limit = 200) {
      const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
      const chats = await WPP.chat.list({ onlyUsers: true });
      let archived = 0;
      for (const chat of chats) {
        if (archived >= limit) break;
        if (chat.archive || !chat.t || chat.t > cutoff) continue;
        try {
          await WPP.chat.archive(chat.id, true);
          archived += 1;
        } catch {
          // segue para a próxima conversa
        }
      }
      return archived;
    },
  };

  if (WPP.isFullReady) start();
  else WPP.loader.onFullReady(start);
})();
