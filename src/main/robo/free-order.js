'use strict';

/**
 * Lê um pedido escrito em frase livre, sem IA:
 *   "quero 10 coxinhas e 2 porções mista pra entregar na Rua das Flores 120, centro. pago no pix"
 *   "6 mini churros e 4 bolinhos de bacalhau pra retirar, dinheiro, troco pra 50"
 *   "na verdade quero 10 mini churros"
 * Devolve só o que entendeu com segurança; o que ficar faltando o robô pergunta.
 */

const norm = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const NUMBER_WORDS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cem: 100,
};
// Palavras que não identificam o item
const GENERIC = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'a', 'o', 'em', 'para', 'pra', 'mini', 'recheados', 'recheado',
  'sortidos', 'sortido', 'unidade', 'unidades', 'grande', 'pequeno', 'pequena', 'media', 'medio', 'porcao', 'porcoes']);

/** "coxinhas" → "coxinha"; "porções" → "porca"... raiz simples para comparar singular e plural */
const stem = (word) => word.replace(/(oes|aes)$/, 'a').replace(/(ns)$/, 'm').replace(/(es|s)$/, '');

function itemTokens(name) {
  const words = norm(name).split(/[^a-z0-9]+/).filter(Boolean);
  const strong = words.filter((w) => w.length > 2 && !GENERIC.has(w)).map(stem);
  return strong.length ? strong : words.map(stem);
}

/** Item do cardápio citado no trecho (o que tiver mais palavras em comum; empate = ambíguo). */
function matchItem(segment, items) {
  const segWords = new Set(norm(segment).split(/[^a-z0-9]+/).filter(Boolean).map(stem));
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const item of items) {
    const tokens = itemTokens(item.name);
    const hits = tokens.filter((t) => segWords.has(t)).length;
    if (hits === 0 || !segWords.has(tokens[0])) continue;
    const score = hits / tokens.length + hits * 0.01;
    if (score > bestScore) { best = item; bestScore = score; tie = false; } else if (score === bestScore) tie = true;
  }
  return tie ? null : best;
}

const PAYMENT_PATTERNS = [
  [/\bpix\b/, 'pix'],
  [/\b(dinheiro|especie|em maos)\b/, 'dinheiro'],
  [/\bdebito\b/, 'debito'],
  [/\bcredito\b/, 'credito'],
  [/\bcartao\b/, 'cartao'],
];

/**
 * @param {string} text mensagem do cliente
 * @param {Array<{number:number,name:string}>} items cardápio numerado
 * @returns {{ lines: Array<{number:number, quantity:number, set:boolean, notes?:string}>, mode: 'delivery'|'pickup'|null,
 *            address: string|null, payment: string|null, changeFor: number|null }}
 */
function parseFreeOrder(text, items) {
  const raw = String(text || '');
  const t = norm(raw);
  const correction = /\b(na verdade|so quero|apenas|muda (pra|para)|troca (pra|para)|mudar (pra|para)|corrig|em vez de)\b/.test(t);

  const lines = [];
  // Trechos separados por vírgula, " e ", "+" ou quebra de linha
  for (const piece of t.split(/,|;|\+|\n|\be\b(?=\s*(?:\d|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|vinte|cem)\b)/)) {
    const m = piece.match(/(\d{1,3}|\b(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|cem)\b)\s*(?:x\s*)?(?:unidades?\s+|un\s+)?(?:de\s+)?([a-z][a-z\s]{2,60})/);
    if (!m) continue;
    const quantity = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    if (!quantity || quantity > 500) continue;
    const item = matchItem(m[2], items);
    // Observação do item: "sem cebola", "bem passado", "com pouco sal"...
    const note = (m[2].match(/\b(sem|com|bem|pouco|extra)\b.*$/) || [''])[0]
      .replace(/\b(pra|para) (entregar|retirar|levar|buscar|hoje|amanha)\b.*$/, '')
      .replace(/\b(e|pra|para|no|na)$/, '')
      .trim();
    if (item) lines.push({ number: item.number, quantity, set: correction, ...(note ? { notes: note.slice(0, 100) } : {}) });
  }

  let mode = null;
  if (/\b(retir|buscar|busco|vou pegar|pego ai|pegar ai|no balcao)/.test(t)) mode = 'pickup';
  else if (/\b(entreg|delivery|levar|traz|manda (pra|para|na|no))/.test(t)) mode = 'delivery';

  let address = null;
  const addr = raw.match(/\b((?:rua|r\.|av\.?|avenida|travessa|tv\.?|pra[cç]a|estrada|rodovia|alameda|beco)\s+[^\n]+?)(?=(?:[,.;]?\s*(?:vou pagar|pago|pagamento|no pix|em dinheiro|cart[aã]o|troco))|[.;\n]|$)/i);
  if (addr && addr[1].trim().length >= 8) address = addr[1].trim().replace(/[,\s]+$/, '');
  if (address) mode = mode ?? 'delivery';

  let payment = null;
  for (const [re, key] of PAYMENT_PATTERNS) if (re.test(t)) { payment = key; break; }

  let changeFor = null;
  const troco = t.match(/troco (?:pra|para|de) (?:r\$ ?)?(\d{1,4}(?:[.,]\d{2})?)/);
  if (troco) changeFor = Number(troco[1].replace(',', '.'));

  return { lines, mode, address, payment, changeFor };
}

module.exports = { parseFreeOrder, matchItem };
