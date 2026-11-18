const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const money = (value) => BRL.format(Number(value) || 0);

/** Link de WhatsApp para o número da loja, ou null. */
export function whatsappLink(phone, text = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Etapas do pedido, na ordem (status da API). */
export const STATUS_STEPS = [
  { status: 'AWAITING_PIX', label: 'Pix e comprovante' },
  { status: 'NEW', label: 'Recebido pela loja' },
  { status: 'PREPARING', label: 'Em preparo' },
  { status: 'OUT_FOR_DELIVERY', label: 'Saiu para entrega' },
  { status: 'READY_FOR_PICKUP', label: 'Pronto para retirar' },
  { status: 'DONE', label: 'Concluído' },
];
