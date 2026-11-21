// Horário da loja é sempre o de Brasília (UTC-3), seja onde estiver o celular do cliente.
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

/**
 * Próxima abertura da loja a partir de agora: "hoje às 18:00", "amanhã às 18:00",
 * "sábado às 18:00". Devolve null se nenhum dia da semana abre.
 */
export function nextOpening(hours, now = new Date()) {
  if (!hours) return null;
  const local = new Date(now.getTime() + BRT_OFFSET_MS);
  const today = local.getUTCDay();
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  for (let ahead = 0; ahead < 8; ahead++) {
    const day = (today + ahead) % 7;
    const slot = hours[String(day)];
    if (!slot || slot.closed) continue;
    const open = minutesOf(slot.open);
    if (open === null) continue;
    if (ahead === 0 && open <= minute) continue; // o turno de hoje já começou (ou passou)
    const when = ahead === 0 ? 'hoje' : ahead === 1 ? 'amanhã' : DAY_NAMES[day];
    return { when, time: slot.open, text: `${when} às ${slot.open}` };
  }
  return null;
}
