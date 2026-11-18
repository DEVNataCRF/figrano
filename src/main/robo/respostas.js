'use strict';

/**
 * ROBÔ (sem IA): respostas prontas para as perguntas mais comuns do delivery.
 * Tudo vem do cadastro (cardápio, taxa, pedido mínimo, pagamentos, tempo de preparo).
 * Devolve o texto da resposta, ou null quando a mensagem não é uma dessas perguntas.
 */

const { money } = require('./format');
const { matchItem } = require('./free-order');
const { findNeighborhood, neighborhoodsText } = require('./bairros');

const norm = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[?!.,;]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const has = (text, words) => words.some((w) => text.includes(w));

/** Palavras-chave das respostas prontas, para corrigir erro de digitação ("acwita" → aceita) */
const VOCAB = ['aceita', 'aceitam', 'cartao', 'debito', 'credito', 'dinheiro', 'maquininha', 'entrega', 'entregam',
  'entregar', 'horario', 'cardapio', 'endereco', 'pedido', 'quanto', 'minimo', 'demora', 'pagamento', 'retirada',
  'retirar', 'gluten', 'lactose', 'alergia', 'vegano', 'vegetariano'];

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
 * Item do cardápio com erro de digitação: "coxinah" → Coxinha, "churos" → Mini churros.
 * Compara cada palavra da mensagem (5+ letras) com as palavras do nome do item.
 */
function fuzzyItem(text, items) {
  const words = text.split(' ').filter((w) => w.length >= 5);
  let best = null;
  for (const item of items) {
    const names = norm(item.name).split(' ').filter((w) => w.length >= 5);
    for (const w of words) {
      for (const n of names) {
        const d = editDistance(w.replace(/s$/, ''), n.replace(/s$/, ''));
        if (d <= (n.length >= 7 ? 2 : 1) && (!best || d < best.d)) best = { item, d };
      }
    }
  }
  return best ? best.item : null;
}

/** Troca palavra com 1 erro (2 em palavras de 8+ letras) pela palavra-chave certa. */
function fixTypos(text) {
  return text.split(' ').map((w) => {
    if (w.length < 5 || VOCAB.includes(w)) return w;
    let best = null;
    for (const v of VOCAB) {
      const d = editDistance(w, v);
      if (d <= (v.length >= 8 ? 2 : 1) && (!best || d < best.d)) best = { v, d };
    }
    return best ? best.v : w;
  }).join(' ');
}

const PRICE = ['quanto', 'preco', 'valor', 'custa', 'ta quanto', 'sai quanto', 'sai por'];
const FEE = ['taxa', 'frete', 'cobra entrega', 'cobram entrega', 'entrega custa', 'valor da entrega', 'quanto a entrega', 'quanto e a entrega', 'quanto fica a entrega'];
const PAY = ['aceita', 'aceitam', 'forma de pagamento', 'formas de pagamento', 'como pago', 'como pagar', 'pagamento', 'passa cartao', 'tem maquininha', 'maquininha'];
const TIME = ['quanto tempo', 'tempo de entrega', 'demora quanto', 'demora muito', 'leva quanto tempo', 'em quanto tempo', 'tempo de preparo'];
const MIN = ['pedido minimo', 'valor minimo', 'minimo'];
const DIETARY = /\b(gluten|lactose|sem leite|alergi|intoleran|celiac|vegan|vegetarian|diet|diabetic|zero acucar|sem acucar|amendoim|castanha|sem ovo)/;
const DELIVERY_Q = /\b(entrega|entregam|entregar|delivery)\b/;
const DELIVERY_ASK = /\b(faz|fazem|tem|voces|vcs|vc|da pra|consegue|chega|atende|atendem)\b/;
// Palavras que mostram que "tem ...?" não é nome de comida
const NOT_FOOD = /\b(entrega|opcao|opcoes|alguma|algum|algo|coisa|vaga|horario|desconto|promocao|troco|maquininha|estacionamento|mesa|wifi|lugar)\b/;
const HAS = /^(voces |vcs |vc |voce )?(tem|teria|vende|vendem|faz|fazem)\b/;

/**
 * @param {string} rawText mensagem do cliente
 * @param {{store: object, items: Array<{name:string, price:number}>, link: string|null, hasActiveOrder?: boolean}} ctx
 */
function answerFaq(rawText, { store, items, link, hasActiveOrder = false }) {
  const text = fixTypos(norm(rawText));
  if (!text) return null;
  const pedirAqui = link ? `\n\nPede aqui: ${link}` : '';
  const item = items.length ? matchItem(text, items) || fuzzyItem(text, items) : null;

  // Alergia e restrição alimentar: o cardápio não tem ingredientes, quem responde é a Sil
  if (DIETARY.test(text)) {
    return { text: 'Sobre ingredientes, alergia e restrição alimentar, prefiro não arriscar: já avisei a Sil e ela te responde certinho por aqui.', notifySil: true };
  }

  const bairros = store.neighborhoods || [];
  const bairro = bairros.length ? findNeighborhood(text, bairros) : null;
  const porBairro = () => (bairro
    ? `Para o ${bairro.name}, a taxa de entrega é ${money(bairro.fee)}.`
    : `A taxa depende do bairro: ${neighborhoodsText(bairros, money)}.`);

  // Taxa de entrega
  if (has(text, FEE)) {
    if (store.delivery === false) return `No momento não fazemos entrega, só retirada${store.address ? ` em ${store.address}` : ''}.`;
    if (bairros.length) return `${porBairro()}${pedirAqui}`;
    const fee = Number(store.deliveryFee) > 0 ? `A taxa de entrega é ${money(Number(store.deliveryFee))}.` : 'A entrega é grátis.';
    const min = Number(store.minOrder) > 0 ? ` Pedido mínimo: ${money(Number(store.minOrder))}.` : '';
    return `${fee}${min}${pedirAqui}`;
  }

  // "Vocês entregam no centro?" / "faz entrega hoje?"
  if (DELIVERY_Q.test(text) && DELIVERY_ASK.test(text) && !has(text, TIME)) {
    if (store.delivery === false) return `No momento não fazemos entrega, só retirada${store.address ? ` em ${store.address}` : ''}.`;
    if (bairros.length) {
      return bairro
        ? `Entregamos sim! ${porBairro()}${pedirAqui}`
        : `Entregamos nestes bairros: ${neighborhoodsText(bairros, money)}.${pedirAqui}`;
    }
    const fee = Number(store.deliveryFee) > 0 ? ` A taxa é ${money(Number(store.deliveryFee))}.` : ' A entrega é grátis.';
    return `Entregamos sim!${fee} Coloque seu endereço no pedido que o sistema confirma.${pedirAqui}`;
  }

  // Tempo de entrega (sem pedido em andamento; com pedido, quem responde é o acompanhamento)
  if (has(text, TIME) && !hasActiveOrder) {
    const min = Number(store.prepMinutes) || 0;
    return min > 0
      ? `Fica pronto em cerca de ${min} minutos depois que a loja confirma o pedido. A entrega depende do bairro.${pedirAqui}`
      : null;
  }

  // Formas de pagamento
  // (pergunta curta que cita uma forma de pagamento também: "ces acwita cartao?", "pix?")
  const asksPayment = /\b(pix|cartao|debito|credito|dinheiro|maquininha|vale)\b/.test(text)
    && (/\?/.test(String(rawText)) || text.split(' ').length <= 4);
  if (has(text, PAY) || asksPayment || /\b(aceita|aceitam|tem|pode ser|da pra pagar|posso pagar)\b.*\b(pix|cartao|debito|credito|dinheiro|vale)\b/.test(text)) {
    const list = (store.payments || []).filter(Boolean);
    if (!list.length) return null;
    return `Aceitamos: ${list.join(', ')}.${pedirAqui}`;
  }

  // Pedido mínimo
  if (has(text, MIN)) {
    return Number(store.minOrder) > 0
      ? `O pedido mínimo é ${money(Number(store.minOrder))}${Number(store.deliveryFee) > 0 ? `, fora a taxa de entrega de ${money(Number(store.deliveryFee))}` : ''}.${pedirAqui}`
      : `Não tem pedido mínimo.${pedirAqui}`;
  }

  // Preço de um item ("quanto custa a coxinha?")
  if (has(text, PRICE)) {
    if (item) return `${item.name}: ${money(item.price)} a unidade.${pedirAqui}`;
    return `Os preços de tudo estão no nosso cardápio digital.${pedirAqui || ' Digite *cardápio* que eu te mando o link.'}`;
  }

  // "Tem coxinha?" / "vocês fazem pastel?"
  if (HAS.test(text) && text.split(' ').length <= 8) {
    if (item) return `Tem sim! ${item.name}: ${money(item.price)} a unidade.${pedirAqui}`;
    const what = text.replace(HAS, '').trim();
    if (what && what.split(' ').length <= 3 && !NOT_FOOD.test(what) && !/^(hoje|agora|ai|aberto)/.test(what)) {
      // Nome como o cliente escreveu (com acento), sem "hoje/agora": "Pastel não tem no cardápio de hoje."
      const asked = String(rawText).toLowerCase().replace(/[?!.,;]+/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^(voc[eê]s |vcs |vc |voc[eê] )?(tem|teria|vende|vendem|faz|fazem)\s+/, '')
        .replace(/\b(hoje|agora|a[ií]|ainda|por a[ií])\b/g, '').replace(/\s+/g, ' ').trim();
      const name = asked ? `${asked.charAt(0).toLocaleUpperCase('pt-BR')}${asked.slice(1)}` : 'Esse';
      return `${name} não tem no cardápio de hoje. Dá uma olhada no que tem:${link ? `\n${link}` : ' digite *cardápio*.'}`;
    }
  }
  return null;
}

module.exports = { answerFaq };
