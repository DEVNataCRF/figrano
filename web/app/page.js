'use client';

import { useEffect, useState } from 'react';
import { fetchMenu } from '../lib/api.js';
import OrderApp from './OrderApp.js';

/** Página da loja: carrega o cardápio da API e o código do link que veio do WhatsApp (?r=). */
export default function StorePage() {
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const [refCode, setRefCode] = useState('');

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('r') || '';
    setRefCode(/^[a-f0-9]{6,40}$/i.test(r) ? r : '');
    fetchMenu().then(setMenu).catch((err) => setError(err.message));
    // Recarrega o estado da loja (aberta/fechada) de tempos em tempos
    const timer = setInterval(() => fetchMenu().then(setMenu).catch(() => {}), 60000);
    return () => clearInterval(timer);
  }, []);

  if (error && !menu) {
    return (
      <main className="page">
        <h1>Sabores da Sil</h1>
        <p className="error" role="alert">{error}</p>
      </main>
    );
  }
  if (!menu) {
    return (
      <main className="page">
        <p className="muted">Carregando o cardápio…</p>
      </main>
    );
  }
  return <OrderApp menu={menu} refCode={refCode} />;
}
