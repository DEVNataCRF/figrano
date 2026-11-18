'use client';

import { useEffect, useState } from 'react';
import Tracker from './Tracker.js';

/** /pedido/?id=...&t=1234 (os 4 últimos dígitos do WhatsApp do pedido). */
export default function OrderPage() {
  const [params, setParams] = useState(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setParams({ id: q.get('id') || '', suffix: q.get('t') || '' });
  }, []);
  if (!params) return null;
  if (!params.id || params.suffix.length < 4) {
    return (
      <main className="page">
        <h1>Pedido não encontrado</h1>
        <p className="muted">Use o link que apareceu ao enviar o pedido.</p>
        <a className="btn btn--block" href="/">Ver o cardápio</a>
      </main>
    );
  }
  return <Tracker id={params.id} suffix={params.suffix} />;
}
