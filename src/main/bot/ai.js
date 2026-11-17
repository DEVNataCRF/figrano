'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { money, isOpen, hoursText, menuText, cartText } = require('./format');

const MODEL = 'claude-opus-5-5';
const MAX_STEPS = 6;

// Ferramentas que a IA usa para mexer no pedido. Com `strict`, o esquema é
// garantido pela API, então todos os campos são obrigatórios (texto vazio ou
// zero significam "não informado").
const TOOLS = [
  {
    name: 'send_menu',
    description: 'Envia ao cliente o cardápio numerado completo. Use quando ele pedir o cardápio ou não souber o que há.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'add_items',
    description: 'Adiciona itens ao carrinho pelo número do cardápio. Use o número exato da lista; nunca invente itens.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              number: { type: 'integer', description: 'Número do item no cardápio' },
              quantity: { type: 'integer', description: 'Quantidade, a partir de 1' },
              notes: { type: 'string', description: 'Observação do cliente (ex.: sem cebola) ou texto vazio' },
            },
            required: ['number', 'quantity', 'notes'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_item',
    description: 'Remove do carrinho todas as unidades de um item, pelo número do cardápio.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { number: { type: 'integer' } },
      required: ['number'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_fulfillment',
    description: 'Registra se o pedido é para entrega ou retirada. Para entrega, informe o endereço completo dito pelo cliente.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['delivery', 'pickup'] },
        address: { type: 'string', description: 'Endereço completo para entrega; texto vazio para retirada' },
      },
      required: ['mode', 'address'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_payment',
    description: 'Registra a forma de pagamento, que deve ser uma das aceitas pela loja.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        method: { type: 'string' },
        change_for: { type: 'number', description: 'Valor para troco em dinheiro; 0 se não precisa' },
      },
      required: ['method', 'change_for'],
      additionalProperties: false,
    },
  },
  {
    name: 'place_order',
    description: 'Envia o pedido para a loja. Só chame depois de mostrar o resumo com o total e o cliente confirmar claramente.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_order_status',
    description: 'Consulta a situação do último pedido deste cliente.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'request_human',
    description: 'Chama um atendente humano. Use quando o cliente pedir, reclamar, ou a dúvida fugir do que você sabe.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        motive: { type: 'string', description: 'Resumo curto do motivo' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        mood: { type: 'string', enum: ['calm', 'frustrated', 'hostile'] },
      },
      required: ['motive', 'priority', 'mood'],
      additionalProperties: false,
    },
  },
];

// Mesmas ferramentas no formato do Ollama (estilo OpenAI).
const OLLAMA_TOOLS = TOOLS.map((tool) => ({
  type: 'function',
  function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
}));

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const OLLAMA_TIMEOUT_MS = 120000; // a primeira chamada inclui carregar o modelo na GPU

class OllamaError extends Error {}

/**
 * Ajusta o texto do modelo para o WhatsApp: remove raciocínio que vazou em
 * <think>...</think> e troca o **negrito** do markdown pelo *negrito* do WhatsApp.
 */
const cleanText = (text) => String(text || '')
  .replace(/<think>[\s\S]*?<\/think>/g, '')
  .replace(/\*\*(.+?)\*\*/g, '*$1*')
  .replace(/^#{1,6}\s+/gm, '')
  .trim();

/** O que falta para fechar o pedido, dito de forma direta para guiar modelos menores. */
function nextStep(session) {
  if (session.cart.length === 0) return 'descobrir o que o cliente quer e chamar add_items.';
  if (!session.mode) return 'perguntar se é entrega ou retirada; quando ele disser, chamar set_fulfillment.';
  if (session.mode === 'delivery' && !session.address) return 'pedir o endereço completo e chamar set_fulfillment.';
  if (!session.payment) return 'perguntar a forma de pagamento; quando ele disser, chamar set_payment.';
  return 'pedido completo. Se o cliente ainda não viu o resumo, mostre o resumo com o total e peça confirmação. Se ele já confirmou, chame place_order agora.';
}

function systemPrompt(store) {
  const s = store.settings.store;
  const modes = [s.delivery && `entrega (taxa ${money(s.deliveryFee)})`, s.pickup && 'retirada na loja'].filter(Boolean).join(' ou ');
  return [
    `Você é a atendente virtual de delivery do ${s.name}. Atende os clientes pelo WhatsApp, tira dúvidas sobre o cardápio, o horário e a entrega, e anota pedidos.`,
    'Seja simpática e acolhedora, como uma boa atendente de restaurante, mas vá direto ao ponto. Se perguntarem, diga que é a atendente virtual da loja.',
    'Os clientes escrevem do celular, com pressa. Responda em português do Brasil, em mensagens curtas e diretas, sem markdown além de *negrito* do WhatsApp.',
    '',
    'Como trabalhar:',
    '- O cardápio abaixo é a única fonte de itens e preços. Se o cliente pedir algo que não está nele, diga que não temos e sugira algo parecido da lista.',
    '- Use as ferramentas para montar o pedido; o carrinho só muda por elas. O estado atual do carrinho vem junto de cada mensagem.',
    `- Para fechar, você precisa de: itens, ${modes}, endereço se for entrega, e forma de pagamento.`,
    '- Antes de enviar o pedido, mostre o resumo com o total e espere o cliente confirmar. Só então chame place_order.',
    '',
    'Regras das ferramentas (obrigatórias):',
    '- O cliente disse que itens quer: chame add_items na mesma hora.',
    '- O cliente disse entrega com endereço, ou retirada: chame set_fulfillment na mesma hora.',
    '- O cliente disse a forma de pagamento: chame set_payment na mesma hora.',
    '- O cliente confirmou o resumo ("sim", "pode mandar", "confirmo"): chame place_order na mesma hora, sem pedir nova confirmação.',
    '- Nunca diga que anotou, registrou ou enviou algo sem ter chamado a ferramenta. Siga o "Próximo passo" indicado no estado.',
    '- Só envie o cardápio (send_menu) quando o cliente pedir para ver o cardápio.',
    '',
    'Nunca invente:',
    '- Use só as informações desta mensagem. Não invente promoções, sabores, chave Pix, QR Code ou prazos.',
    '- Não peça comprovante nem QR Code: a loja combina os detalhes do pagamento com o cliente.',
    '- Para tempo, fale só do tempo médio de preparo informado abaixo. Não prometa horário de entrega.',
    '- Se a loja estiver fechada, informe o horário e não anote pedido.',
    '- Assuntos fora do restaurante, reclamações e pedidos de falar com alguém vão para request_human.',
    '',
    `Endereço da loja: ${s.address || 'não informado'}`,
    `Formas de pagamento aceitas: ${s.payments.join(', ')}`,
    `Pedido mínimo: ${money(s.minOrder)}`,
    `Tempo médio de preparo: ${s.prepMinutes} minutos`,
    '',
    'Horário de funcionamento:',
    hoursText(s.hours),
    '',
    'Cardápio:',
    menuText(store.numberedItems()),
  ].join('\n');
}

class AiResponder {
  /**
   * @param {object} deps
   * @param {import('../store').Store} deps.store
   * @param {() => string} deps.getApiKey devolve a chave em texto, ou '' se não configurada
   */
  constructor({ store, getApiKey, fetch: fetchImpl = globalThis.fetch }) {
    this.store = store;
    this.getApiKey = getApiKey;
    this.fetch = fetchImpl;
    this.client = null;
    this.clientKey = '';
  }

  get provider() {
    return this.store.settings.ai.provider === 'ollama' ? 'ollama' : 'anthropic';
  }

  available() {
    const ai = this.store.settings.ai;
    if (!ai.enabled) return false;
    return this.provider === 'ollama' ? Boolean(ai.ollamaModel) : Boolean(this.getApiKey());
  }

  getClient() {
    const key = this.getApiKey();
    if (!this.client || key !== this.clientKey) {
      this.client = new Anthropic({ apiKey: key });
      this.clientKey = key;
    }
    return this.client;
  }

  runTool(name, input, { engine, session, out }) {
    switch (name) {
      case 'send_menu':
        out.replies.push(menuText(this.store.numberedItems()));
        return 'Cardápio enviado ao cliente em uma mensagem separada. Não repita a lista.';
      case 'add_items':
        if (!Array.isArray(input.items)) return 'Entrada inválida.';
        return engine.addItems(session, input.items).message;
      case 'remove_item':
        return engine.removeItem(session, input.number).message;
      case 'set_fulfillment':
        if (input.mode === 'delivery' && String(input.address || '').trim().length < 8) {
          return 'Endereço incompleto. Peça rua, número e bairro.';
        }
        session.mode = input.mode === 'pickup' ? 'pickup' : 'delivery';
        session.address = session.mode === 'delivery' ? String(input.address).trim().slice(0, 300) : '';
        return 'Registrado.';
      case 'set_payment': {
        const chosen = engine.setPayment(session, input.method);
        if (!chosen) return `Forma não aceita. Opções: ${this.store.settings.store.payments.join(', ')}.`;
        session.changeFor = Number(input.change_for) > 0 ? Number(input.change_for) : null;
        return `Pagamento registrado: ${chosen}.`;
      }
      case 'place_order': {
        const scratch = { replies: [], effects: out.effects };
        const result = engine.placeOrder(session, scratch);
        return result.ok ? `Pedido #${result.order.number} enviado para a loja. Avise o cliente.` : result.message;
      }
      case 'get_order_status': {
        const scratch = { replies: [], effects: [] };
        return engine.orderStatus(session, scratch);
      }
      case 'request_human': {
        const scratch = { replies: [], effects: out.effects };
        engine.requestHuman(session, scratch, input);
        return 'Atendente chamado. Avise o cliente que alguém da equipe vai continuar a conversa.';
      }
      default:
        return `Ferramenta desconhecida: ${name}`;
    }
  }

  /**
   * Gera a resposta para uma mensagem livre.
   * @returns {Promise<string[]>} textos a enviar ao cliente
   */
  async reply({ engine, session, text, out }) {
    const s = this.store.settings.store;

    // Histórico só em texto. O estado volátil (carrinho, loja aberta) vai na
    // última mensagem para não invalidar o cache do prompt de sistema.
    const messages = session.history.map((turn) => ({ role: turn.role, content: turn.text }));
    const state = [
      `[Estado] Loja ${isOpen(s.hours, engine.now()) ? 'aberta' : 'fechada'} agora.`,
      `Carrinho: ${session.cart.length ? cartText(session.cart) : 'vazio'}`,
      `Recebimento: ${session.mode || 'não definido'}${session.address ? ` (${session.address})` : ''}`,
      `Pagamento: ${session.payment || 'não definido'}`,
      `Próximo passo: ${nextStep(session)}`,
    ].join('\n');
    messages.push({ role: 'user', content: `${text}\n\n${state}` });

    if (this.provider === 'ollama') return this.replyOllama(messages, { engine, session, out });

    const client = this.getClient();
    const texts = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: systemPrompt(this.store), cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') break;

      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) texts.push(block.text.trim());
      }
      const toolUses = response.content.filter((block) => block.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: toolUses.map((tool) => ({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: this.runTool(tool.name, tool.input || {}, { engine, session, out }),
        })),
      });
    }
    return texts;
  }

  // ------------------------------------------------------------------ Ollama

  ollamaUrl(pathname) {
    const base = String(this.store.settings.ai.ollamaUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
    return `${base}${pathname}`;
  }

  async ollamaFetch(pathname, body, timeoutMs = OLLAMA_TIMEOUT_MS) {
    let response;
    try {
      response = await this.fetch(this.ollamaUrl(pathname), {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') throw new OllamaError('O Ollama demorou demais para responder.');
      throw new OllamaError('O Ollama não está rodando neste computador.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = String(data.error || response.status);
      if (/not found/i.test(detail)) throw new OllamaError(`Modelo "${this.store.settings.ai.ollamaModel}" não encontrado no Ollama.`);
      throw new OllamaError(`Erro do Ollama: ${detail}`);
    }
    return data;
  }

  /** Modelos instalados no Ollama. */
  async ollamaModels() {
    const data = await this.ollamaFetch('/api/tags', null, 5000);
    return (data.models || []).map((model) => model.name);
  }

  async replyOllama(messages, context) {
    const chat = [{ role: 'system', content: systemPrompt(this.store) }, ...messages];
    const texts = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await this.ollamaFetch('/api/chat', {
        model: this.store.settings.ai.ollamaModel,
        messages: chat,
        tools: OLLAMA_TOOLS,
        stream: false,
        think: Boolean(this.store.settings.ai.ollamaThink),
        keep_alive: '30m',
        options: { temperature: 0.3 },
      });
      const message = data.message || {};
      const content = cleanText(message.content);
      if (content) texts.push(content);
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (calls.length === 0) break;

      chat.push({ role: 'assistant', content: message.content || '', tool_calls: calls });
      for (const call of calls) {
        const name = call.function?.name;
        let input = call.function?.arguments || {};
        if (typeof input === 'string') {
          try { input = JSON.parse(input); } catch { input = {}; }
        }
        chat.push({ role: 'tool', tool_name: name, content: this.runTool(name, input, context) });
      }
    }
    return texts;
  }

  /** Mensagem legível para um erro da API, para mostrar nas configurações. */
  static describeError(error) {
    if (error instanceof OllamaError) return error.message;
    if (error instanceof Anthropic.AuthenticationError) return 'Chave de API inválida.';
    if (error instanceof Anthropic.PermissionDeniedError) return 'A chave não tem permissão para este modelo.';
    if (error instanceof Anthropic.RateLimitError) return 'Limite de uso atingido. Tente de novo em instantes.';
    if (error instanceof Anthropic.APIConnectionError) return 'Sem conexão com a API.';
    if (error instanceof Anthropic.APIError) return `Erro da API (${error.status}).`;
    return error?.message || 'Erro desconhecido.';
  }

  /** Faz uma chamada mínima para validar a configuração. */
  async test() {
    if (this.provider === 'ollama') {
      const model = this.store.settings.ai.ollamaModel;
      const models = await this.ollamaModels();
      if (!models.includes(model)) {
        throw new OllamaError(`Modelo "${model}" não está instalado. Instalados: ${models.join(', ') || 'nenhum'}.`);
      }
      // Também carrega o modelo na memória, para a primeira mensagem não demorar.
      await this.ollamaFetch('/api/chat', {
        model, stream: false, think: false, keep_alive: '30m',
        messages: [{ role: 'user', content: 'Responda apenas: ok' }],
      });
      return 'ok';
    }
    const response = await this.getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Responda apenas: ok' }],
    });
    return response.stop_reason;
  }
}

module.exports = {
  AiResponder, TOOLS, OLLAMA_TOOLS, MODEL, DEFAULT_OLLAMA_URL, systemPrompt,
};
