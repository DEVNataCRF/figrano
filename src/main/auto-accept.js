'use strict';

/**
 * Aceite automático (Ajustes → Impressora da comanda): a Sil trabalha sozinha na cozinha.
 * Pedido novo vai para "Em preparo" e a comanda sai na impressora escolhida, sem ninguém tocar.
 *
 * - Só liga com impressora escolhida (sem ela, a janela do Windows ficaria esperando alguém).
 * - Cada pedido é aceito uma vez só, mesmo que o evento chegue de novo.
 * - Falhou o aceite: avisa e libera para tentar de novo (pelo painel ou no próximo evento).
 * - Aceitou mas não imprimiu: avisa para imprimir pelo painel (o pedido já está na cozinha).
 *
 * @param {object} deps
 * @param {() => {autoAccept?: boolean, printerName?: string}} deps.settings ajustes do app
 * @param {(orderId: string) => Promise<object>} deps.accept aceita na API (devolve o pedido atualizado)
 * @param {(apiOrder: object) => Promise<void>} deps.print imprime a comanda
 * @param {(title: string, body: string) => void} deps.notify aviso para a Sil
 * @param {() => void} [deps.refresh] atualiza a lista de pedidos
 */
function createAutoAccept({ settings, accept, print, notify, refresh = () => {} }) {
  const done = new Set();

  const enabled = () => {
    const s = settings() || {};
    return Boolean(s.autoAccept && s.printerName);
  };

  /** @returns {Promise<'aceito'|'aceito-sem-imprimir'|'falhou'|'desligado'|'repetido'>} */
  async function handle(order) {
    if (!enabled()) return 'desligado';
    if (done.has(order.id)) return 'repetido';
    done.add(order.id);
    let accepted;
    try {
      accepted = await accept(order.id);
    } catch (error) {
      done.delete(order.id);
      notify(`Pedido #${order.number} não foi aceito sozinho`, `${error?.message || 'Sem conexão'}. Aceite pelo painel.`);
      return 'falhou';
    }
    let result = 'aceito';
    try {
      await print(accepted);
    } catch (error) {
      result = 'aceito-sem-imprimir';
      notify(`Pedido #${order.number} aceito, mas a comanda não imprimiu`, `${error?.message || 'Impressora sem resposta.'} Imprima pelo painel.`);
    }
    try { refresh(); } catch { /* a próxima leitura atualiza */ }
    return result;
  }

  return { handle, enabled };
}

module.exports = { createAutoAccept };
