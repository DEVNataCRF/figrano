'use strict';

/**
 * Pedido de exemplo da pré-visualização e da "comanda de teste" em Ajustes. Sai marcado
 * "COMANDA DE TESTE · NÃO É UM PEDIDO" e nunca vai para a API nem para a cozinha.
 */
function exampleOrder(kind = 'entrega') {
  const pickup = kind === 'retirada';
  const now = Date.now();
  return {
    test: true,
    id: 'teste',
    number: 123,
    mode: pickup ? 'pickup' : 'delivery',
    createdAt: now,
    acceptedAt: new Date(now).toISOString(),
    apiStatus: 'PREPARING',
    customer: { name: 'Cliente de teste', phone: '28999990000' },
    address: pickup ? '' : 'Rua de Teste, 100 - casa azul, perto da praça',
    neighborhood: pickup ? '' : 'Centro',
    items: [
      { name: '25 salgadinhos', qty: 2, price: 27, subtotal: 54, notes: '', options: [] },
      { name: 'Sem Parar', qty: 1, price: 35, subtotal: 35, notes: 'batata bem sequinha', options: [{ name: 'Maionese', quantity: 2 }] },
    ],
    paymentMethod: 'CASH',
    payment: 'Dinheiro',
    changeFor: 100,
    notes: pickup ? '' : 'Tocar a campainha',
    subtotal: 89,
    fee: pickup ? 0 : 5,
    total: pickup ? 89 : 94,
    delayMinutes: 0,
  };
}

module.exports = { exampleOrder };
