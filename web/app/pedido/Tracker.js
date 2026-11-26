'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { money, whatsappLink } from '../../lib/format.js';
import { PAYMENT_LABELS, fetchMenu, trackOrder } from '../../lib/api.js';
import { contactOf } from '../../lib/store.js';
import { continueText, etaOf, nextPollDelay, timelineOf } from '../../lib/orders.js';
import StorePhoto from '../StorePhoto.js';

function readStorage(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
}

const clock = (date) => date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Selo do cabeçalho: o nome curto da etapa de agora. */
const BADGE = {
  AWAITING_PIX: ['Aguardando Pix', 'wait'],
  NEW: ['Aguardando confirmação', 'wait'],
  PREPARING: ['Em preparo', 'work'],
  OUT_FOR_DELIVERY: ['Saiu para entrega', 'work'],
  READY_FOR_PICKUP: ['Pronto para retirar', 'work'],
  DONE: ['Concluído', 'ok'],
  CANCELED: ['Cancelado', 'off'],
};

/** Acompanhamento do pedido: status da loja a cada 10 s. */
export default function Tracker({ id, suffix, justPlaced = false }) {
  const [order, setOrder] = useState(null);
  const [store, setStore] = useState({ name: 'Nossa loja', whatsapp: '', prepMinutes: 0, owner: '', photos: new Map() });
  const who = contactOf(store.owner);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // Última atualização que deu certo: com falha depois, o status antigo fica marcado como desatualizado
  const [lastOk, setLastOk] = useState(null);
  const [errorStatus, setErrorStatus] = useState(0);
  const [checking, setChecking] = useState(false);
  const failures = useRef(0);
  const timer = useRef(null);
  const saved = typeof window !== 'undefined' ? readStorage(`sabores:delivery:order:${id}`) : null;
  const finished = order && (order.status === 'DONE' || order.status === 'CANCELED');

  useEffect(() => {
    fetchMenu()
      .then((m) => {
        // Fotos pelo nome do item: o pedido guarda o nome do dia em que foi feito
        const photos = new Map();
        for (const c of m.categories || []) for (const i of c.items || []) if (i.photoUrl) photos.set(i.name, i.photoUrl);
        setStore({ name: m.companyName, whatsapp: m.whatsappPhone, prepMinutes: m.config.prepMinutes, owner: m.ownerName || '', photos });
      })
      .catch(() => {});
  }, []);

  /**
   * Consulta a loja e agenda a próxima: 10 s normalmente, mais espaçado depois de falhas
   * (até 60 s), parado com a aba em segundo plano e quando o pedido termina.
   */
  const load = useCallback(async () => {
    clearTimeout(timer.current);
    setChecking(true);
    let status = 0;
    let done = false;
    try {
      const o = await trackOrder(id, suffix);
      setOrder(o);
      setError('');
      setLastOk(Date.now());
      setNow(Date.now());
      failures.current = 0;
      done = o.status === 'DONE' || o.status === 'CANCELED';
    } catch (err) {
      failures.current += 1;
      status = err.status || 0;
      setErrorStatus(status);
      setError(err.message);
    } finally {
      setChecking(false);
    }
    if (!done && document.visibilityState !== 'hidden') {
      timer.current = setTimeout(() => void load(), nextPollDelay(failures.current, status));
    }
  }, [id, suffix]);

  useEffect(() => {
    void load();
    // Volta a consultar na hora quando a pessoa volta para a aba ou a internet volta
    const resume = () => { if (document.visibilityState !== 'hidden') void load(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [load]);

  // "Agora" anda sozinho (previsão e atraso) mesmo sem resposta nova da loja
  useEffect(() => {
    if (finished) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(tick);
  }, [finished]);

  if (error && !order) {
    const notFound = errorStatus === 404 || errorStatus === 400;
    return (
      <main className="page track">
        <h1>{notFound ? 'Pedido não encontrado' : 'Não deu para carregar seu pedido'}</h1>
        <p className="error" role="alert">{error}</p>
        {!notFound && (
          <button type="button" className="btn btn--primary btn--block" disabled={checking} onClick={() => { failures.current = 0; void load(); }}>
            {checking ? 'Tentando…' : 'Tentar de novo'}
          </button>
        )}
        <a className="btn btn--block" href="/">Voltar ao cardápio</a>
      </main>
    );
  }
  if (!order) return <main className="page"><p className="muted">Carregando seu pedido…</p></main>;

  // O passo do Pix só para quem escolheu pagar pelo site
  const pixFlow = order.status === 'AWAITING_PIX' || Boolean(saved?.pixOnline);
  const steps = timelineOf(order, pixFlow);
  const link = whatsappLink(store.whatsapp, `Olá! Sobre o pedido #${order.number}`);
  const continueLink = whatsappLink(store.whatsapp, continueText(order.number));
  const delay = Number(order.delayMinutes) || 0;
  const eta = !finished && !['NEW', 'AWAITING_PIX'].includes(order.status) ? etaOf(order, store.prepMinutes) : null;
  const late = Boolean(eta) && now > eta.lateAfter.getTime();
  const lines = order.items?.length
    ? order.items.map((i) => ({ name: i.name, qty: i.quantity, price: i.unitPrice, notes: i.notes, extras: (i.options || []).map((o) => `${o.quantity}x ${o.name}`) }))
    : saved?.items || [];
  const subtotal = order.subtotal ?? lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  const [badge, tone] = BADGE[order.status] || [order.statusLabel || 'Em andamento', 'work'];
  const pixOnline = order.paymentMethod === 'PIX' && pixFlow;

  return (
    <main className="page track">
      {/* Falhou depois de já ter mostrado o pedido: o status abaixo pode estar velho (QA10) */}
      {error && (
        <div className="stale" role="alert">
          <p>
            <strong>Sem atualização da loja{lastOk ? ` desde ${clock(new Date(lastOk))}` : ''}.</strong>{' '}
            Mostrando o último status conhecido. {error}
          </p>
          <button type="button" className="btn btn--ghost" disabled={checking} onClick={() => { failures.current = 0; void load(); }}>
            {checking ? 'Atualizando…' : 'Atualizar agora'}
          </button>
        </div>
      )}

      <header className="track__head">
        <a className="icon-btn" href="/" aria-label="Voltar ao cardápio">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
        <div>
          <p className="muted">{store.name}</p>
          <h1>Pedido #{order.number}</h1>
        </div>
        {/* Região "ao vivo": o leitor de tela anuncia quando o status muda sozinho (a tela consulta a loja) */}
        <span className={`badge badge--${tone}`} role="status" aria-live="polite" aria-atomic="true">{badge}</span>
      </header>

      {justPlaced && order.status !== 'AWAITING_PIX' && order.status !== 'CANCELED' && (
        <section className="card placed" aria-labelledby="placed-title">
          <span className="placed__check" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="22" height="22"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <h2 id="placed-title">Pedido realizado!</h2>
          <p className="muted">{who.A} já recebeu. Acompanhe o andamento aqui ou receba os avisos no WhatsApp.</p>
          {continueLink && (
            <a className="btn btn--whatsapp btn--block" href={continueLink}>
              <WhatsAppIcon />
              Continuar no WhatsApp
            </a>
          )}
        </section>
      )}

      {order.status === 'AWAITING_PIX' && order.pix && <PixBox pix={order.pix} number={order.number} who={who} />}

      {order.status === 'CANCELED' ? (
        <p className="error">{who.A} cancelou este pedido. {link && <a href={link}>Fale com {who.a} no WhatsApp</a>}</p>
      ) : (
        <section className="card">
          <h2>Status do pedido</h2>
          {order.status === 'NEW' && <p className="muted">{who.A} vai confirmar em instantes. Os avisos também chegam no seu WhatsApp.</p>}
          {eta && (
            <p className={`eta${delay ? ' eta--delay' : ''}`}>
              {eta.kind === 'window'
                ? <>Previsão de entrega <strong>entre {clock(eta.from)} e {clock(eta.to)}</strong></>
                : <>Pronto para retirar <strong>por volta das {clock(eta.from)}</strong></>}
              {delay > 0 && <span className="eta__note">{who.A} avisou um atraso de {delay} min. Desculpe a espera!</span>}
            </p>
          )}
          {late && <p className="eta eta--late" role="status">Está levando mais que o previsto. {link ? <a href={link}>Falar com {who.a} no WhatsApp</a> : 'Já já chega!'}</p>}
          <ol className="steps" aria-label="Andamento do pedido">
            {steps.map((step) => (
              <li key={step.status} data-state={step.state} aria-current={step.state === 'now' ? 'step' : undefined}>
                <span className="steps__dot" aria-hidden="true">{step.state === 'done' && <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
                <span>{step.at && <time className="num" dateTime={step.at.toISOString()}>{clock(step.at)} · </time>}{step.label}{step.state === 'done' && <span className="sr-only"> (concluído)</span>}{step.state === 'now' && <span className="sr-only"> (etapa atual)</span>}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="card">
        <h2>Detalhes do pedido</h2>
        <div className="track__facts">
          <div>
            <strong>{order.mode === 'DELIVERY' ? 'Entrega' : 'Retirada no local'}</strong>
            {order.mode === 'DELIVERY' && saved?.address && <span className="muted">{saved.address}</span>}
          </div>
          <div>
            <strong>{PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}</strong>
            <span className="muted">
              {pixOnline ? 'Pix pelo site, com comprovante no WhatsApp'
                : order.paymentMethod === 'CASH' ? (order.changeFor ? `Troco para ${money(order.changeFor)}` : 'Sem troco')
                : `Na ${order.mode === 'DELIVERY' ? 'entrega' : 'retirada'}`}
            </span>
          </div>
        </div>
        <h3 className="track__items-title">Itens do pedido</h3>
        <ul className="track__items">
          {lines.map((line, index) => {
            const photo = store.photos.get(line.name);
            return (
              <li key={index}>
                {photo ? <StorePhoto className="track__photo" src={photo} alt="" /> : <span className="track__photo track__photo--empty" aria-hidden="true" />}
                <div>
                  <p><strong>{line.qty} × {line.name}</strong></p>
                  {line.extras?.length > 0 && (
                    <div className="track__extras">
                      <p className="muted">Adicionais{line.qty > 1 ? ' (em cada)' : ''}</p>
                      <ul>{line.extras.map((e) => <li key={e}>{e}</li>)}</ul>
                    </div>
                  )}
                  {line.notes && <p className="muted">Obs.: {line.notes}</p>}
                  <p className="num">{money(line.qty * line.price)}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="totals num">
          <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
          {order.mode === 'DELIVERY' && <div><span>Taxa de entrega</span><span>{order.deliveryFee > 0 ? money(order.deliveryFee) : 'Grátis'}</span></div>}
          <div className="grand"><span>Total</span><span>{money(order.total)}</span></div>
        </div>
      </section>

      {link && <a className="btn btn--whatsapp btn--block" href={link}><WhatsAppIcon />Falar com {who.a} no WhatsApp</a>}
      <a className="btn btn--block" href="/">Voltar ao cardápio</a>
    </main>
  );
}

/** Ícone do WhatsApp dos botões verdes. */
function WhatsAppIcon() {
  return <svg className="wa-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3c-.2.3-.9.9-.9 2.2s1 2.6 1.1 2.7c.1.2 1.9 2.9 4.6 4 1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z" /></svg>;
}

/** Pix copia e cola + envio do comprovante. Sem o comprovante, o pedido não vai para a cozinha. */
function PixBox({ pix, number, who }) {
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
        <li>Mande o <b>comprovante</b> no WhatsApp {who.da}. Seu pedido #{number} só vai para a cozinha depois que {who.a} receber.</li>
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
