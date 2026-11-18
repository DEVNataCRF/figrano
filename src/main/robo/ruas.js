'use strict';

/**
 * ROBÔ: ruas da cidade (base em robo/dados/guacui.json, do OpenStreetMap).
 * Corrige o nome da rua quando o cliente (ou a transcrição do áudio) escreve parecido:
 *   "Rua Venida, Físcula Cerda de Aguiar, 423" → "Avenida Governador Francisco Lacerda de Aguiar, 423"
 * Só troca com segurança (2+ palavras do nome batendo); o cliente confere no resumo e pode corrigir.
 */

let base = { ruas: [], bairros: [] };
try {
  base = require('./dados/guacui.json');
} catch {
  // sem a base, o robô segue sem corrigir nomes de rua
}

const fold = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Palavras que não identificam a rua ("Rua", "Avenida Governador", "de", "da"…)
const GENERIC = new Set(['rua', 'r', 'avenida', 'av', 'travessa', 'tv', 'praca', 'alameda', 'beco', 'ladeira', 'rodovia',
  'estrada', 'governador', 'gov', 'doutor', 'dr', 'dona', 'professor', 'prof', 'comendador', 'capitao', 'tenente',
  'vereador', 'senador', 'prefeito', 'presidente', 'marechal', 'monsenhor', 'reverendo', 'santo', 'santa', 'sao',
  'nossa', 'senhora', 'de', 'da', 'do', 'dos', 'das', 'e', 'a', 'o', 'na', 'no', 'em', 'venida']);

const keyWords = (text) => fold(text).split(' ').filter((w) => w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w));

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

const close = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && editDistance(a, b) <= (b.length >= 7 ? 2 : 1));

const STREETS = (base.ruas || []).map((r) => ({ ...r, keys: keyWords(r.nome) })).filter((r) => r.keys.length > 0);

/**
 * Trecho do endereço que é o nome da rua: até o número da casa (ou " - ").
 * A transcrição de áudio põe vírgula no meio do nome ("Rua Venida, Físcula Cerda de Aguiar, 423"),
 * então a vírgula não corta, a menos que não haja número.
 */
function streetPart(address) {
  const text = String(address);
  const m = text.match(/^(.*?)(?=[\s,]+(?:n[ºo°.]?\s*)?\d|\s-\s)/i);
  const part = m ? m[1] : text.split(',')[0];
  return part.replace(/[\s,]+$/, '').trim();
}

/**
 * Rua da base que corresponde ao trecho escrito, ou null.
 * Exige 2+ palavras-chave batendo (ou 1, se a rua só tem 1) e 60% das palavras da rua.
 */
function matchStreet(text) {
  const words = keyWords(text);
  if (!words.length) return null;
  let best = null;
  let tie = false;
  for (const street of STREETS) {
    const hits = street.keys.filter((k) => words.some((w) => close(w, k))).length;
    const need = street.keys.length === 1 ? 1 : 2;
    if (hits < need || hits / street.keys.length < 0.6) continue;
    const score = hits / street.keys.length + hits * 0.01 - Math.abs(words.length - street.keys.length) * 0.001;
    if (!best || score > best.score) { best = { street, score }; tie = false; }
    // empate entre grafias da mesma rua ("Atilio Vivacqua" / "Atílio Vivácqua") não é empate
    else if (score === best.score && street.keys.join(' ') !== best.street.keys.join(' ')) tie = true;
  }
  return best && !tie ? best.street : null;
}

/**
 * Endereço com o nome da rua corrigido (só quando o cliente escreveu diferente do nome real).
 * "Rua Avenida Francisco Lacerda de Aguiar, 423" (nome local, todas as palavras certas) fica como está.
 */
function fixStreetName(address) {
  const part = streetPart(address);
  if (!part) return address;
  const street = matchStreet(part);
  if (!street) return address;
  const written = keyWords(part);
  const exact = street.keys.every((k) => written.includes(k));
  if (exact) return address;
  return `${street.nome}${String(address).slice(String(address).indexOf(part) + part.length)}`;
}

/** Nomes das ruas (dica para a transcrição e autocompletar) */
function streetNames() {
  return STREETS.map((s) => s.nome);
}

function cityNeighborhoods() {
  return [...(base.bairros || [])];
}

module.exports = { matchStreet, fixStreetName, streetNames, cityNeighborhoods, streetPart };
