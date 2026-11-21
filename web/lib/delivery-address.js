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
