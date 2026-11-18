'use strict';

/**
 * ROBÔ: taxa de entrega por bairro (mesma regra da API em @sabores/business-rules).
 * Lista vazia = taxa única. Com lista, só entrega nos bairros dela.
 */

const placeName = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/** Bairro da lista citado no texto (o nome mais longo que aparecer inteiro). */
function findNeighborhood(text, list) {
  const hay = ` ${placeName(text)} `;
  let best = null;
  for (const n of list || []) {
    const name = placeName(n.name);
    if (name && hay.includes(` ${name} `) && (!best || name.length > placeName(best.name).length)) best = n;
  }
  return best;
}

/** Lista curta para mostrar ao cliente: "Centro (R$ 5,00), São Miguel (R$ 7,50)…" */
function neighborhoodsText(list, money, max = 15) {
  const shown = list.slice(0, max).map((n) => `${n.name} (${money(n.fee)})`).join(', ');
  return list.length > max ? `${shown} e outros` : shown;
}

module.exports = { findNeighborhood, neighborhoodsText, placeName };
