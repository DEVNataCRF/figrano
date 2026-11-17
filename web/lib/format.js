const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const money = (value) => BRL.format(Number(value) || 0);

/** Link de WhatsApp para o número da loja, ou null. */
export function whatsappLink(phone, text = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export const STATUS_STEPS = [
  { status: 'pending', label: 'Enviado para a loja' },
  { status: 'new', label: 'Recebido pela loja' },
  { status: 'preparing', label: 'Em preparo' },
  { status: 'out', label: 'Saiu para entrega' },
  { status: 'ready', label: 'Pronto para retirar' },
  { status: 'done', label: 'Concluído' },
];
