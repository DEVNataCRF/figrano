import guacui from './guacui.json';

/** "a Sil" quando a loja informa quem atende; "a loja" quando não. */
export function contactOf(ownerName) {
  const owner = (ownerName || '').trim();
  return { owner, a: owner ? `a ${owner}` : 'a loja', A: owner ? `A ${owner}` : 'A loja', da: owner ? `da ${owner}` : 'da loja' };
}

const plain = (v) => (v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** Ruas conhecidas da cidade da loja (base do OpenStreetMap) para sugerir enquanto o cliente digita. */
const CITY_STREETS = [guacui];
export function streetsOf(city) {
  const key = plain(city);
  if (!key) return [];
  return CITY_STREETS.find((c) => plain(c.cidade) === key)?.ruas.map((r) => r.nome) || [];
}
