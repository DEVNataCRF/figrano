'use strict';

/**
 * Mensagem de voz → texto, pelo serviço de transcrição local (services/transcricao, porta 8178).
 * O áudio não sai do PC da loja. Sem o serviço ligado, devolve null e o robô pede para escrever.
 */

const DEFAULT_URL = 'http://127.0.0.1:8178';

/**
 * @param {{ base64: string, url?: string, hint?: string, timeoutMs?: number, fetch?: typeof fetch }} input
 * @returns {Promise<{ text: string, seconds: number } | null>}
 */
async function transcribeAudio({ base64, url = DEFAULT_URL, hint = '', timeoutMs = 45000, fetch: doFetch = fetch }) {
  if (!base64) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = hint ? `?dica=${encodeURIComponent(hint.slice(0, 600))}` : '';
    const res = await doFetch(`${String(url || DEFAULT_URL).replace(/\/+$/, '')}/transcrever${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/ogg' },
      body: Buffer.from(base64, 'base64'),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = String(data.texto || '').trim();
    return text ? { text, seconds: Number(data.segundos) || 0 } : null;
  } catch {
    return null; // serviço desligado, demorou demais ou áudio ilegível
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Erros típicos da transcrição em pedido de salgado: "centro de coxinha" → "cento de coxinha".
 * Só troca quando vem seguido de um item do cardápio (ou "salgado"), para não estragar "no centro".
 */
function fixAudioText(rawText, itemNames = []) {
  const text = spokenNumbersToDigits(rawText);
  const words = new Set(['salgado', 'salgados', 'salgadinho', 'salgadinhos']);
  for (const name of itemNames) {
    const first = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0];
    if (first && first.length > 2) {
      words.add(first);
      words.add(`${first}s`);
    }
  }
  return String(text).replace(/\b(centro|centros)(\s+de\s+)([\p{L}]+)/giu, (match, word, sep, next) => {
    const key = next.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!words.has(key)) return match;
    return `${word.toLowerCase() === 'centros' ? 'centos' : 'cento'}${sep}${next}`;
  });
}

const NUM = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900, mil: 1000,
};
const fold = (w) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Número falado composto → algarismos: "rua das flores cento e vinte" → "rua das flores 120",
 * "mil e duzentos" → "1200". Só quando há pelo menos duas palavras de número unidas por "e"
 * (palavra solta, como "dez coxinhas", o leitor de pedidos já entende).
 */
function spokenNumbersToDigits(text) {
  const words = Object.keys(NUM).join('|');
  const re = new RegExp(`\\b(?:${words})(?:\\s+e\\s+(?:${words}))+\\b`, 'giu');
  return String(text).normalize('NFC').replace(re, (match) => {
    const parts = fold(match).split(/\s+e\s+/);
    let total = 0;
    let current = 0;
    for (const p of parts) {
      const v = NUM[p];
      if (v === undefined) return match;
      if (v === 1000) { total += (current || 1) * 1000; current = 0; } else current += v;
    }
    return String(total + current);
  });
}

/**
 * Dica para a transcrição: ruas da cidade (configuradas + dos últimos pedidos), bairros e cardápio.
 * Ruas primeiro: nome próprio de rua é o que o modelo mais erra ("Físcula Cerda" em vez de
 * "Francisco Lacerda"). O Whisper lê no máximo ~220 palavras de dica; o resto é cortado.
 */
function buildAudioHint({ streets = '', addresses = [], neighborhoods = [], items = [] }) {
  const fromAddresses = addresses
    .map((a) => String(a).split(/[,\-–]/)[0].replace(/\d+/g, '').trim())
    .filter((a) => a.length > 4);
  const all = [
    ...String(streets).split(/\r?\n|;/).map((s) => s.trim()),
    ...fromAddresses,
    ...neighborhoods,
    ...items,
  ].filter(Boolean);
  const seen = new Set();
  const unique = all.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.join(', ').slice(0, 600);
}

module.exports = { transcribeAudio, fixAudioText, spokenNumbersToDigits, buildAudioHint, DEFAULT_URL };
