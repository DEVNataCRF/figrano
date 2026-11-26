'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchMenu } from '../lib/api.js';
import OrderApp from './OrderApp.js';

/** Página da loja: carrega o cardápio da API e o código do link que veio do WhatsApp (?r=). */
export default function StorePage() {
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const [refCode, setRefCode] = useState('');

  const [loading, setLoading] = useState(false);

  /** Busca o cardápio (com prazo). Usada na abertura, no "Tentar de novo" e quando o preço muda. */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMenu(await fetchMenu());
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('r') || '';
    setRefCode(/^[a-f0-9]{6,40}$/i.test(r) ? r : '');
    void load();
    // Recarrega o estado da loja (aberta/fechada) de tempos em tempos; volta sozinho quando a rede volta
    const timer = setInterval(() => fetchMenu().then((m) => { setMenu(m); setError(''); }).catch(() => {}), 60000);
    const online = () => void load();
    window.addEventListener('online', online);
    return () => { clearInterval(timer); window.removeEventListener('online', online); };
  }, [load]);

  if (error && !menu) {
    return (
      <main className="page page--error">
        <h1>{process.env.NEXT_PUBLIC_STORE_NAME || 'Cardápio da loja'}</h1>
        <p className="error" role="alert">{error}</p>
        <button type="button" className="btn btn--primary" disabled={loading} onClick={() => void load()}>
          {loading ? 'Tentando…' : 'Tentar de novo'}
        </button>
      </main>
    );
  }
  if (!menu) {
    return (
      <main className="page skeleton-page" aria-busy="true">
        <span className="sr-only">Carregando o cardápio…</span>
        <div className="skeleton skeleton--cover" />
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--line" />
        <div className="skeleton skeleton--search" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton-card">
            <div className="skeleton-card__text"><div className="skeleton skeleton--line" /><div className="skeleton skeleton--short" /><div className="skeleton skeleton--price" /></div>
            <div className="skeleton skeleton--photo" />
          </div>
        ))}
      </main>
    );
  }
  return <OrderApp menu={menu} refCode={refCode} onReload={load} />;
}
