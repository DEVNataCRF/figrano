// Adicionais do produto ("Molhos, escolha até 3") no site. A API confere e cobra de novo pelo
// cadastro; aqui é só para a pessoa ver o preço certo e não mandar escolha incompleta.

const optionMap = (item) => {
  const map = new Map();
  for (const group of item?.optionGroups || []) for (const option of group.options) map.set(option.id, { ...option, group });
  return map;
};

/** Preço de uma unidade do item com os adicionais escolhidos. */
export function lineUnitPrice(item, picks) {
  const map = optionMap(item);
  let total = Number(item?.price) || 0;
  for (const p of picks || []) total += (map.get(p.optionId)?.price || 0) * p.quantity;
  return Math.round(total * 100) / 100;
}

/** "Escolha até 3 itens", "Obrigatório · escolha 1", "Obrigatório · escolha de 1 a 3" */
export function groupRule(group) {
  if (!group.min) return `Escolha até ${group.max} ${group.max === 1 ? 'item' : 'itens'}`;
  if (group.min === group.max) return `Obrigatório · escolha ${group.min}`;
  return `Obrigatório · escolha de ${group.min} a ${group.max}`;
}

const countIn = (group, picks) => {
  const ids = new Set(group.options.map((o) => o.id));
  return (picks || []).reduce((n, p) => n + (ids.has(p.optionId) ? p.quantity : 0), 0);
};

/** Grupos obrigatórios que ainda não têm o mínimo. */
export function missingRequired(item, picks) {
  return (item?.optionGroups || []).filter((g) => countIn(g, picks) < g.min);
}

/** Mesmas escolhas (ordem não importa): soma na mesma linha da sacola. */
export function sameOptions(a, b) {
  const key = (list) => (list || []).map((p) => `${p.optionId}:${p.quantity}`).sort().join('|');
  return key(a) === key(b);
}

/** Sacola salva de outro dia: tira o que saiu do cardápio e diz se a escolha ainda vale. */
export function cleanPicks(item, picks) {
  const map = optionMap(item);
  const kept = (picks || []).filter((p) => map.has(p.optionId) && p.quantity > 0);
  const overMax = (item?.optionGroups || []).some((g) => countIn(g, kept) > g.max);
  return { picks: kept, ok: !overMax && missingRequired(item, kept).length === 0 };
}

/** ["2x Maionese", "1x Brigadeiro"] para a sacola e o resumo. */
export function optionLines(item, picks) {
  const map = optionMap(item);
  return (picks || []).filter((p) => map.has(p.optionId)).map((p) => `${p.quantity}x ${map.get(p.optionId).name}`);
}

/** Quantas já foram escolhidas no grupo (para travar o "+" no máximo). */
export const chosenIn = countIn;
