'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { money, whatsappLink } from '../../lib/format.js';

const storageKey = (slug) => `figrano:cart:${slug}`;

function loadCart(slug) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey(slug)) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveCart(slug, cart) {
  try { window.localStorage.setItem(storageKey(slug), JSON.stringify(cart)); } catch { /* sem armazenamento: segue em memória */ }
}

export default function OrderApp({ slug, refCode, store, menu, canOrder, reason }) {
  const router = useRouter();
  const items = useMemo(() => {
    const map = new Map();
    for (const category of menu) for (const item of category.items) map.set(item.id, item);
    return map;
  }, [menu]);

  const [cart, setCart] = useState([]); // [{itemId, qty, notes}]
  const [open, setOpen] = useState(false);
  const [activeCat, setActiveCat] = useState(menu[0]?.id || '');

  // O carrinho fica salvo no aparelho; itens que saíram do cardápio somem.
  useEffect(() => {
    setCart(loadCart(slug).filter((line) => items.get(line.itemId)?.available));
  }, [slug, items]);
  useEffect(() => { saveCart(slug, cart); }, [slug, cart]);

  // Destaca a categoria visível na barra de navegação.
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveCat(visible.target.id.replace('cat-', ''));
    }, { rootMargin: '-60px 0px -70% 0px' });
    for (const category of menu) {
      const el = document.getElementById(`cat-${category.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [menu]);

  const qtyOf = (itemId) => cart.filter((l) => l.itemId === itemId).reduce((n, l) => n + l.qty, 0);
  const add = (itemId) => setCart((current) => {
    const line = current.find((l) => l.itemId === itemId && !l.notes);
    if (line) return current.map((l) => (l === line ? { ...l, qty: Math.min(99, l.qty + 1) } : l));
    return [...current, { itemId, qty: 1, notes: '' }];
  });
  const removeOne = (itemId) => setCart((current) => {
    const index = current.findLastIndex((l) => l.itemId === itemId);
    if (index < 0) return current;
    const line = current[index];
    return line.qty > 1
      ? current.map((l, i) => (i === index ? { ...l, qty: l.qty - 1 } : l))
      : current.filter((_, i) => i !== index);
  });

  const count = cart.reduce((n, l) => n + l.qty, 0);
  const subtotal = cart.reduce((sum, l) => sum + l.qty * (items.get(l.itemId)?.price || 0), 0);
  const whatsapp = whatsappLink(store.whatsapp);

  return (
    <main className="page">
      <header className="store">
        <h1>{store.name}</h1>
        <span className={`status ${canOrder ? 'status--open' : 'status--closed'}`}>
          {canOrder ? 'Aberto para pedidos' : reason === 'offline' ? 'Pedidos online pausados' : 'Fechado agora'}
        </span>
        <div className="store__facts">
          {store.delivery && <span>Entrega {store.deliveryFee ? money(store.deliveryFee) : 'grátis'}</span>}
          {store.pickup && <span>Retirada no local</span>}
          {store.prepMinutes > 0 && <span>Preparo médio de {store.prepMinutes} min</span>}
          {store.minOrder > 0 && <span>Pedido mínimo {money(store.minOrder)}</span>}
        </div>
        {store.address && <p className="muted" style={{ fontSize: 14 }}>{store.address}</p>}
        {!canOrder && (
          <p className="notice">
            {reason === 'offline'
              ? 'A loja não está recebendo pedidos online neste momento.'
              : 'Estamos fechados agora. Você pode ver o cardápio e pedir quando abrirmos.'}
            {whatsapp && <> <a href={whatsapp}>Chame no WhatsApp</a>.</>}
          </p>
        )}
        {!canOrder && reason === 'closed' && (
          <details className="muted" style={{ fontSize: 14 }}>
            <summary>Horário de funcionamento</summary>
            {store.hours.map((h) => <div key={h.name}>{h.name}: {h.text}</div>)}
          </details>
        )}
      </header>

      {menu.length > 1 && (
        <nav className="cats" aria-label="Categorias">
          {menu.map((category) => (
            <a key={category.id} href={`#cat-${category.id}`} aria-current={activeCat === category.id}>{category.name}</a>
          ))}
        </nav>
      )}

      {menu.length === 0 && <p className="muted" style={{ paddingTop: 32 }}>O cardápio ainda não foi publicado.</p>}

      {menu.map((category) => (
        <section key={category.id} id={`cat-${category.id}`} className="category">
          <h2>{category.name}</h2>
          {category.items.map((item) => {
            const qty = qtyOf(item.id);
            return (
              <article key={item.id} className={`item ${item.available ? '' : 'item--out'}`}>
                <h3>{item.name}</h3>
                {item.description && <p className="item__desc">{item.description}</p>}
                <span className="item__price num">{item.available ? money(item.price) : 'Esgotado'}</span>
                {item.available && canOrder && (
                  <div className="item__action">
                    {qty === 0 ? (
                      <button className="btn" onClick={() => add(item.id)} aria-label={`Adicionar ${item.name}`}>Adicionar</button>
                    ) : (
                      <div className="stepper">
                        <button onClick={() => removeOne(item.id)} aria-label={`Tirar um ${item.name}`}>−</button>
                        <span className="num" aria-live="polite">{qty}</span>
                        <button onClick={() => add(item.id)} aria-label={`Mais um ${item.name}`}>+</button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ))}

      {count > 0 && canOrder && (
        <div className="cartbar">
          <button className="btn btn--primary btn--block" onClick={() => setOpen(true)}>
            <span>Ver pedido · {count} {count === 1 ? 'item' : 'itens'}</span>
            <span className="num">{money(subtotal)}</span>
          </button>
        </div>
      )}

      {open && (
        <Checkout
          slug={slug}
          refCode={refCode}
          store={store}
          items={items}
          cart={cart}
          setCart={setCart}
          onClose={() => setOpen(false)}
          onPlaced={(order) => {
            setCart([]);
            saveCart(slug, []);
            router.push(`/${slug}/pedido/${order.id}`);
          }}
        />
      )}
    </main>
  );
}

function Checkout({ slug, refCode, store, items, cart, setCart, onClose, onPlaced }) {
  const [mode, setMode] = useState(store.delivery ? 'delivery' : 'pickup');
  const [form, setForm] = useState(() => {
    try { return { name: '', phone: '', address: '', ...JSON.parse(window.localStorage.getItem('figrano:customer') || '{}') }; } catch { return { name: '', phone: '', address: '' }; }
  });
  const [payment, setPayment] = useState(store.payments[0] || '');
  const [changeFor, setChangeFor] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const setLine = (index, patch) => setCart((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));

  const subtotal = cart.reduce((sum, l) => sum + l.qty * (items.get(l.itemId)?.price || 0), 0);
  const fee = mode === 'delivery' ? store.deliveryFee : 0;
  const total = subtotal + fee;
  const belowMin = subtotal < store.minOrder;
  const cash = /dinheiro/i.test(payment);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSending(true);
    try {
      try { window.localStorage.setItem('figrano:customer', JSON.stringify({ name: form.name, phone: form.phone, address: form.address })); } catch { /* opcional */ }
      const response = await fetch(`/api/s/${slug}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: refCode,
          customer: { name: form.name, phone: form.phone },
          items: cart,
          mode,
          address: form.address,
          payment,
          changeFor: cash ? changeFor.replace(',', '.') : '',
          notes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível enviar o pedido. Tente de novo.');
      onPlaced(data.order);
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  }

  return (
    <div className="sheet" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="sheet__panel" role="dialog" aria-modal="true" aria-labelledby="checkout-title" onSubmit={submit}>
        <div className="sheet__head">
          <h2 id="checkout-title">Seu pedido</h2>
          <button type="button" className="close" onClick={onClose}>Continuar escolhendo</button>
        </div>

        <div className="lines">
          {cart.map((line, index) => {
            const item = items.get(line.itemId);
            if (!item) return null;
            return (
              <div key={`${line.itemId}-${index}`} className="line">
                <div>
                  <h3>{item.name}</h3>
                  <span className="muted num" style={{ fontSize: 14 }}>{money(item.price * line.qty)}</span>
                </div>
                <div className="stepper">
                  <button type="button" onClick={() => setLine(index, { qty: line.qty - 1 })} aria-label={`Tirar um ${item.name}`}>−</button>
                  <span className="num">{line.qty}</span>
                  <button type="button" onClick={() => setLine(index, { qty: Math.min(99, line.qty + 1) })} aria-label={`Mais um ${item.name}`}>+</button>
                </div>
                <label className="field line__note">
                  <input type="text" maxLength={140} placeholder="Observação (ex.: sem cebola)" value={line.notes}
                    onChange={(event) => setLine(index, { notes: event.target.value })} aria-label={`Observação para ${item.name}`} />
                </label>
              </div>
            );
          })}
        </div>

        {store.delivery && store.pickup && (
          <fieldset className="group" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field" style={{ marginBottom: 8 }}>Como quer receber?</legend>
            <div className="choice">
              <label><input type="radio" name="mode" checked={mode === 'delivery'} onChange={() => setMode('delivery')} /> Entrega</label>
              <label><input type="radio" name="mode" checked={mode === 'pickup'} onChange={() => setMode('pickup')} /> Retirada</label>
            </div>
          </fieldset>
        )}

        <div className="group">
          <label className="field">Seu nome<input type="text" required autoComplete="name" value={form.name} onChange={update('name')} /></label>
          <label className="field">WhatsApp com DDD
            <input type="tel" required autoComplete="tel" inputMode="tel" placeholder="(28) 99999-9999" value={form.phone} onChange={update('phone')} />
            <small>Os avisos do pedido chegam por aqui.</small>
          </label>
          {mode === 'delivery' && (
            <label className="field">Endereço de entrega
              <textarea required autoComplete="street-address" placeholder="Rua, número, bairro e complemento" value={form.address} onChange={update('address')} />
            </label>
          )}
        </div>

        <fieldset className="group" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field" style={{ marginBottom: 8 }}>Pagamento {mode === 'delivery' ? 'na entrega' : 'na retirada'}</legend>
          <div className="choice choice--stack">
            {store.payments.map((p) => (
              <label key={p}><input type="radio" name="payment" checked={payment === p} onChange={() => setPayment(p)} /> {p}</label>
            ))}
          </div>
          {cash && (
            <label className="field">Troco para quanto?
              <input type="text" inputMode="decimal" placeholder="Deixe vazio se não precisa" value={changeFor} onChange={(e) => setChangeFor(e.target.value)} />
            </label>
          )}
        </fieldset>

        <label className="field">Observações do pedido
          <textarea maxLength={300} placeholder="Algo que a loja precisa saber?" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="totals num">
          <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
          {mode === 'delivery' && <div><span>Entrega</span><span>{fee ? money(fee) : 'Grátis'}</span></div>}
          <div className="grand"><span>Total</span><span>{money(total)}</span></div>
        </div>

        {belowMin && <p className="error">O pedido mínimo é {money(store.minOrder)}. Faltam {money(store.minOrder - subtotal)}.</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <button className="btn btn--primary btn--block" disabled={sending || belowMin || cart.length === 0}>
          {sending ? 'Enviando…' : `Enviar pedido · ${money(total)}`}
        </button>
      </form>
    </div>
  );
}
