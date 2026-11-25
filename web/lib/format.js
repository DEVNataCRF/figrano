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

/** Telefone para leitura: 28999990000 → (28) 99999-0000. Outro formato volta como veio. */
export function displayPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(raw || '');
}

/**
 * Descrição do item em linhas, para mostrar como lista ("450g de batata frita", "450g de frango").
 * Cada linha digitada no painel vira um item; marcadores digitados ("-", "•", "*") saem.
 */
export function descriptionLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-–—•*]\s*/, '').trim())
    .filter(Boolean);
}
