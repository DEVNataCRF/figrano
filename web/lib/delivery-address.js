/** Lê o formato novo e conserva endereços antigos sem adivinhar números ambíguos. */
export function restoreDeliveryContact(saved) {
  const value = saved && typeof saved === 'object' ? saved : {};
  const text = key => typeof value[key] === 'string' ? value[key] : '';
  const base = { name: text('name'), phone: text('phone'), address: text('address'), number: text('number'), complement: text('complement'), neighborhood: text('neighborhood'), noNumber: value.noNumber === true, legacyAddress: false };
  if (value.addressVersion === 2 || !base.address) return base;
  const match = base.address.match(/^(.+?),\s*(\d+[a-z]?(?:[-/]\w+)?|s\/?n|sem n[uú]mero)(?:,\s*(.+))?$/i);
  if (!match) return { ...base, legacyAddress: true };
  return { ...base, address: match[1].trim(), number: /^\d/.test(match[2]) ? match[2] : '', noNumber: !/^\d/.test(match[2]), complement: [match[3], base.complement].filter(Boolean).join(' - ') };
}

export function formatDeliveryAddress(form) {
  const number = form.noNumber ? 's/n' : String(form.number || '').trim();
  const street = [String(form.address || '').trim(), number].filter(Boolean).join(', ');
  return [street, String(form.complement || '').trim()].filter(Boolean).join(' - ');
}

/** Só os números do WhatsApp, sem o 55 do país. */
const phoneDigits = (value) => String(value || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');

/**
 * Confere o fechamento antes de enviar (as mesmas regras da loja), para a pessoa ver o que
 * falta em vez de o pedido voltar recusado. Devolve a mensagem do problema ou ''.
 */
export function checkoutProblem({ mode, form }) {
  if (String(form.name || '').trim().length < 2) return 'Informe seu nome.';
  const phone = phoneDigits(form.phone);
  if (![10, 11].includes(phone.length) || Number(phone.slice(0, 2)) < 11) return 'Confira o WhatsApp: com DDD, por exemplo (28) 99917-7660.';
  if (mode === 'delivery') {
    if (!String(form.neighborhood || '').trim()) return 'Informe o bairro da entrega.';
    if (!form.noNumber && !String(form.number || '').trim()) return 'Informe o número do endereço ou marque “Sem número”.';
    if (formatDeliveryAddress(form).length < 8) return 'Confira o endereço: escreva o nome da rua completo.';
  }
  return '';
}
