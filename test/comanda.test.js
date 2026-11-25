'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const { renderReceipt, customerKind, paperOf, pageHeightMicrons, paymentInstructions, splitAddress, mapsUrl } = require('../src/main/comanda');
const { receiptData, forecastOf } = require('../src/main/comanda-dados');
const { exampleOrder } = require('../src/main/comanda-exemplo');

const store = { name: 'Sabores da Sil', city: 'Guaçuí', state: 'ES', prepMinutes: 40 };
const base = {
  number: 77, mode: 'delivery', createdAt: Date.parse('2026-11-21T22:40:00Z'), acceptedAt: '2026-11-21T22:40:00Z',
  apiStatus: 'PREPARING', customer: { name: 'Maria', phone: '5528999990000' },
  items: [{ name: 'Coxinha', qty: 7, price: 3.5, subtotal: 24.5, notes: 'bem sequinha', options: [] }],
  address: 'Rua Doutor Antônio Pinto, 120 - casa azul - Centro', neighborhood: 'Centro',
  paymentMethod: 'CASH', payment: 'Dinheiro', changeFor: 50, subtotal: 24.5, fee: 5, total: 29.5, notes: '',
};

/** Só o texto que sai no papel (sem CSS e sem tags). */
const textOf = (html) => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<svg[\s\S]*?<\/svg>/g, ' [QR] ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const entrega = (o = {}) => textOf(renderReceipt('entrega', { ...base, ...o }, store, '<svg></svg>'));
const retirada = (o = {}) => textOf(renderReceipt('retirada', { ...base, mode: 'pickup', address: '', neighborhood: '', fee: 0, total: 24.5, ...o }, store));
const producao = (o = {}) => textOf(renderReceipt('producao', { ...base, ...o }, store));

test('cabeçalho: loja, modelo, número, data e hora no fuso da loja', () => {
  const t = entrega();
  assert.match(t, /^Sabores da Sil COMANDA DE ENTREGA #77 21\/11 19:40/);
  assert.match(t, /Sabores da Sil • Buffet Control$/);
  // o rodapé não repete número nem data
  assert.doesNotMatch(t.slice(t.lastIndexOf('Total')), /#77|21\/11/);
});

test('pedido com um produto: quantidade, produto e valor gravado no pedido', () => {
  assert.match(entrega(), /Produtos · 7 itens QTD PRODUTO VALOR 7x Coxinha Obs\.: bem sequinha R\$ 24,50/);
});

test('pedido com muitos produtos: todos aparecem, na ordem, com a contagem certa', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ name: `Produto ${i + 1}`, qty: 1, subtotal: 2, options: [], notes: '' }));
  const t = entrega({ items });
  assert.match(t, /25 itens/);
  for (let i = 1; i <= 25; i += 1) assert.ok(t.includes(`1x Produto ${i} R$ 2,00`), `faltou o produto ${i}`);
});

test('nome longo e observação extensa quebram linha sem empurrar o valor (coluna própria)', () => {
  const name = 'Combo família completo com salgadinhos sortidos, mini churros recheados e refrigerante de dois litros';
  const note = 'Separar os salgados de queijo dos de carne porque tem criança alérgica, e mandar guardanapo extra por favor';
  const html = renderReceipt('entrega', { ...base, items: [{ name, qty: 1, subtotal: 89.9, notes: note, options: [] }] }, store);
  // nome e observação na coluna do meio; o valor fica na própria coluna, inteiro
  assert.ok(html.includes(`<div class="n wrap">${name}<div class="note">Obs.: ${note}</div></div><span class="v">R$ 89,90</span>`));
  assert.match(html, /\.row \{ display: grid; grid-template-columns: 8mm 1fr auto;/);
  assert.match(html, /\.wrap \{ overflow-wrap: anywhere;/);
  assert.match(html, /\.row \.v \{[^}]*white-space: nowrap/);
});

test('adicionais logo abaixo do produto (por unidade quando o item tem mais de 1)', () => {
  const t = entrega({ items: [
    { name: 'Combo 50 salgados', qty: 1, subtotal: 55, notes: '', options: [{ name: 'Maionese', quantity: 2 }] },
    { name: 'Churros', qty: 2, subtotal: 7, notes: '', options: [{ name: 'Ninho', quantity: 1 }] },
  ] });
  assert.match(t, /1x Combo 50 salgados \+ 2x Maionese R\$ 55,00/);
  assert.match(t, /2x Churros \+ 1x Ninho em cada R\$ 7,00/);
});

test('endereço: bairro em destaque, rua e número, complemento/referência, cliente e telefone', () => {
  assert.match(entrega(), /Dados da entrega Centro Rua Doutor Antônio Pinto, 120 Compl\.\/ref\.: casa azul Maria \(28\) 99999-0000/);
  assert.deepEqual(splitAddress(base.address, 'Centro'), { street: 'Rua Doutor Antônio Pinto, 120', reference: 'casa azul' });
});

test('endereço sem referência não mostra a linha vazia', () => {
  const t = entrega({ address: 'Rua A, 10' });
  assert.match(t, /Centro Rua A, 10 Maria/);
  assert.doesNotMatch(t, /Compl/);
});

test('campos opcionais ausentes: nada de undefined, null, linha vazia ou QR', () => {
  const html = renderReceipt('entrega', {
    number: 5, mode: 'delivery', createdAt: Date.parse('2026-11-21T22:40:00Z'), customer: { name: null, phone: undefined },
    items: [{ name: 'Pastel', qty: 1, subtotal: 8, notes: null }], address: null, neighborhood: undefined,
    paymentMethod: 'PIX', changeFor: null, subtotal: 8, fee: 0, total: 8, notes: null,
  }, {});
  const t = textOf(html);
  assert.doesNotMatch(t, /undefined|null|NaN/);
  assert.doesNotMatch(t, /Compl|Taxa de entrega|Desconto|Acréscimo|ROTA/);
  assert.match(t, /^COMANDA DE ENTREGA #5/); // sem nome da loja configurado, não inventa
  assert.match(t, /Buffet Control$/);
});

test('resumo: só as linhas que existem; desconto, taxa e acréscimo quando houver', () => {
  assert.match(entrega(), /Subtotal R\$ 24,50 Taxa de entrega R\$ 5,00 Total R\$ 29,50/);
  assert.match(entrega({ fee: 0, total: 24.5 }), /Subtotal R\$ 24,50 Total R\$ 24,50/);
  assert.match(entrega({ discount: 4.5, surcharge: 1, total: 26 }), /Subtotal R\$ 24,50 Desconto - R\$ 4,50 Taxa de entrega R\$ 5,00 Acréscimo R\$ 1,00 Total R\$ 26,00/);
});

test('dinheiro com troco: cobrar o total e levar a diferença', () => {
  assert.match(entrega(), /PAGAMENTO EM DINHEIRO COBRAR R\$ 29,50 LEVAR R\$ 20,50 DE TROCO Cliente paga com R\$ 50,00/);
  assert.match(retirada({ changeFor: 30 }), /COBRAR R\$ 24,50 SEPARAR R\$ 5,50 DE TROCO/);
});

test('dinheiro sem troco (sem valor ou valor exato)', () => {
  assert.match(entrega({ changeFor: null }), /PAGAMENTO EM DINHEIRO COBRAR R\$ 29,50 NÃO PRECISA DE TROCO/);
  assert.match(entrega({ changeFor: 29.5 }), /NÃO PRECISA DE TROCO/);
});

test('Pix conferido: PAGO, NÃO COBRAR', () => {
  assert.match(entrega({ paymentMethod: 'PIX', pixProofAt: '2026-11-21T22:41:00Z' }), /PAGAMENTO VIA PIX PAGO NÃO COBRAR/);
});

test('Pix não é pago só por ter sido escolhido: sem conferência, cobra e aguarda', () => {
  assert.match(entrega({ paymentMethod: 'PIX' }), /PIX NA ENTREGA COBRAR R\$ 29,50 AGUARDAR CONFIRMAÇÃO DO PIX/);
  // comprovante chegou mas a loja ainda não conferiu
  assert.match(entrega({ paymentMethod: 'PIX', pixProofAt: '2026-11-21T22:41:00Z', apiStatus: 'AWAITING_PIX' }), /PIX NÃO CONFERIDO NÃO SAIR ANTES DE CONFERIR/);
  // Pix online ligado na loja não muda nada (antes isso imprimia "PAGO")
  assert.equal(paymentInstructions({ ...base, paymentMethod: 'PIX', pixOnline: true }).main, 'COBRAR R$ 29,50');
  // cancelado nunca sai como pago
  assert.notEqual(paymentInstructions({ ...base, paymentMethod: 'PIX', pixProofAt: 'x', apiStatus: 'CANCELED' }).main, 'PAGO');
});

test('cartão na entrega: cobrar e levar a maquininha; na retirada, passar no balcão', () => {
  assert.match(entrega({ paymentMethod: 'CREDIT_CARD' }), /PAGAMENTO EM CARTÃO COBRAR R\$ 29,50 LEVAR MAQUININHA · Crédito/);
  assert.match(retirada({ paymentMethod: 'DEBIT_CARD' }), /PAGAMENTO EM CARTÃO COBRAR R\$ 24,50 PASSAR NO BALCÃO · Débito/);
});

test('pago antes (Pix conferido) vale na retirada também', () => {
  assert.match(retirada({ paymentMethod: 'PIX', pixProofAt: 'x' }), /PAGAMENTO VIA PIX PAGO NÃO COBRAR/);
});

test('QR da rota: aponta para o endereço real do pedido e só sai na comanda de entrega', async () => {
  const url = mapsUrl(base, store);
  assert.equal(url, `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Rua Doutor Antônio Pinto, 120, Centro, Guaçuí - ES')}`);
  const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  // o QR de verdade carrega a URL (o leitor do celular recebe exatamente isto)
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  assert.ok(qr.modules.size >= 25);
  const html = renderReceipt('entrega', base, store, svg);
  assert.match(textOf(html), /\[QR\] ROTA DE ENTREGA Escaneie para abrir o endereço no mapa\./);
  assert.match(html, /\.qr svg \{ display: block; width: 24mm; height: 24mm; shape-rendering: crispEdges; \}/);
  // posição: depois do bloco de pagamento
  assert.ok(html.indexOf('class="qr"') > html.indexOf('class="pay"'));
  assert.doesNotMatch(renderReceipt('retirada', { ...base, mode: 'pickup' }, store, svg), /<svg/);
  assert.doesNotMatch(renderReceipt('producao', base, store, svg), /<svg/);
  // sem rua, não há rota
  assert.equal(receiptData({ ...base, address: '' }, store).mapsUrl, '');
});

test('comanda de retirada: cliente, previsão, itens, total e pagamento; sem endereço nem QR', () => {
  const t = retirada();
  assert.match(t, /COMANDA DE RETIRADA #77 21\/11 19:40 Cliente Maria \(28\) 99999-0000 Retirada prevista: 20:20/);
  assert.match(t, /Total R\$ 24,50 PAGAMENTO EM DINHEIRO/);
  assert.doesNotMatch(t, /Dados da entrega|Rua|ROTA|Taxa de entrega/);
});

test('comanda de produção: tipo, previsão, itens, adicionais e observações; nada de valores, endereço, pagamento ou QR', () => {
  const t = producao({ notes: 'Sem cebola em nada', items: [{ name: 'Sem Parar', qty: 2, subtotal: 70, notes: 'batata sequinha', options: [{ name: 'Maionese', quantity: 1 }] }] });
  assert.match(t, /COMANDA DE PRODUÇÃO #77 21\/11 19:40 ENTREGA Pronto até 20:20 2 itens 2x Sem Parar \+ 1x Maionese em cada » batata sequinha Observações do pedido Sem cebola em nada/);
  assert.doesNotMatch(t, /R\$|Centro|Rua|Maria|COBRAR|TROCO|PIX|ROTA|Subtotal|Total/);
  assert.match(producao({ mode: 'pickup' }), /RETIRADA Pronto até 20:20/);
  // sem preparo configurado, sem previsão
  assert.doesNotMatch(textOf(renderReceipt('producao', base, { ...store, prepMinutes: 0 })), /Pronto até/);
});

test('previsão igual à da página do pedido (web/lib/orders.js)', async () => {
  const { etaOf } = await import('../web/lib/orders.js');
  const order = { ...base, delayMinutes: 15 };
  const mine = forecastOf(order, 40);
  const site = etaOf({ ...order, mode: 'DELIVERY' }, 40);
  assert.equal(mine.ready.getTime(), site.from.getTime());
  assert.match(mine.label, /Sair até 20:35 · chega até 20:50/);
});

test('via do cliente: entrega ou retirada conforme o pedido', () => {
  assert.equal(customerKind(base), 'entrega');
  assert.equal(customerKind({ ...base, mode: 'pickup' }), 'retirada');
  assert.throws(() => renderReceipt('outra', base, store), /desconhecido/);
});

test('papel de 80 mm (padrão) ou 58 mm, com margem dentro da área que a térmica imprime', () => {
  assert.deepEqual(paperOf(undefined), paperOf(80));
  const html80 = renderReceipt('entrega', base, store);
  assert.match(html80, /@page \{ margin: 0; \}/);
  assert.match(html80, /body \{ width: 80mm; padding: 2mm 4mm 1mm;/);
  const html58 = renderReceipt('entrega', base, { ...store, paperWidth: 58 }, '<svg></svg>');
  assert.match(html58, /body \{ width: 58mm; padding: 2mm 5mm 1mm;/);
  assert.match(html58, /\.qr svg \{ display: block; width: 20mm;/);
  // sem altura fixa nem mínima (a altura é a do conteúdo)
  assert.doesNotMatch(html80, /min-height|height: \d+mm; *}|100vh/);
});

test('altura do papel = conteúdo + 1 mm (sem sobra em branco nem 2ª página)', () => {
  assert.equal(pageHeightMicrons(96), 26400 + 1000 - 400); // 96 px = 25,4 mm → 26 mm + 1 mm
  assert.equal(pageHeightMicrons(851), 227000); // 225,2 mm → 226 + 1
});

test('sem script na comanda e texto do cliente escapado', () => {
  const html = renderReceipt('entrega', { ...base, notes: '<img src=x onerror=alert(1)>' }, store);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.doesNotMatch(html, /<script/);
});

test('exemplo da pré-visualização/teste vem marcado e com os dados completos', () => {
  for (const kind of ['producao', 'entrega', 'retirada']) {
    const t = textOf(renderReceipt(kind, exampleOrder(kind), store, '<svg></svg>'));
    assert.match(t, /COMANDA DE TESTE · NÃO É UM PEDIDO/);
    assert.doesNotMatch(t, /undefined|null|NaN/);
  }
});
