'use strict';

const {
  money, isOpen, storeOpen, hoursText, allClosed, menuText, cartText, cartTotal, orderSummary, STATUS_LABELS,
} = require('./format');
const { parseFreeOrder } = require('./free-order');
const { parseReview, reviewThanks } = require('./avisos');
const { answerFaq } = require('./respostas');
const { findNeighborhood, neighborhoodsText } = require('./bairros');
const { fixStreetName } = require('./ruas');

const SESSION_TTL_MS = 2 * 60 * 60e3; // conversa parada por 2 h recomeça do zero
const CLOSED_NOTICE_GAP_MS = 30 * 60e3; // não repete o aviso de loja fechada a cada mensagem

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const hasAny = (text, words) => words.some((word) => text.includes(word));

/** Distância de edição (letra trocada, faltando ou sobrando) */
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Comando curto com erro de digitação: "frchar" → fechar, "carrnho" → carrinho.
 * Só para mensagem de uma palavra e comandos de 5+ letras (1 erro; 2 erros com 6+ letras, como "fexar").
 */
const typo = (text, words) => {
  const t = text.trim();
  if (!t || /\s/.test(t) || t.length < 4) return false;
  return words.some((w) => w.length >= 5 && editDistance(t, w) <= (w.length >= 6 ? 2 : 1));
};

const INTENTS = {
  human: ['atendente', 'humano', 'pessoa de verdade', 'falar com alguem', 'falar com uma pessoa', 'reclamacao', 'reclamar',
    'falar com a sil', 'falar com a dona', 'falar com o dono', 'a dona', 'responsavel', 'gerente', 'falar com voce de verdade'],
  // Confirmação do pedido pronto: o SISTEMA envia (não a IA), para nunca dizer "enviado" sem enviar
  confirm: ['sim', 'pode mandar', 'pode enviar', 'manda', 'confirmo', 'confirmar', 'confirma', 'isso mesmo', 'fechado', 'pode fechar', 'ok pode', 'ta certo', 'esta certo', 'certinho'],
  status: ['meu pedido', 'status', 'cade', 'onde esta', 'vai demorar', 'ja saiu', 'demora', 'acompanhar', 'rastrear', 'chegou', 'ja vem', 'previsao'],
  hours: ['horario', 'que horas', 'abre', 'fecha', 'aberto', 'funcionamento'],
  address: ['endereco', 'onde fica', 'localizacao', 'como chegar'],
  menu: ['cardapio', 'menu', 'pedido', 'pedir', 'quero', 'opcoes', 'o que tem'],
  greeting: ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'opa', 'e ai', 'eai'],
  // Assunto de festa/buffet: quem responde é a Canela (regras de preço e de data do buffet)
  festa: ['festa', 'buffet', 'bufe', 'aniversario', 'casamento', 'evento', 'orcamento', 'formatura',
    'batizado', 'cha de bebe', 'cha de panela', 'cha revelacao', 'confraternizacao', 'convidados', 'encomenda'],
  delivery: ['delivery', 'cardapio do dia', 'entrega agora', 'pedir agora'],
  // Cliente prefere pedir pela conversa: lista numerada em texto
  list: ['lista', 'por aqui', 'pela conversa', 'pelo whatsapp'],
  // Pedido explícito de cardápio: SEMPRE o link do cardápio digital, com ou sem IA
  menuLink: ['cardapio', 'menu', 'o que tem', 'o que voces tem', 'opcoes'],
};

/** Encomendas de Natal (palavra inteira: "Natália" não é Natal) */
const NATAL_RE = /\b(natal|natalina|ceia|chester|ano novo|reveillon|fim de ano)\b/;

const FESTA_TOPIC_MS = 30 * 60e3; // depois de falar de festa, a conversa segue com a Canela por 30 min

/**
 * Lê uma seleção de itens do cardápio numerado.
 * Aceita "3", "2x3" (duas unidades do item 3) e listas separadas por
 * vírgula, "e" ou quebra de linha. Devolve null se algo não for seleção.
 */
function parseSelection(text) {
  const parts = normalize(text).split(/\s*(?:,|;|\n| e )\s*/).filter(Boolean);
  if (parts.length === 0) return null;
  const picks = [];
  for (const part of parts) {
    let match = part.match(/^(\d{1,2})\s*x\s*(\d{1,3})$/);
    if (match) {
      picks.push({ qty: Number(match[1]), number: Number(match[2]) });
      continue;
    }
    match = part.match(/^(\d{1,3})$/);
    if (match) {
      picks.push({ qty: 1, number: Number(match[1]) });
      continue;
    }
    return null;
  }
  return picks;
}

/**
 * Endereço falado ou escrito como conversa → endereço para a comanda:
 * "Eu moro na Rua X, 423, no centro e o complemento é casa azul."
 *   → "Rua X, 423, centro, complemento: casa azul"
 */
function cleanAddress(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(ent[aã]o|bom|olha|[eé]|ah)[,\s]+/i, '')
    .replace(/^(o )?(meu )?endere[cç]o (de entrega )?([eé]|fica)[:\s]+/i, '')
    .replace(/^(eu )?(moro|fico|to|t[oô]|estou|resido)( aqui)? (na|no|em)\s+/i, '')
    .replace(/^(pode )?(entregar|entrega|mandar|manda|levar|leva) (aqui )?(na|no|em|pra|para)\s+/i, '')
    .replace(/,?\s*e o complemento [eé]:?\s*/i, ', complemento: ')
    .replace(/,\s*n[oa]\s+(?=\S)/gi, ', ')
    .replace(/\s+n[oa] (bairro )/gi, ', $1')
    .replace(/[.\s]+$/, '')
    .trim();
}

/** Mensagem com cara de endereço: logradouro + número */
function looksLikeAddress(text) {
  return /\b(rua|r|avenida|av|travessa|tv|praca|rodovia|estrada|alameda|beco)\b/.test(text) && /\d/.test(text);
}

function confirmHint(session) {
  return session.mode === 'delivery'
    ? 'Responda *1* para confirmar, *2* para cancelar ou *3* para corrigir o endereço.'
    : 'Responda *1* para confirmar ou *2* para cancelar.';
}

/** "qual a taxa?", "quanto fica a entrega", "aceita cartão?": é pergunta, não informação do pedido */
function isQuestion(text) {
  const t = normalize(text);
  return /\?\s*$/.test(String(text).trim())
    || /^(qual|quais|quanto|quantos|quando|como|onde|tem|voces|vcs|vc|aceita|aceitam|pode|da pra|e a|e o)\b/.test(t);
}

/** Quantidade máxima de um item (a API aceita até 500; cento de salgado é comum) */
const MAX_QTY = 500;

/**
 * Seleções no meio de uma frase: "vou querer 1x100 e 2x3". Se o número depois do "x" não é
 * item do cardápio mas o de antes é, o cliente inverteu: "1x100" = 100 unidades do item 1.
 */
function findSelections(text, itemCount) {
  const picks = [];
  for (const m of normalize(text).matchAll(/(\d{1,3})\s*x\s*(\d{1,3})/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (b >= 1 && b <= itemCount) picks.push({ qty: a, number: b });
    else if (a >= 1 && a <= itemCount) picks.push({ qty: b, number: a });
  }
  return picks;
}

/** "3 itens, R$ 45,00" para lembrar o carrinho */
function cartTotalText(cart) {
  const qty = cart.reduce((n, l) => n + l.qty, 0);
  return `${qty} ${qty === 1 ? 'item' : 'itens'}, ${money(cartTotal(cart))}`;
}

const phoneDigits = (value) => String(value || '').replace(/\D/g, '');

/** Só IDs "@c.us" carregam o telefone; "@lid" é um número interno do WhatsApp. */
function phoneFromChatId(chatId) {
  return String(chatId || '').endsWith('@c.us') ? phoneDigits(chatId.split('@')[0]) : '';
}

function parseMoney(text) {
  const match = normalize(text).replace(/r\$/g, '').match(/(\d+(?:[.,]\d{1,2})?)/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

class BotEngine {
  /**
   * @param {object} deps
   * @param {import('../store').Store} deps.store
   * @param {{available: () => boolean, reply: Function}|null} [deps.ai]
   * @param {() => Date} [deps.now]
   * @param {(chatId: string) => string|null} [deps.onlineLink] link da página de pedido, se ligada
   * @param {(input: {message: string, history: object[]}) => Promise<{reply: string, link?: string}|null>} [deps.livia]
   *   Canela, assistente do buffet (API do Sabores): responde tudo sobre festa
   */
  constructor({
    store, ai = null, now = () => new Date(), onlineLink = () => null, livia = null,
    trackingLink = () => null, onReview = null, buffetLink = () => '', natalLink = () => '',
  }) {
    this.store = store;
    this.livia = livia;
    /** Link da página de acompanhamento de um pedido (site) */
    this.trackingLink = trackingLink;
    /** Grava a nota do cliente na API: (orderId, rating, comment) => Promise */
    this.onReview = onReview;
    /** Página de orçamento do site do buffet (WhatsApp só com o robô: a Canela fica no site) */
    this.buffetLink = buffetLink;
    /** Seção de Natal do site do buffet; vazio = temporada fechada */
    this.natalLink = natalLink;
    this.ai = ai;
    this.now = now;
    this.onlineLink = onlineLink;
    // Conversas em andamento voltam do disco (app reiniciado no meio de um pedido não perde o carrinho)
    const nowMs = this.now().getTime();
    const saved = Object.entries(this.store.loadSessions?.() || {})
      .filter(([, s]) => s && nowMs - (s.touchedAt || 0) <= SESSION_TTL_MS);
    this.sessions = new Map(saved);
  }

  /** Grava as conversas recentes (as paradas há mais de 2 h saem). */
  persistSessions() {
    if (!this.store.saveSessions) return;
    const nowMs = this.now().getTime();
    const keep = {};
    for (const [chatId, s] of this.sessions) if (nowMs - s.touchedAt <= SESSION_TTL_MS) keep[chatId] = s;
    this.store.saveSessions(keep);
  }

  session(chatId) {
    const nowMs = this.now().getTime();
    let session = this.sessions.get(chatId);
    if (!session || nowMs - session.touchedAt > SESSION_TTL_MS) {
      session = {
        chatId, state: 'idle', cart: [], mode: null, address: '', neighborhood: '', payment: '',
        changeFor: null, closedNoticeAt: 0, history: [], touchedAt: nowMs,
      };
      this.sessions.set(chatId, session);
    }
    session.touchedAt = nowMs;
    return session;
  }

  /** "Reativar robô": a conversa recomeça sem o assunto de festa pendurado. */
  forgetTopic(chatId) {
    const session = this.sessions.get(chatId);
    if (!session) return;
    session.festaAt = 0;
    this.persistSessions();
  }

  resetOrder(session) {
    Object.assign(session, { state: 'idle', cart: [], mode: null, address: '', neighborhood: '', payment: '', changeFor: null, summaryShown: false });
  }

  /**
   * Processa uma mensagem recebida.
   * @param {{chatId: string, name?: string, type: 'chat'|'location'|'image'|'ptt', text?: string,
   *          location?: {lat: number, lng: number}}} msg
   * @returns {Promise<{replies: string[], effects: object[]}>}
   */
  /**
   * Mensagem do cliente → respostas do robô. Áudio transcrito chega aqui como texto comum
   * (sem repetir o que foi ouvido: num pedido, o resumo "Confira seu pedido" já serve de conferência).
   */
  async handle(msg) {
    try {
      return await this.handleMessage(msg);
    } finally {
      this.persistSessions();
    }
  }

  async handleMessage(msg) {
    const out = { replies: [], effects: [] };
    const settings = this.store.settings;

    // Robô desligado ou em "só avisos" não responde ninguém.
    if (settings.bot.status !== 'active') return out;
    if (this.store.isPaused(msg.chatId, this.now().getTime())) return out;

    // Resposta ao pedido de avaliação ("5", "nota 4", "⭐⭐⭐⭐⭐"): o robô grava e agradece
    const pendingReview = this.store.pendingReview?.(msg.chatId, this.now().getTime());
    if (pendingReview && msg.type === 'chat') {
      const review = parseReview(msg.text);
      if (review) {
        this.store.clearPendingReview(msg.chatId);
        try {
          if (this.onReview) await this.onReview(pendingReview.orderId, review.rating, review.comment);
        } catch (error) {
          out.effects.push({ type: 'review_error', message: error?.message || String(error) });
        }
        out.replies.push(reviewThanks(review.rating));
        out.effects.push({ type: 'review', orderId: pendingReview.orderId, number: pendingReview.number, rating: review.rating, comment: review.comment });
        if (review.rating <= 3) {
          this.store.addHandoff({
            chatId: msg.chatId, name: msg.name || '', phone: msg.phone || '',
            motive: `Avaliação ${review.rating}/5 do pedido #${pendingReview.number}${review.comment ? `: ${review.comment}` : ''}`,
            priority: 'high', mood: 'frustrated',
          });
        }
        return out;
      }
    }

    const session = this.session(msg.chatId);
    session.name = msg.name || session.name || '';
    session.phone = phoneDigits(msg.phone) || session.phone || phoneFromChatId(msg.chatId);

    let text = msg.text || '';
    if (msg.type === 'location' && msg.location) {
      text = `Localização: https://maps.google.com/?q=${msg.location.lat},${msg.location.lng}`;
    } else if (msg.type === 'ptt') {
      out.replies.push('Não consegui ouvir seu áudio. Pode escrever sua mensagem, por favor?');
      return out;
    } else if (msg.type === 'image' && !text) {
      out.replies.push('Recebi sua imagem. Se precisar de algo, escreva por aqui.');
      return out;
    }
    if (!text.trim()) return out;

    // Pedido completo + "sim/pode mandar": quem envia é o sistema, nunca o texto da IA
    if (this.readyToPlace(session) && session.summaryShown && hasAny(normalize(text), INTENTS.confirm) && !hasAny(normalize(text), ['nao', 'espera', 'muda', 'troca', 'tira', 'mais'])) {
      const result = await this.placeOrder(session, out);
      if (!result.ok) out.replies.push(result.message);
      session.history.push({ role: 'user', text });
      for (const reply of out.replies) session.history.push({ role: 'assistant', text: reply });
      return out;
    }

    const handled = await this.rules(session, text, out);
    if (!handled) {
      const answered = await this.askAi(session, text, out);
      if (!answered) this.fallback(session, out);
    }

    session.history.push({ role: 'user', text });
    for (const reply of out.replies) session.history.push({ role: 'assistant', text: reply });
    if (session.history.length > 24) session.history.splice(0, session.history.length - 24);
    return out;
  }

  // ------------------------------------------------------------------ regras

  /** Devolve true se as regras fixas resolveram a mensagem. */
  rules(session, rawText, out) {
    const text = normalize(rawText);
    const store = this.store.settings.store;

    if (hasAny(text, INTENTS.human)) {
      this.requestHuman(session, out, { motive: rawText.slice(0, 200) });
      return true;
    }

    // Botão "Continuar no WhatsApp" da página do pedido ("...fazer o pedido #214 pelo site...").
    // Vem antes da leitura livre (que leria o 214 como item) e da IA: responde o status.
    if (session.state === 'idle' && /pedido\s*#\s*\d+/i.test(rawText) && /pelo site/i.test(rawText)) {
      this.orderStatus(session, out);
      return true;
    }

    // Pedido em frase livre ("10 coxinhas pra entregar na rua X, pago no pix"): o sistema lê
    // sem IA. Funciona igual com a IA desligada e não depende do modelo para anotar.
    // "50x4 quero experimentar esse churros": quantidade x número vale mais que a leitura livre
    // (que veria "4 churros"). Funciona com ou sem a lista aberta.
    if ((session.state === 'idle' || session.state === 'ordering')
      && findSelections(rawText, this.store.numberedItems().length).length > 0) {
      if (session.state === 'idle') session.state = 'ordering';
      if (this.stateOrdering(session, rawText, text, out)) return true;
    }
    if ((session.state === 'idle' || session.state === 'ordering') && this.applyFreeOrder(session, rawText, out)) return true;

    switch (session.state) {
      case 'ordering': return this.stateOrdering(session, rawText, text, out);
      case 'mode': return this.stateMode(session, text, out);
      case 'address': return this.stateAddress(session, rawText, text, out);
      case 'neighborhood': return this.stateNeighborhood(session, rawText, text, out);
      case 'payment': return this.statePayment(session, text, out);
      case 'change': return this.stateChange(session, text, out);
      case 'confirm': return this.stateConfirm(session, text, out);
      default: break;
    }

    // Natal com a temporada aberta: o link da seção de Natal (texto completo na 1ª vez, curto se repetir em 30 min)
    const natal = NATAL_RE.test(text) ? this.natalLink() : '';
    if (natal) {
      const recent = session.natalAt && this.now().getTime() - session.natalAt < FESTA_TOPIC_MS;
      session.natalAt = this.now().getTime();
      out.replies.push(recent
        ? `O cardápio e a encomenda de Natal ficam aqui: ${natal}`
        : `Oba, encomenda de Natal! 🎄

O cardápio está aqui, com a ceia por pessoa, os combos, os pratos e o chester. É só escolher o dia e mandar:
${natal}

A Sil confirma cada encomenda por aqui, com o valor final. A encomenda fica garantida com 50% de entrada.

🏷️ Importante: leve suas vasilhas ETIQUETADAS com o seu nome.`);
      return true;
    }

    // Festa e buffet: a Canela responde (preço e data seguem as regras do buffet).
    // Depois do primeiro assunto de festa, a conversa fica com ela até o cliente pedir o delivery.
    const festaTopic = session.festaAt && this.now().getTime() - session.festaAt < FESTA_TOPIC_MS;
    // Depois de falar de festa, só segue como "detalhe da festa" o que tem cara de detalhe
    // ("vai ser dia 20, umas 60 pessoas"); "oi", "cardápio", "quanto tá a coxinha?" voltam ao normal.
    const looksLikeFestaDetail = festaTopic
      && !hasAny(text, INTENTS.delivery)
      && !/^\d+$/.test(text)
      && text.split(' ').length >= 3
      && !hasAny(` ${text} `, INTENTS.greeting.map((w) => ` ${w} `))
      && !hasAny(text, [...INTENTS.menuLink, ...INTENTS.list, ...INTENTS.status, ...INTENTS.hours, ...INTENTS.address])
      && !answerFaq(rawText, { store, items: this.store.numberedItems?.() || [], link: null });
    if (hasAny(text, INTENTS.festa) || looksLikeFestaDetail) {
      return this.askLivia(session, rawText, out);
    }
    if (hasAny(text, INTENTS.delivery)) session.festaAt = 0;

    // Perguntas comuns (preço de item, taxa, pagamento, tempo, mínimo, "tem X?"): resposta pronta do cadastro
    if (session.state === 'idle') {
      const last = this.store.lastOrderOf?.(session.chatId, session.phone);
      const faq = answerFaq(rawText, {
        store,
        items: this.store.numberedItems?.() || [],
        link: this.onlineLink(session.chatId),
        hasActiveOrder: Boolean(last && !['done', 'canceled'].includes(last.status)),
      });
      if (faq) {
        const reply = typeof faq === 'string' ? faq : faq.text;
        out.replies.push(reply);
        if (faq.notifySil) out.effects.push({ type: 'question_for_sil', chatId: session.chatId, name: session.name || '', text: rawText.slice(0, 300) });
        return true;
      }
    }

    if (session.state === 'idle' && hasAny(text, INTENTS.menuLink) && !hasAny(text, INTENTS.list)) {
      this.startOrdering(session, out);
      return true;
    }

    // Com a IA ligada, frases livres ("quero duas pizzas de calabresa sem cebola")
    // vão para ela; as regras ficam com comandos curtos.
    if (this.ai?.available() && text.split(' ').length > 3) return false;

    // Estado ocioso: atalhos numéricos do menu de boas-vindas e intenções por palavra-chave.
    // "meu pedido" é acompanhamento, não pedido novo: status vem antes do cardápio.
    if (text === '4' || hasAny(text, INTENTS.status)) { this.orderStatus(session, out); return true; }
    if (hasAny(text, INTENTS.list) && session.state === 'idle') { this.startOrderingByChat(session, out); return true; }
    if (text === '1' || hasAny(text, INTENTS.menu)) { this.startOrdering(session, out); return true; }
    if (text === '2' || hasAny(text, INTENTS.hours)) {
      const open = storeOpen(store, this.now());
      out.replies.push(`${open ? 'Estamos abertos agora.' : 'Estamos fechados agora.'}\n\n${hoursText(store.hours)}`);
      return true;
    }
    if (text === '3' || hasAny(text, INTENTS.address)) {
      out.replies.push(store.address ? `Nosso endereço: ${store.address}` : 'Ainda não temos o endereço cadastrado por aqui.');
      return true;
    }
    if (text === '5') { this.requestHuman(session, out, { motive: 'Pediu atendente pelo menu' }); return true; }
    if (hasAny(` ${text} `, INTENTS.greeting.map((w) => ` ${w} `)) || text.length <= 3) {
      this.welcome(session, out);
      return true;
    }
    return false;
  }

  welcome(session, out) {
    const store = this.store.settings.store;
    const first = String(session.name || '').trim().split(/\s+/)[0] || '';
    // "natã" → "Natã"; nome que não é palavra (emoji, número) não entra
    const nameOk = /^[\p{L}][\p{L}'-]*$/u.test(first);
    const hello = nameOk ? `Olá, ${first.charAt(0).toLocaleUpperCase('pt-BR')}${first.slice(1)}!` : 'Olá!';
    const link = this.onlineLink(session.chatId);
    if (!storeOpen(store, this.now())) {
      // Fechado: avisa logo na saudação (antes o cliente só descobria ao tentar pedir)
      out.replies.push(
        `${hello} Aqui é o atendimento do ${store.name}.\n\n`
        + (allClosed(store.hours)
          ? '*No momento o delivery está pausado.*\n\n'
          : `*No momento estamos fechados.* Nosso horário:\n${hoursText(store.hours)}\n\n`)
        + (link ? `Você já pode ver o cardápio aqui:\n${link}\n\n` : '')
        + 'Se precisar, responda com o número:\n'
        + '3. Endereço\n'
        + '4. Acompanhar meu pedido\n'
        + '5. Falar com atendente',
      );
      return;
    }
    out.replies.push(
      `${hello} Aqui é o atendimento do ${store.name}.\n\n`
      + (link ? `O jeito mais rápido de pedir é pelo nosso cardápio digital:\n${link}\n\nOu responda com o número:\n` : 'Responda com o número do que precisa:\n')
      + '1. Ver cardápio e fazer pedido\n'
      + '2. Horário de funcionamento\n'
      + '3. Endereço\n'
      + '4. Acompanhar meu pedido\n'
      + '5. Falar com atendente',
    );
  }

  fallback(session, out) {
    if (session.state === 'idle') {
      this.welcome(session, out);
    } else {
      out.replies.push(session.state === 'ordering'
        ? 'Não entendi. Para pedir, mande o número do item com a quantidade (ex.: *10x1* = 10 unidades do item 1). Digite *carrinho* para conferir, *fechar* para finalizar ou *atendente* para falar com uma pessoa.'
        : 'Não entendi. Se preferir, digite *atendente* para falar com uma pessoa ou *cancelar* para recomeçar.');
    }
  }

  /** Avisa que a loja está fechada (no máximo uma vez a cada 30 min). Devolve true se fechada. */
  blockIfClosed(session, out) {
    const store = this.store.settings.store;
    if (storeOpen(store, this.now())) return false;
    const nowMs = this.now().getTime();
    if (nowMs - session.closedNoticeAt > CLOSED_NOTICE_GAP_MS) {
      session.closedNoticeAt = nowMs;
      out.replies.push(`Estamos fechados no momento e não conseguimos receber pedidos.\n\n${hoursText(store.hours)}`);
    }
    return true;
  }

  /** Mensagem com o link da página de pedido, ou null se ela não estiver ligada. */
  onlineMenuText(session) {
    const link = this.onlineLink(session.chatId);
    if (!link) return null;
    return `Veja o cardápio e faça seu pedido por aqui:
${link}

Se preferir pedir por esta conversa, digite *lista*.`;
  }

  /**
   * Cardápio: o link do cardápio digital vai SEMPRE (mesmo com a loja fechada, para o
   * cliente ver os itens e o horário). Sem link configurado, cai na lista em texto.
   */
  startOrdering(session, out) {
    const online = this.onlineMenuText(session);
    if (online) {
      this.blockIfClosed(session, out);
      out.replies.push(online);
      return;
    }
    this.startOrderingByChat(session, out);
  }

  /** Pedido pela conversa: lista numerada e carrinho por aqui. */
  startOrderingByChat(session, out) {
    if (this.blockIfClosed(session, out)) {
      const online = this.onlineMenuText(session);
      if (online) out.replies.push(online.split('\n\nSe preferir')[0]);
      return;
    }
    const items = this.store.numberedItems();
    out.replies.push(items.length ? `Claro, te atendo por aqui! 😊\n\n${menuText(items)}` : menuText(items));
    if (items.length === 0) return;
    session.state = 'ordering';
    out.replies.push(
      'Para pedir, envie o número do item. Para mais de uma unidade, use quantidade x número (ex.: *2x3*).\n'
      + 'Digite *carrinho* para conferir, *fechar* para finalizar ou *cancelar* para desistir.',
    );
  }

  stateOrdering(session, rawText, text, out) {
    if (hasAny(text, ['cancelar', 'desistir']) || typo(text, ['cancelar', 'desistir'])) {
      this.resetOrder(session);
      out.replies.push('Pedido cancelado. Quando quiser, é só chamar.');
      return true;
    }
    if (hasAny(text, ['carrinho', 'meu pedido', 'conferir']) || typo(text, ['carrinho', 'conferir'])) {
      out.replies.push(cartText(session.cart));
      return true;
    }
    if (hasAny(text, ['limpar', 'esvaziar'])) {
      session.cart = [];
      out.replies.push('Carrinho esvaziado.');
      return true;
    }
    if (hasAny(text, ['cardapio', 'menu'])) {
      out.replies.push(menuText(this.store.numberedItems()));
      return true;
    }
    if (hasAny(text, ['fechar', 'finalizar', 'concluir', 'so isso', 'e isso']) || typo(text, ['fechar', 'finalizar', 'concluir'])) {
      this.beginCheckout(session, out);
      return true;
    }
    const items = this.store.numberedItems();
    // "2x3" sozinho, ou no meio da frase ("vou querer 1x100 e ..."), com a ordem trocada corrigida
    const picks = parseSelection(rawText) || findSelections(rawText, items.length);
    // Pergunta junto ("tem pastel hoje?", "quanto tá a coxinha?"): resposta pronta, carrinho mantido
    const faqCtx = { store: this.store.settings.store, items, link: null };
    // a pergunta pode vir depois do pedido: "100x1 e vocês tem pastel hoje?" → olha cada trecho
    const faq = answerFaq(rawText, faqCtx)
      || rawText.split(/[,;?!\n]|\s+e\s+/i).map((part) => part.trim()).filter((part) => part.length > 2)
        .map((part) => answerFaq(part, faqCtx)).find(Boolean)
      || null;
    const faqText = faq ? (typeof faq === 'string' ? faq : faq.text) : '';
    if (faq?.notifySil) out.effects.push({ type: 'question_for_sil', chatId: session.chatId, name: session.name || '', text: rawText.slice(0, 300) });
    if (!picks || picks.length === 0) {
      if (faqText) {
        out.replies.push(`${faqText}${session.cart.length ? `\n\nSeu carrinho continua: ${cartTotalText(session.cart)}. Mande mais itens ou *fechar*.` : ''}`);
        return true;
      }
      return false;
    }
    const result = this.addItems(session, picks.map((p) => ({ number: p.number, quantity: p.qty, notes: '' })));
    out.replies.push(result.message);
    if (faqText) out.replies.push(faqText);
    return true;
  }

  /** Adiciona itens pelo número do cardápio. Usado pelas regras e pela IA. */
  addItems(session, picks) {
    const items = this.store.numberedItems();
    const unknown = [];
    for (const pick of picks) {
      const item = items.find((i) => i.number === Number(pick.number));
      const qty = Math.floor(Number(pick.quantity) || 1);
      if (!item || qty < 1 || qty > MAX_QTY) { unknown.push(pick.number); continue; }
      const notes = String(pick.notes || '').trim();
      const line = session.cart.find((l) => l.itemId === item.id && l.notes === notes);
      if (line) line.qty += qty;
      else session.cart.push({ itemId: item.id, name: item.name, price: item.price, qty, notes });
    }
    if (session.state === 'idle' && session.cart.length) session.state = 'ordering';
    const lines = [];
    if (unknown.length) lines.push(`Não encontrei o item ${unknown.join(', ')} no cardápio.`);
    lines.push(cartText(session.cart));
    if (session.cart.length) lines.push('Envie mais itens ou digite *fechar* para finalizar.');
    return { ok: unknown.length === 0, message: lines.join('\n') };
  }

  /** Muda a quantidade de um item que já está no carrinho (0 tira). Usado pela IA nas correções. */
  setQuantity(session, number, quantity) {
    const item = this.store.numberedItems().find((i) => i.number === Number(number));
    const qty = Math.floor(Number(quantity));
    if (!item || !Number.isFinite(qty) || qty < 0 || qty > MAX_QTY) return { ok: false, message: 'Item ou quantidade inválidos.' };
    const lines = session.cart.filter((l) => l.itemId === item.id);
    if (lines.length === 0) {
      if (qty === 0) return { ok: true, message: cartText(session.cart) };
      session.cart.push({ itemId: item.id, name: item.name, price: item.price, qty, notes: '' });
    } else {
      // junta as linhas do item numa só, com a quantidade nova
      const notes = lines.map((l) => l.notes).filter(Boolean).join('; ');
      session.cart = session.cart.filter((l) => l.itemId !== item.id);
      if (qty > 0) session.cart.push({ itemId: item.id, name: item.name, price: item.price, qty, notes });
    }
    session.summaryShown = false;
    return { ok: true, message: cartText(session.cart) };
  }

  /**
   * Aplica o que o leitor de frase livre entendeu. Devolve true se mudou o pedido
   * (e já respondeu com o carrinho e a próxima pergunta, ou o resumo final).
   */
  applyFreeOrder(session, rawText, out) {
    const items = this.store.numberedItems();
    const parsed = parseFreeOrder(rawText, items);
    // Pergunta sem item ("qual a taxa de entrega pro centro?", "aceita pix?") não é pedido:
    // vai para as respostas prontas, que respondem e lembram o carrinho.
    if (parsed.lines.length === 0 && isQuestion(rawText)) return false;
    const hasOrderInfo = session.cart.length > 0 && (parsed.mode || parsed.address || parsed.payment || parsed.changeFor);
    if (parsed.lines.length === 0 && !hasOrderInfo) return false;
    if (parsed.lines.length > 0 && this.blockIfClosed(session, out)) {
      const online = this.onlineMenuText(session);
      if (online) out.replies.push(online.split('\n\nSe preferir')[0]);
      return true;
    }
    for (const line of parsed.lines) {
      if (line.set) this.setQuantity(session, line.number, line.quantity);
      else this.addItems(session, [{ number: line.number, quantity: line.quantity, notes: line.notes || '' }]);
    }
    const store = this.store.settings.store;
    if (parsed.mode === 'pickup' && store.pickup) { session.mode = 'pickup'; session.address = ''; }
    if (parsed.mode === 'delivery' && store.delivery) session.mode = 'delivery';
    if (parsed.address && session.mode === 'delivery') this.setAddress(session, parsed.address);
    if (parsed.payment) this.setPayment(session, parsed.payment);
    if (parsed.changeFor && /dinheiro/i.test(session.payment || '')) session.changeFor = parsed.changeFor;
    session.state = 'ordering';
    session.summaryShown = false;

    if (this.needsNeighborhood(session)) {
      out.replies.push(`Anotado!\n\n${cartText(session.cart)}`);
      this.askNeighborhood(session, out, { freeFlow: true });
    } else if (this.readyToPlace(session)) {
      session.summaryShown = true;
      out.replies.push(this.summaryText(session));
    } else {
      out.replies.push(`Anotado!\n\n${cartText(session.cart)}\n\nAgora me diz: ${nextQuestion(session)}`);
    }
    return true;
  }

  /** Tudo pronto para enviar: itens, entrega/retirada, endereço (se entrega) e pagamento. */
  readyToPlace(session) {
    return session.cart.length > 0 && Boolean(session.mode) && (session.mode !== 'delivery' || Boolean(session.address)) && !this.needsNeighborhood(session) && Boolean(session.payment);
  }

  // ---------------------------------------------------------------- bairro e taxa

  neighborhoods() {
    return this.store.settings.store.neighborhoods || [];
  }

  /** Taxa do pedido: a do bairro (com lista) ou a única. Retirada = 0. */
  feeOf(session) {
    if (session.mode === 'pickup') return 0;
    const list = this.neighborhoods();
    if (list.length) return list.find((n) => n.name === session.neighborhood)?.fee ?? 0;
    return Number(this.store.settings.store.deliveryFee) || 0;
  }

  /** Guarda o endereço e já tenta achar o bairro nele. */
  setAddress(session, text) {
    // fala limpa + nome da rua corrigido pela base da cidade ("Físcula Cerda" → nome real)
    session.address = fixStreetName(cleanAddress(text)).slice(0, 300);
    const found = findNeighborhood(session.address, this.neighborhoods());
    if (found) session.neighborhood = found.name;
  }

  needsNeighborhood(session) {
    return session.mode === 'delivery' && Boolean(session.address) && this.neighborhoods().length > 0 && !session.neighborhood;
  }

  askNeighborhood(session, out, { freeFlow = false } = {}) {
    session.state = 'neighborhood';
    session.freeFlow = freeFlow;
    out.replies.push(`Qual é o bairro? Entregamos em: ${neighborhoodsText(this.neighborhoods(), money)}.`);
  }

  stateNeighborhood(session, rawText, text, out) {
    if (text === 'cancelar') return this.cancel(session, out);
    const store = this.store.settings.store;
    if (store.pickup && hasAny(text, ['retirar', 'retirada', 'buscar', 'vou buscar'])) {
      session.mode = 'pickup';
      session.address = '';
      return this.afterNeighborhood(session, out);
    }
    const found = findNeighborhood(rawText, this.neighborhoods());
    if (!found) {
      out.replies.push(
        `Ainda não entregamos nesse bairro. Entregamos em: ${neighborhoodsText(this.neighborhoods(), money)}.`
        + (store.pickup ? '\n\nSe preferir, responda *retirar* para buscar na loja.' : ''),
      );
      return true;
    }
    session.neighborhood = found.name;
    if (!session.address.toLowerCase().includes(found.name.toLowerCase())) session.address = `${session.address} - ${found.name}`.slice(0, 300);
    return this.afterNeighborhood(session, out);
  }

  /** Depois do bairro: segue o caminho em que o cliente estava (frase livre ou passo a passo). */
  afterNeighborhood(session, out) {
    if (session.freeFlow) {
      session.state = 'ordering';
      if (this.readyToPlace(session)) {
        session.summaryShown = true;
        out.replies.push(this.summaryText(session));
      } else {
        out.replies.push(`Certo! Agora me diz: ${nextQuestion(session)}`);
      }
      return true;
    }
    this.askPayment(session, out);
    return true;
  }

  /** Resumo calculado pelo sistema (valores certos), para a IA não precisar somar. */
  summaryText(session) {
    const fee = this.feeOf(session);
    return `Confira seu pedido:\n\n${orderSummary({ ...session, fee })}\n\nPosso enviar? Responda *sim* para confirmar.`;
  }

  /** Valores que podem aparecer numa resposta: preços, linhas, subtotal, taxa e total do carrinho. */
  allowedAmounts(session) {
    const s = this.store.settings.store;
    const fee = this.feeOf(session);
    const subtotal = cartTotal(session.cart);
    const values = [
      ...this.store.numberedItems().map((i) => i.price),
      ...session.cart.map((l) => l.qty * l.price),
      subtotal, fee, Number(s.deliveryFee) || 0, subtotal + fee, Number(s.minOrder) || 0,
      ...(session.changeFor ? [session.changeFor, session.changeFor - (subtotal + fee)] : []),
    ];
    return values.map((v) => Math.round(v * 100) / 100);
  }

  removeItem(session, number) {
    const item = this.store.numberedItems().find((i) => i.number === Number(number));
    const before = session.cart.length;
    if (item) session.cart = session.cart.filter((l) => l.itemId !== item.id);
    return { ok: session.cart.length !== before, message: cartText(session.cart) };
  }

  beginCheckout(session, out) {
    const store = this.store.settings.store;
    if (session.cart.length === 0) {
      out.replies.push('Seu carrinho está vazio. Envie o número de um item do cardápio.');
      return;
    }
    const subtotal = cartTotal(session.cart);
    if (subtotal < store.minOrder) {
      out.replies.push(`O pedido mínimo é ${money(store.minOrder)} e seu carrinho está em ${money(subtotal)}. Adicione mais itens.`);
      return;
    }
    if (store.delivery && store.pickup) {
      session.state = 'mode';
      const list = this.neighborhoods();
      const feeText = list.length ? 'taxa conforme o bairro' : money(store.deliveryFee);
      out.replies.push(`Como prefere receber?\n1. Entrega (${feeText})\n2. Retirada na loja`);
    } else if (store.delivery) {
      session.mode = 'delivery';
      session.state = 'address';
      out.replies.push('Qual o endereço de entrega? Informe rua, número, bairro e complemento.');
    } else {
      session.mode = 'pickup';
      this.askPayment(session, out);
    }
  }

  stateMode(session, text, out) {
    if (text === '1' || hasAny(text, ['entrega', 'entregar', 'delivery'])) {
      session.mode = 'delivery';
      session.state = 'address';
      out.replies.push('Qual o endereço de entrega? Informe rua, número, bairro e complemento.');
      return true;
    }
    if (text === '2' || hasAny(text, ['retirada', 'retirar', 'buscar', 'balcao'])) {
      session.mode = 'pickup';
      this.askPayment(session, out);
      return true;
    }
    if (hasAny(text, ['cancelar'])) return this.cancel(session, out);
    out.replies.push('Responda *1* para entrega ou *2* para retirada.');
    return true;
  }

  stateAddress(session, rawText, text, out) {
    if (text === 'cancelar') return this.cancel(session, out);
    if (rawText.trim().length < 8) {
      out.replies.push('Preciso do endereço completo: rua, número e bairro.');
      return true;
    }
    this.setAddress(session, rawText);
    if (this.needsNeighborhood(session)) {
      this.askNeighborhood(session, out);
      return true;
    }
    if (session.fixingAddress && session.payment) {
      session.fixingAddress = false;
      this.askConfirm(session, out);
      return true;
    }
    this.askPayment(session, out);
    return true;
  }

  askPayment(session, out) {
    const payments = this.store.settings.store.payments;
    session.state = 'payment';
    out.replies.push(`Qual a forma de pagamento?\n${payments.map((p, i) => `${i + 1}. ${p}`).join('\n')}`);
  }

  setPayment(session, method) {
    const payments = this.store.settings.store.payments;
    const wanted = normalize(method);
    const found = payments.find((p) => normalize(p) === wanted)
      || payments.find((p) => normalize(p).includes(wanted) || wanted.includes(normalize(p)));
    if (!found) return null;
    session.payment = found;
    return found;
  }

  statePayment(session, text, out) {
    if (text === 'cancelar') return this.cancel(session, out);
    const payments = this.store.settings.store.payments;
    const cards = payments.filter((p) => /cartao|debito|credito/.test(normalize(p)));
    if (/\bcartao\b/.test(text) && !/\b(debito|credito)\b/.test(text) && cards.length > 1) {
      out.replies.push('No débito ou no crédito?');
      return true;
    }
    const chosen = pickPayment(text, payments) || this.setPayment(session, text);
    if (!chosen) {
      out.replies.push(`Não reconheci essa forma de pagamento. Responda com o número:\n${payments.map((p, i) => `${i + 1}. ${p}`).join('\n')}`);
      return true;
    }
    session.payment = chosen;
    if (normalize(chosen).includes('dinheiro')) {
      // "2 e não precisa de troco" / "dinheiro, troco pra 50": já resolve o troco na mesma mensagem
      if (/\b(sem troco|nao (precisa|preciso|vou precisar) (de )?troco|troco nao|nao precisa|nao preciso|dinheiro certo|valor certo|trocado)\b/.test(text)) {
        session.changeFor = null;
        this.askConfirm(session, out);
        return true;
      }
      const troco = text.match(/troco\s*(?:pra|para|de|p\/)?\s*(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/);
      if (troco) {
        session.changeFor = parseMoney(troco[1]);
        this.askConfirm(session, out);
        return true;
      }
      session.state = 'change';
      out.replies.push('Precisa de troco? Informe para quanto (ex.: *50*) ou responda *não*.');
      return true;
    }
    this.askConfirm(session, out);
    return true;
  }

  stateChange(session, text, out) {
    if (text === 'cancelar') return this.cancel(session, out);
    const value = parseMoney(text);
    session.changeFor = value && !hasAny(text, ['nao', 'sem troco']) ? value : null;
    this.askConfirm(session, out);
    return true;
  }

  askConfirm(session, out) {
    session.state = 'confirm';
    const fee = this.feeOf(session);
    out.replies.push(`Confira seu pedido:\n\n${orderSummary({ ...session, fee })}\n\n${confirmHint(session)}`);
  }

  async stateConfirm(session, text, out) {
    // Corrigir o endereço sem cancelar tudo: "3", "corrigir endereço" ou mandar o endereço novo
    if (session.mode === 'delivery') {
      if (text === '3' || hasAny(text, ['corrigir', 'endereco errado', 'mudar o endereco', 'trocar o endereco', 'outro endereco'])) {
        session.state = 'address';
        session.fixingAddress = true;
        out.replies.push('Pode mandar o endereço certo: rua, número, bairro e complemento.');
        return true;
      }
      if (looksLikeAddress(text)) {
        this.setAddress(session, text);
        this.askConfirm(session, out);
        return true;
      }
    }
    if (text === '1' || hasAny(text, ['sim', 'confirmar', 'confirmo', 'pode', 'isso'])) {
      const result = await this.placeOrder(session, out);
      if (!result.ok) out.replies.push(result.message);
      return true;
    }
    if (text === '2' || hasAny(text, ['nao', 'cancelar'])) return this.cancel(session, out);
    out.replies.push(confirmHint(session));
    return true;
  }

  cancel(session, out) {
    this.resetOrder(session);
    out.replies.push('Pedido cancelado. Quando quiser, é só chamar.');
    return true;
  }

  /** Cria o pedido se estiver completo. Usado pelas regras e pela IA. */
  async placeOrder(session, out) {
    const store = this.store.settings.store;
    const missing = [];
    if (session.cart.length === 0) missing.push('itens no carrinho');
    if (!session.mode) missing.push('entrega ou retirada');
    if (session.mode === 'delivery' && !session.address) missing.push('endereço de entrega');
    if (!session.payment) missing.push('forma de pagamento');
    if (missing.length) return { ok: false, message: `Ainda falta: ${missing.join(', ')}.` };
    if (!storeOpen(store, this.now())) return { ok: false, message: 'A loja está fechada no momento.' };
    if (cartTotal(session.cart) < store.minOrder) return { ok: false, message: `O pedido mínimo é ${money(store.minOrder)}.` };

    let order;
    try {
      // Conectado ao Sabores, o pedido é gravado no servidor (e confere preço lá)
      order = await this.store.createOrder({
        customer: { chatId: session.chatId, name: session.name, phone: session.phone || '' },
        items: session.cart,
        mode: session.mode,
        address: session.address,
        neighborhood: session.neighborhood || null,
        payment: session.payment,
        changeFor: session.changeFor,
        source: 'bot',
      });
    } catch (error) {
      out.effects.push({ type: 'order_failed', message: error?.message || String(error) });
      return {
        ok: false,
        message: `Não consegui registrar o pedido agora (${error?.message || 'falha no sistema'}). Seu carrinho continua salvo: tente *1* de novo em instantes ou digite *atendente*.`,
      };
    }
    this.resetOrder(session);
    out.effects.push({ type: 'order_created', order });
    const eta = store.prepMinutes ? ` Previsão: cerca de ${store.prepMinutes} minutos.` : '';
    const message = `Pedido #${order.number} recebido! Assim que a loja confirmar, aviso por aqui.${eta}`;
    out.replies.push(message);
    return { ok: true, message, order };
  }

  orderStatus(session, out) {
    const order = this.store.lastOrderOf(session.chatId, session.phone);
    let message;
    if (order) {
      const link = this.trackingLink(order);
      message = `Seu pedido #${order.number} está *${STATUS_LABELS[order.status] || order.status}*.${link ? `\n\nAcompanhe aqui: ${link}` : ''}`;
    } else {
      const site = this.onlineLink(session.chatId);
      message = `Não encontrei pedido seu por aqui.${site ? ` Para fazer um pedido, use nosso cardápio digital:\n${site}` : ''}`;
    }
    out.replies.push(message);
    return message;
  }

  requestHuman(session, out, { motive = '', priority = 'medium', mood = 'calm' } = {}) {
    const handoff = this.store.addHandoff({
      chatId: session.chatId, name: session.name, phone: session.phone, motive, priority, mood,
    });
    this.store.pauseChat(session.chatId, '24h', this.now().getTime());
    out.effects.push({ type: 'handoff', handoff });
    const message = 'Certo, vou chamar uma pessoa da equipe para continuar com você. Aguarde um instante.';
    out.replies.push(message);
    return message;
  }

  // ------------------------------------------------------------------ Canela

  /**
   * Festa/buffet. Com a Canela ligada, ela responde; sem ela (padrão atual: WhatsApp só com o robô),
   * o robô manda o link do orçamento uma vez e avisa a Sil, que responde pessoalmente.
   */
  async askLivia(session, rawText, out) {
    if (!this.livia) return this.festaByRobot(session, rawText, out);
    session.festaAt = this.now().getTime();
    const history = session.history.slice(-8).map((turn) => ({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text,
    }));
    let answer = null;
    try {
      answer = this.livia ? await this.livia({ message: rawText, history }) : null;
    } catch (error) {
      out.effects.push({ type: 'livia_error', message: error?.message || String(error) });
    }
    if (answer?.reply) {
      out.replies.push(answer.reply);
      if (answer.link && !session.liviaLinkSent) {
        out.replies.push(`Para pedir o orçamento da sua festa: ${answer.link}`);
        session.liviaLinkSent = true;
      }
    } else {
      out.replies.push(
        'Sobre festas e buffet, a Sil responde pessoalmente. Já deixei seu recado para ela e, se quiser adiantar, '
        + 'conte a data, o número de convidados e o que pensou para a festa.',
      );
      // A Sil assume: o robô fica quieto nesta conversa (decisão de 18/11/2026)
      this.pauseForBuffet(session, out);
      return true;
    }
    if (!session.deliveryHintSent) {
      out.replies.push('Se quiser pedir do *delivery* agora, é só escrever *delivery*.');
      session.deliveryHintSent = true;
    }
    return true;
  }

  /**
   * Conversa de buffet é da Sil: o robô fica em silêncio por 24 h nessa conversa (ela pode
   * devolver antes em Atender → "Robô em silêncio"). Como "escreva delivery" não funciona com
   * o robô quieto, a dica do delivery vira o link do cardápio digital.
   */
  pauseForBuffet(session, out) {
    this.store.pauseChat(session.chatId, '24h', this.now().getTime());
    if (!session.deliveryHintSent) {
      const site = this.onlineLink(session.chatId);
      if (site) out.replies.push(`Se quiser pedir do *delivery*, é por este cardápio:\n${site}`);
      session.deliveryHintSent = true;
    }
  }

  /** Festa sem IA: texto fixo, link do orçamento (uma vez) e aviso para a Sil. */
  festaByRobot(session, rawText, out) {
    const first = !session.festaAt || this.now().getTime() - session.festaAt >= FESTA_TOPIC_MS;
    session.festaAt = this.now().getTime();
    const link = this.buffetLink();
    if (first) {
      out.replies.push(
        'Que bom que você pensou na gente pra sua festa! 🎉\n\n'
        + (link ? `Para pedir o orçamento, preencha aqui (leva 2 minutinhos):\n${link}\n\n` : '')
        + 'A Sil já foi avisada e vai te responder pessoalmente por aqui. Se quiser adiantar, mande a data, o número de convidados e a cidade.',
      );
    } else {
      out.replies.push('Anotado! A Sil vai ver e te responde por aqui.');
    }
    out.effects.push({ type: 'festa_lead', chatId: session.chatId, name: session.name || '', text: rawText.slice(0, 300), first });
    // A Sil assume: o robô fica quieto nesta conversa (decisão de 18/11/2026)
    this.pauseForBuffet(session, out);
    return true;
  }

  // ---------------------------------------------------------------------- IA

  async askAi(session, text, out) {
    if (!this.ai || !this.ai.available()) return false;
    const cartBefore = JSON.stringify(session.cart);
    try {
      const texts = await this.ai.reply({ engine: this, session, text, out });
      if (!texts || texts.length === 0) return out.replies.length > 0;
      const joined = texts.join('\n');
      const placed = out.effects.some((e) => e.type === 'order_created');
      // Trava de ação: a IA "disse" que enviou/registrou o pedido sem a ferramenta ter enviado
      const plain = normalize(joined).replace(/[*_]/g, '');
      const lastOrder = this.store.lastOrderOf(session.chatId);
      const realNumbers = [
        ...out.effects.filter((e) => e.type === 'order_created').map((e) => e.order.number),
        ...(lastOrder ? [lastOrder.number] : []),
      ];
      const citedNumbers = [...joined.matchAll(/#\s?(\d+)/g)].map((m) => Number(m[1]));
      const fakeSend = (!placed && /pedido (foi )?(enviado|registrado|confirmado|feito)|enviando (o |seu )?pedido|enviei (o |seu )?pedido|pedido (est[aá] )?a caminho/i.test(plain))
        || citedNumbers.some((num) => !realNumbers.includes(num))
        || (!lastOrder && !placed && /(sendo preparado|em preparo|saiu para (a )?entrega|ja esta (pronto|a caminho))/.test(plain));
      // Trava de valores: todo R$ precisa bater com o carrinho/cardápio
      const allowed = this.allowedAmounts(session);
      const amounts = [...joined.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/g)].map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')));
      const wrongMoney = amounts.some((v) => !allowed.some((a) => Math.abs(a - v) < 0.01));
      // Trava do carrinho: disse que anotou/vai anotar, mas o carrinho não mudou
      const fakeCart = JSON.stringify(session.cart) === cartBefore
        && /(adicionei|anotei|coloquei|vou (adicionar|anotar|colocar)|ja (esta|ta) no (seu )?(pedido|carrinho))/i.test(normalize(joined));
      if (fakeCart) {
        out.effects.push({ type: 'ai_guard', message: 'IA disse que anotou sem mudar o carrinho' });
        out.replies.push(
          session.cart.length
            ? `${cartText(session.cart)}\n\nNão consegui entender a mudança. Pode mandar de novo? Ex.: *10 coxinhas*. Ou digite *lista* para pedir pelos números.`
            : 'Não consegui anotar. Pode mandar de novo com a quantidade e o nome do item? Ex.: *10 coxinhas*. Ou digite *lista* para pedir pelos números.',
        );
        return true;
      }
      if (fakeSend || wrongMoney) {
        out.effects.push({ type: 'ai_guard', message: fakeSend ? 'IA disse que enviou sem enviar' : `valor fora do carrinho: ${amounts.join(', ')}` });
        if (this.readyToPlace(session)) {
          session.summaryShown = true;
          out.replies.push(this.summaryText(session));
        } else if (session.cart.length) {
          out.replies.push(`${cartText(session.cart)}\n\nPara fechar: ${nextQuestion(session)}`);
        } else {
          out.replies.push('Me diz o que você quer pedir que eu anoto. Se quiser ver o cardápio, é só pedir.');
        }
        return true;
      }
      // Pedido pronto: o resumo com o total sai do sistema (a IA não precisa fazer conta)
      if (this.readyToPlace(session) && !placed) {
        out.replies.push(...texts.filter((t) => !/R\$/.test(t)));
        session.summaryShown = true;
        out.replies.push(this.summaryText(session));
        return true;
      }
      out.replies.push(...texts);
      return true;
    } catch (error) {
      out.effects.push({ type: 'ai_error', message: error?.message || String(error) });
      return false;
    }
  }
}

/** Pergunta do próximo passo, sem IA. */
/**
 * Forma de pagamento numa frase: número no começo ("2 e não precisa de troco") ou o nome
 * no meio ("vou pagar no pix", "no débito"). `text` já vem normalizado (sem acento, minúsculo).
 */
function pickPayment(text, payments) {
  const lead = text.match(/^(\d{1,2})\b/);
  if (lead && payments[Number(lead[1]) - 1]) return payments[Number(lead[1]) - 1];
  const has = (re) => payments.find((p) => re.test(normalize(p)));
  if (/\bpix\b/.test(text)) return has(/pix/) || null;
  if (/\b(dinheiro|especie|em maos)\b/.test(text)) return has(/dinheiro/) || null;
  if (/\bdebito\b/.test(text)) return has(/debito/) || null;
  if (/\bcredito\b/.test(text)) return has(/credito/) || null;
  if (/\bcartao\b/.test(text)) {
    const cards = payments.filter((p) => /cartao|debito|credito/.test(normalize(p)));
    return cards.length === 1 ? cards[0] : null; // débito e crédito: pergunta qual
  }
  return null;
}

function nextQuestion(session) {
  if (!session.mode) return 'é para entregar ou retirar?';
  if (session.mode === 'delivery' && !session.address) return 'qual o endereço completo da entrega?';
  if (!session.payment) return 'qual a forma de pagamento?';
  return 'posso enviar o pedido?';
}

module.exports = { BotEngine, normalize, parseSelection, parseMoney, phoneFromChatId };
