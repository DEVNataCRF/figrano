'use client';

import { useEffect, useRef, useState } from 'react';
import { STATUS_STEPS, displayPhone, money } from '../lib/format.js';
import { fetchMyOrders, requestLoginCode, trackOrder, verifyLoginCode } from '../lib/api.js';
import { orderWhen, phoneDigits, repeatLinesOf, sessionFrom, sessionKey, validPhone, validSession } from '../lib/account.js';

const STATUS_LABEL = Object.fromEntries(STATUS_STEPS.map((s) => [s.status, s.label]));
const statusText = (status, fallback = 'Em andamento') =>
  status === 'DONE' ? 'Concluído' : status === 'CANCELED' ? 'Cancelado' : STATUS_LABEL[status] || fallback;
const RESEND_SECONDS = 60;

function readStorage(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* sem armazenamento: vale só nesta visita */ }
}

/**
 * Aba "Meus pedidos": quem entrou com o celular vê todos os pedidos (de qualquer aparelho);
 * quem não entrou vê o convite para entrar e os pedidos feitos neste aparelho.
 */
export default function MyOrdersPanel({ slug, localOrders, items, canOrder, onRepeat }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setSession(validSession(readStorage(sessionKey(slug), null)));
    setReady(true);
  }, [slug]);

  const logout = (message = '') => {
    writeStorage(sessionKey(slug), null);
    setSession(null);
    setNotice(message);
  };

  if (!ready) return null;
  if (session) {
    return <History session={session} items={items} canOrder={canOrder} onRepeat={onRepeat} onLogout={logout} />;
  }
  return (
    <div className="account">
      <Login
        slug={slug}
        notice={notice}
        onLogged={(data) => {
          const next = sessionFrom(data);
          writeStorage(sessionKey(slug), next);
          setNotice('');
          setSession(next);
        }}
      />
      {localOrders.length > 0 && (
        <section className="account__local" aria-labelledby="pedidos-aparelho">
          <h3 id="pedidos-aparelho">Feitos neste aparelho</h3>
          <LocalOrders orders={localOrders} />
        </section>
      )}
    </div>
  );
}

/** Entrar com o celular: número → código no WhatsApp → pronto. */
function Login({ slug, notice, onLogged }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef(null);

  // O número usado no último pedido já vem preenchido
  useEffect(() => {
    const saved = readStorage(`sabores:delivery:customer:${slug}`, {});
    if (typeof saved?.phone === 'string' && saved.phone) setPhone(displayPhone(saved.phone));
  }, [slug]);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  async function sendCode(event) {
    event?.preventDefault();
    if (busy) return;
    if (!validPhone(phone)) { setError('Digite o celular com DDD, como (28) 99999-9999.'); return; }
    setBusy(true);
    setError('');
    try {
      await requestLoginCode(phoneDigits(phone));
      setStep('code');
      setCode('');
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(value = code) {
    if (busy) return;
    if (!/^\d{6}$/.test(value)) { setError('O código tem 6 números.'); return; }
    setBusy(true);
    setError('');
    try {
      onLogged(await verifyLoginCode(phoneDigits(phone), value));
    } catch (err) {
      setError(err.message);
      setCode('');
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (step === 'code') {
    return (
      <form className="account__box" onSubmit={(e) => { e.preventDefault(); confirm(); }} noValidate>
        <div>
          <p className="account__title">Digite o código</p>
          <p className="muted">
            Mandamos um código de 6 números para o WhatsApp <strong className="num">{displayPhone(phoneDigits(phone))}</strong>.
            Ele chega se esse número já fez pedido com a gente.
          </p>
        </div>
        <label className="field">
          <span>Código</span>
          <input
            ref={codeRef}
            className="account__code num"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(value);
              if (value.length === 6) confirm(value);
            }}
          />
        </label>
        {error && <p id="login-error" className="account__error" role="alert">{error}</p>}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy || code.length !== 6}>
          {busy ? 'Conferindo…' : 'Entrar'}
        </button>
        <div className="account__links">
          <button type="button" className="link" onClick={() => { setStep('phone'); setError(''); }}>Trocar número</button>
          <button type="button" className="link" disabled={wait > 0 || busy} onClick={() => sendCode()}>
            {wait > 0 ? `Mandar de novo em ${wait}s` : 'Mandar o código de novo'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="account__box" onSubmit={sendCode} noValidate>
      <div>
        <p className="account__title">Veja todos os seus pedidos</p>
        <p className="muted">Entre com o celular que você usa para pedir. Funciona em qualquer aparelho e dá para pedir de novo com um toque.</p>
      </div>
      {notice && <p className="account__error" role="status">{notice}</p>}
      <label className="field">
        <span>Celular com WhatsApp</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="(28) 99999-9999"
          value={phone}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'login-error' : undefined}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      {error && <p id="login-error" className="account__error" role="alert">{error}</p>}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
        {busy ? 'Enviando…' : 'Receber código no WhatsApp'}
      </button>
    </form>
  );
}

/** Histórico de quem entrou, buscado na loja (o andamento é o de agora). */
function History({ session, items, canOrder, onRepeat, onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError('');
    fetchMyOrders(session.token)
      .then((result) => { if (alive) setData(result); })
      .catch((err) => {
        if (!alive) return;
        if (err.status === 401) onLogout('Sua entrada venceu. Entre de novo com o celular.');
        else setError(err.message);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, attempt]);

  const name = (data?.customer?.name || session.name || '').split(/\s+/)[0];
  const orders = data?.orders || [];
  return (
    <div className="account">
      <div className="account__who">
        <p>
          <strong>{name ? `Olá, ${name}!` : 'Olá!'}</strong>
          <span className="muted num"> Entrou com {data?.customer?.phone || session.phone}</span>
        </p>
        <button type="button" className="link" onClick={() => onLogout()}>Sair</button>
      </div>

      {error ? (
        <p className="account__error" role="alert">
          {error} <button type="button" className="link" onClick={() => setAttempt((n) => n + 1)}>Tentar de novo</button>
        </p>
      ) : !data ? (
        <p className="muted" role="status">Buscando seus pedidos…</p>
      ) : orders.length === 0 ? (
        <p className="empty">Ainda não tem pedido com esse número. Quando você pedir, ele aparece aqui.</p>
      ) : (
        <ul className="my-orders">
          {orders.map((o) => {
            const active = !['DONE', 'CANCELED'].includes(o.status);
            const names = o.items.map((l) => `${l.quantity}× ${l.name}`).join(', ');
            const link = `/pedido/?id=${encodeURIComponent(o.id)}&t=${o.suffix}`;
            const lines = repeatLinesOf(o, items);
            const available = lines.some((l) => items.get(l.itemId));
            return (
              <li key={o.id} className={`my-orders__card${active ? ' my-orders__card--active' : ''}`}>
                <a href={link}>
                  <span className="my-orders__top">
                    <strong>Pedido #{o.number}</strong>
                    <span className={active ? 'my-orders__status--active' : 'muted'}>{statusText(o.status, o.statusLabel)}</span>
                  </span>
                  {names && <span className="my-orders__items">{names}</span>}
                  <span className="my-orders__meta muted num">
                    {orderWhen(o.createdAt)} · {money(o.total)} · {o.mode === 'DELIVERY' ? 'Entrega' : 'Retirada'}
                  </span>
                </a>
                <div className="my-orders__actions">
                  <a href={link} className="link">{active ? 'Acompanhar' : 'Ver detalhes'}</a>
                  {!active && canOrder && available && (
                    <button type="button" className="btn" onClick={() => onRepeat(lines)}>Pedir de novo</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Pedidos feitos neste aparelho, com o andamento de cada um consultado na hora. */
function LocalOrders({ orders }) {
  const [status, setStatus] = useState({});
  useEffect(() => {
    let alive = true;
    for (const o of orders) {
      trackOrder(o.id, o.suffix)
        .then((t) => { if (alive) setStatus((s) => ({ ...s, [o.id]: t })); })
        .catch(() => { if (alive) setStatus((s) => ({ ...s, [o.id]: null })); });
    }
    return () => { alive = false; };
  }, [orders]);
  return (
    <ul className="my-orders">
      {orders.map((o) => {
        const t = status[o.id];
        const names = (o.items || []).map((l) => `${l.qty}× ${l.name}`).join(', ');
        const label = t === undefined ? 'Consultando…' : !t ? 'Indisponível' : statusText(t.status);
        const total = t?.total ?? o.total;
        return (
          <li key={o.id}>
            <a href={`/pedido/?id=${encodeURIComponent(o.id)}&t=${o.suffix}`}>
              <span className="my-orders__top"><strong>Pedido #{o.number}</strong><span className="muted">{label}</span></span>
              {names && <span className="my-orders__items">{names}</span>}
              <span className="my-orders__meta muted num">{o.createdAt ? orderWhen(o.createdAt) : ''}{total ? ` · ${money(total)}` : ''}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
