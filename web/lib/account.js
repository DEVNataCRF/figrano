// "Entrar com o celular" no site: sessão guardada no aparelho e "pedir de novo" a partir do
// histórico que vem da API (lá os adicionais vêm pelo nome, não pelo id do cardápio).

export const sessionKey = (slug) => `sabores:delivery:session:${slug}`;

/** Sessão guardada ainda vale? Devolve ela ou null. */
export function validSession(saved, now = Date.now()) {
  if (!saved || typeof saved !== 'object' || typeof saved.token !== 'string' || !saved.token) return null;
  if (!(Number(saved.expiresAt) > now)) return null;
  return saved;
}

/** Resposta do "conferir código" → o que fica guardado no aparelho. */
export function sessionFrom(data, now = Date.now()) {
  return {
    token: data.token,
    name: data.name || '',
    phone: data.phone || '',
    expiresAt: now + (Number(data.expiresInSeconds) || 0) * 1000,
  };
}

/** Só os números do celular, para conferir se dá para pedir o código. */
export const phoneDigits = (value) => String(value || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
export const validPhone = (value) => [10, 11].includes(phoneDigits(value).length);

const plain = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Adicionais do pedido antigo ({ group, name, quantity }) → escolhas do cardápio de hoje ({ optionId, quantity }). */
export function picksFromNames(item, options) {
  const picks = [];
  for (const chosen of options || []) {
    const group = (item?.optionGroups || []).find((g) => plain(g.name) === plain(chosen.group))
      // O grupo pode ter mudado de nome: procura a opção em todos
      || (item?.optionGroups || []).find((g) => g.options.some((o) => plain(o.name) === plain(chosen.name)));
    const option = group?.options.find((o) => plain(o.name) === plain(chosen.name));
    if (option) picks.push({ optionId: option.id, quantity: Number(chosen.quantity) || 1 });
  }
  return picks;
}

/** Itens de um pedido do histórico no formato do "pedir de novo" da sacola. */
export function repeatLinesOf(order, items) {
  return (order?.items || []).map((line) => {
    const item = line.productId ? items.get(line.productId) : null;
    return {
      itemId: line.productId || '',
      name: line.name,
      qty: line.quantity,
      notes: line.notes || '',
      options: item ? picksFromNames(item, line.options) : [],
    };
  });
}

/** "há 2 dias", "hoje às 19:40": quando o pedido foi feito. */
export function orderWhen(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86400000);
  if (diff === 0) return `Hoje às ${time}`;
  if (diff === 1) return `Ontem às ${time}`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: date.getFullYear() === now.getFullYear() ? undefined : '2-digit' }) + ` às ${time}`;
}
