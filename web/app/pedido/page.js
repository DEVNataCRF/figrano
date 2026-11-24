'use client';

import { useEffect, useRef, useState } from 'react';
import Tracker from './Tracker.js';

/** /pedido/?id=...&t=1234 (os 4 últimos dígitos do WhatsApp do pedido). &novo=1 logo depois de enviar. */
export default function OrderPage() {
  const [params, setParams] = useState(null);
  // Lido uma vez só: o efeito pode rodar de novo (React de desenvolvimento) depois de o endereço já estar limpo
  const placedRef = useRef(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (placedRef.current === null) placedRef.current = q.get('novo') === '1';
    const justPlaced = placedRef.current;
    setParams({ id: q.get('id') || '', suffix: q.get('t') || '', justPlaced });
    // "Pedido realizado!" aparece uma vez: recarregar ou abrir o link depois mostra só o acompanhamento
    if (justPlaced) {
      q.delete('novo');
      window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
    }
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
  return <Tracker id={params.id} suffix={params.suffix} justPlaced={params.justPlaced} />;
}
