'use client';

import { useEffect, useState } from 'react';
import { money, whatsappLink, STATUS_STEPS } from '../../../../lib/format.js';

const POLL_MS = 10000;

export default function Tracker({ slug, storeName, whatsapp, prepMinutes, order }) {
  const [status, setStatus] = useState(order.status);
  const [number, setNumber] = useState(order.number);
  const finished = status === 'done' || status === 'canceled';

  useEffect(() => {
    if (finished) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/s/${slug}/orders/${order.id}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        setStatus(data.status);
        setNumber(data.number);
      } catch { /* sem internet: tenta de novo no próximo ciclo */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [slug, order.id, finished]);

  // Entrega e retirada têm caminhos diferentes depois do preparo.
  const steps = STATUS_STEPS.filter((s) => (order.mode === 'delivery' ? s.status !== 'ready' : s.status !== 'out'));
  const current = steps.findIndex((s) => s.status === status);
  const link = whatsappLink(whatsapp, number ? `Olá! Sobre o pedido #${number}` : 'Olá! Sobre meu pedido feito pelo site');

  return (
    <main className="page track">
      <header className="store" style={{ borderBottom: 0, paddingBottom: 0 }}>
        <p className="muted">{storeName}</p>
        <h1>{status === 'canceled' ? 'Pedido cancelado' : number ? `Pedido #${number}` : 'Pedido enviado'}</h1>
        {status === 'pending' && <p className="muted">A loja vai confirmar em instantes. Você também recebe os avisos pelo WhatsApp.</p>}
        {status !== 'pending' && !finished && prepMinutes > 0 && <p className="muted">Preparo médio de {prepMinutes} min.</p>}
      </header>

      {status === 'canceled' ? (
        <p className="error">A loja cancelou este pedido. {link && <a href={link}>Fale com a loja no WhatsApp</a>}</p>
      ) : (
        <ol className="steps" aria-label="Andamento do pedido">
          {steps.map((step, index) => (
            <li key={step.status} data-state={index < current ? 'done' : index === current ? 'now' : 'next'}>{step.label}</li>
          ))}
        </ol>
      )}

      <section className="card">
        <h2>Resumo</h2>
        {order.items.map((line, index) => (
          <div key={index} className="num" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{line.qty}x {line.name}{line.notes ? <span className="muted"> ({line.notes})</span> : null}</span>
            <span>{money(line.qty * line.price)}</span>
          </div>
        ))}
        <div className="totals num">
          {order.fee > 0 && <div><span>Entrega</span><span>{money(order.fee)}</span></div>}
          <div className="grand"><span>Total</span><span>{money(order.total)}</span></div>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          {order.mode === 'delivery' ? `Entrega em ${order.address}` : 'Retirada no local'} · {order.payment}
          {order.changeFor ? ` (troco para ${money(order.changeFor)})` : ''}
        </p>
      </section>

      {link && <a className="btn btn--block" href={link}>Falar com a loja no WhatsApp</a>}
      <a className="btn btn--block" href={`/${slug}`}>Voltar ao cardápio</a>
    </main>
  );
}
