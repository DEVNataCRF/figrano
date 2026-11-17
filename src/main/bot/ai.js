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

function systemPrompt(store) {
  const s = store.settings.store;
  const modes = [s.delivery && `entrega (taxa ${money(s.deliveryFee)})`, s.pickup && 'retirada na loja'].filter(Boolean).join(' ou ');
  return [
    `Você atende clientes do ${s.name} pelo WhatsApp e anota pedidos.`,
    'Os clientes escrevem do celular, com pressa. Responda em português do Brasil, em mensagens curtas e diretas, sem markdown além de *negrito* do WhatsApp.',
    '',
    'Como trabalhar:',
    '- O cardápio abaixo é a única fonte de itens e preços. Se o cliente pedir algo que não está nele, diga que não temos e sugira algo parecido da lista.',
    '- Use as ferramentas para montar o pedido; o carrinho só muda por elas. O estado atual do carrinho vem junto de cada mensagem.',
    `- Para fechar, você precisa de: itens, ${modes}, endereço se for entrega, e forma de pagamento.`,
    '- Antes de enviar o pedido, mostre o resumo com o total e espere o cliente confirmar. Só então chame place_order.',
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
  constructor({ store, getApiKey }) {
    this.store = store;
    this.getApiKey = getApiKey;
    this.client = null;
    this.clientKey = '';
  }

  available() {
    return this.store.settings.ai.enabled && Boolean(this.getApiKey());
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
    const client = this.getClient();
    const s = this.store.settings.store;

    // Histórico só em texto. O estado volátil (carrinho, loja aberta) vai na
    // última mensagem para não invalidar o cache do prompt de sistema.
    const messages = session.history.map((turn) => ({ role: turn.role, content: turn.text }));
    const state = [
      `[Estado] Loja ${isOpen(s.hours, engine.now()) ? 'aberta' : 'fechada'} agora.`,
      `Carrinho: ${session.cart.length ? cartText(session.cart) : 'vazio'}`,
      `Recebimento: ${session.mode || 'não definido'}${session.address ? ` (${session.address})` : ''}`,
      `Pagamento: ${session.payment || 'não definido'}`,
    ].join('\n');
    messages.push({ role: 'user', content: `${text}\n\n${state}` });

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

  /** Mensagem legível para um erro da API, para mostrar nas configurações. */
  static describeError(error) {
    if (error instanceof Anthropic.AuthenticationError) return 'Chave de API inválida.';
    if (error instanceof Anthropic.PermissionDeniedError) return 'A chave não tem permissão para este modelo.';
    if (error instanceof Anthropic.RateLimitError) return 'Limite de uso atingido. Tente de novo em instantes.';
    if (error instanceof Anthropic.APIConnectionError) return 'Sem conexão com a API.';
    if (error instanceof Anthropic.APIError) return `Erro da API (${error.status}).`;
    return error?.message || 'Erro desconhecido.';
  }

  /** Faz uma chamada mínima para validar a chave. */
  async test() {
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

module.exports = { AiResponder, TOOLS, MODEL };
