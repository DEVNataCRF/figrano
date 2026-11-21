'use client';

import { useEffect, useState } from 'react';
import { money, whatsappLink, STATUS_STEPS } from '../../lib/format.js';
import { PAYMENT_LABELS, fetchMenu, trackOrder } from '../../lib/api.js';
import { contactOf } from '../../lib/store.js';

const POLL_MS = 10000;

function readStorage(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
}

/** Acompanhamento do pedido: status da loja a cada 10 s. */
export default function Tracker({ id, suffix }) {
  const [order, setOrder] = useState(null);
  const [store, setStore] = useState({ name: 'Nossa loja', whatsapp: '', prepMinutes: 0, owner: '' });
  const who = contactOf(store.owner);
  const [error, setError] = useState('');
  const saved = typeof window !== 'undefined' ? readStorage(`sabores:delivery:order:${id}`) : null;
  const finished = order && (order.status === 'DONE' || order.status === 'CANCELED');

  useEffect(() => {
    fetchMenu()
      .then((m) => setStore({ name: m.companyName, whatsapp: m.whatsappPhone, prepMinutes: m.config.prepMinutes, owner: m.ownerName || '' }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let timer;
    const load = () => trackOrder(id, suffix).then((o) => { setOrder(o); setError(''); }).catch((err) => setError(err.message));
    load();
    if (!finished) timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [id, suffix, finished]);

  if (error && !order) {
    return (
      <main className="page track">
        <h1>Pedido não encontrado</h1>
        <p className="error" role="alert">{error}</p>
        <a className="btn btn--block" href="/">Voltar ao cardápio</a>
      </main>
    );
  }
  if (!order) return <main className="page"><p className="muted">Carregando seu pedido…</p></main>;

  // Entrega e retirada têm caminhos diferentes depois do preparo; o passo do Pix só para quem pagou pelo site.
  const pixFlow = order.status === 'AWAITING_PIX' || Boolean(saved?.pixOnline);
  const steps = STATUS_STEPS.filter(
    (s) => (order.mode === 'DELIVERY' ? s.status !== 'READY_FOR_PICKUP' : s.status !== 'OUT_FOR_DELIVERY') && (pixFlow || s.status !== 'AWAITING_PIX'),
  );
  const current = steps.findIndex((s) => s.status === order.status);
  const link = whatsappLink(store.whatsapp, `Olá! Sobre o pedido #${order.number}`);
  // Previsão: hora do pedido + preparo (+15 min de entrega), no horário de quem está vendo
  // Previsão: conta de quando a loja aceitou (ou do pedido, antes disso) + preparo (+15 min de entrega)
  // + o atraso que a loja avisou. Recalcula a cada atualização (10 s).
  const delay = Number(order.delayMinutes) || 0;
  const etaMinutes = store.prepMinutes > 0 ? store.prepMinutes + (order.mode === 'DELIVERY' ? 15 : 0) : 0;
  const etaAt = etaMinutes && (order.acceptedAt || order.createdAt) ? new Date(new Date(order.acceptedAt || order.createdAt).getTime() + (etaMinutes + delay) * 60000) : null;
  const eta = etaAt ? etaAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const late = Boolean(etaAt) && !finished && Date.now() > etaAt.getTime() + 5 * 60000;
  const lines = order.items?.length ? order.items.map((i) => ({ name: i.name, qty: i.quantity, price: i.unitPrice, notes: i.notes })) : saved?.items || [];

  return (
    <main className="page track">
      <header className="store" style={{ borderBottom: 0, paddingBottom: 0 }}>
        <p className="muted">{store.name}</p>
        <h1>{order.status === 'CANCELED' ? 'Pedido cancelado' : `Pedido #${order.number}`}</h1>
        {order.status === 'AWAITING_PIX' && <p className="muted">Falta só o Pix: pague e mande o comprovante no WhatsApp {who.da}.</p>}
        {order.status === 'NEW' && <p className="muted">A loja vai confirmar em instantes. Você também recebe os avisos pelo WhatsApp.</p>}
        {!finished && order.status !== 'NEW' && order.status !== 'AWAITING_PIX' && eta && (
          <>
            <p className={`eta${delay ? ' eta--delay' : ''}`}>{order.mode === 'DELIVERY' ? 'Previsão de chegada' : 'Pronto para retirar'}: <strong>por volta das {eta}</strong>{delay > 0 && <span className="eta__note">A loja avisou um atraso de {delay} min. Desculpe a espera!</span>}</p>
            {late && <p className="eta eta--late" role="status">Está levando mais que o previsto. {link ? <a href={link}>Falar com {who.a} no WhatsApp</a> : 'Já já chega!'}</p>}
          </>
        )}
      </header>

      {order.status === 'AWAITING_PIX' && order.pix && <PixBox pix={order.pix} number={order.number} />}

      {order.status === 'CANCELED' ? (
        <p className="error">A loja cancelou este pedido. {link && <a href={link}>Fale com {who.a} no WhatsApp</a>}</p>
      ) : (
        <ol className="steps" aria-label="Andamento do pedido">
          {steps.map((step, index) => (
            <li key={step.status} data-state={index < current ? 'done' : index === current ? 'now' : 'next'} aria-current={index === current ? 'step' : undefined}>
              <span className="steps__dot" aria-hidden="true">{index < current && <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}

      <section className="card">
        <h2>Resumo</h2>
        {lines.map((line, index) => (
          <div key={index} className="num" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{line.qty}x {line.name}{line.notes ? <span className="muted"> ({line.notes})</span> : null}</span>
            <span>{money(line.qty * line.price)}</span>
          </div>
        ))}
        <div className="totals num">
          {order.deliveryFee > 0 && <div><span>Entrega</span><span>{money(order.deliveryFee)}</span></div>}
          <div className="grand"><span>Total</span><span>{money(order.total)}</span></div>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          {order.mode === 'DELIVERY' ? `Entrega${saved?.address ? ` em ${saved.address}` : ''}` : 'Retirada no local'} · {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}
          {order.changeFor ? ` (troco para ${money(order.changeFor)})` : ''}
        </p>
      </section>

      {link && <a className="btn btn--block" href={link}>Falar com {who.a} no WhatsApp</a>}
      <a className="btn btn--block" href="/">Voltar ao cardápio</a>
    </main>
  );
}

/** Pix copia e cola + envio do comprovante. Sem o comprovante, o pedido não vai para a cozinha. */
function PixBox({ pix, number }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(pix.copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section className="card pix">
      <h2>Pague com Pix</h2>
      <p className="pix__amount num">{money(pix.amount)}</p>
      <ol className="pix__steps">
        <li>Copie o código abaixo e cole no app do seu banco, em <b>Pix copia e cola</b>.</li>
        <li>Mande o <b>comprovante</b> no WhatsApp {who.da}. Seu pedido #{number} só vai para a cozinha depois que ela receber.</li>
      </ol>
      <label className="field">
        Código Pix
        <textarea readOnly value={pix.copyPaste} rows={4} onFocus={(e) => e.target.select()} />
      </label>
      <button type="button" className="btn btn--block" onClick={copy}>{copied ? 'Código copiado!' : 'Copiar código Pix'}</button>
      <a className="btn btn--primary btn--block" href={pix.whatsappLink}>Enviar comprovante no WhatsApp</a>
    </section>
  );
}

