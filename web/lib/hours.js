// Horário de funcionamento. O servidor roda em UTC, então tudo é calculado
// no fuso da loja (padrão: horário de Brasília).

export const DEFAULT_TZ = 'America/Sao_Paulo';
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana (0 = domingo) e minutos desde a meia-noite no fuso dado. */
export function localTime(date = new Date(), timeZone = DEFAULT_TZ) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return { day: WEEKDAYS[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMinutes = (text) => {
  const [h, m] = String(text || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Mesma regra do app desktop: turnos que passam da meia-noite contam no dia seguinte. */
export function isOpen(hours, date = new Date(), timeZone = DEFAULT_TZ) {
  const { day, minutes } = localTime(date, timeZone);
  const today = hours?.[day];
  const yesterday = hours?.[(day + 6) % 7];
  if (today && !today.closed) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (close > open ? minutes >= open && minutes < close : minutes >= open) return true;
  }
  if (yesterday && !yesterday.closed) {
    const open = toMinutes(yesterday.open);
    const close = toMinutes(yesterday.close);
    if (close <= open && minutes < close) return true;
  }
  return false;
}

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Linhas "Segunda: 18:00 às 23:00" para mostrar na página. */
export function hoursLines(hours) {
  return DAY_NAMES.map((name, day) => {
    const slot = hours?.[day];
    return { name, text: !slot || slot.closed ? 'Fechado' : `${slot.open} às ${slot.close}` };
  });
}
