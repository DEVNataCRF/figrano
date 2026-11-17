'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { money, whatsappLink } from '../../lib/format.js';

const cartKey = (slug) => `figrano:cart:${slug}`;
const normalize = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem armazenamento: segue em memória */ }
}

const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function OrderApp({ slug, refCode, store, menu, canOrder, reason }) {
  const router = useRouter();
  const items = useMemo(() => {
    const map = new Map();
    for (const category of menu) for (const item of category.items) map.set(item.id, item);
    return map;
  }, [menu]);

  // Linha da sacola: { key, itemId, qty, notes }. Mesmo item com observação diferente vira outra linha.
  const [cart, setCart] = useState([]);
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState(null);
  const [sheet, setSheet] = useState(null); // 'bag' | 'checkout' | null
  const [showInfo, setShowInfo] = useState(false);
  const [activeCat, setActiveCat] = useState(menu[0]?.id || '');

  useEffect(() => {
    const saved = readStorage(cartKey(slug), []);
    setCart(Array.isArray(saved) ? saved.filter((line) => items.get(line.itemId)?.available) : []);
  }, [slug, items]);
  useEffect(() => { writeStorage(cartKey(slug), cart); }, [slug, cart]);

  // Destaca na barra a categoria que está na tela.
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveCat(visible.target.id.replace('cat-', ''));
    }, { rootMargin: '-120px 0px -65% 0px' });
    for (const category of menu) {
      const el = document.getElementById(`cat-${category.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [menu, query]);

  // Trava a rolagem do fundo enquanto uma janela está aberta.
  useEffect(() => {
    document.body.style.overflow = product || sheet ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [product, sheet]);

  const visibleMenu = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return menu;
    return menu
      .map((category) => ({ ...category, items: category.items.filter((item) => normalize(`${item.name} ${item.description}`).includes(q)) }))
      .filter((category) => category.items.length > 0);
  }, [menu, query]);

  const addToCart = (itemId, qty, notes) => setCart((current) => {
    const clean = notes.trim();
    const line = current.find((l) => l.itemId === itemId && l.notes === clean);
    if (line) return current.map((l) => (l === line ? { ...l, qty: Math.min(99, l.qty + qty) } : l));
    return [...current, { key: `${itemId}-${Date.now()}`, itemId, qty, notes: clean }];
  });
  const setQty = (key, qty) => setCart((current) => current.map((l) => (l.key === key ? { ...l, qty } : l)).filter((l) => l.qty > 0));

  const count = cart.reduce((n, l) => n + l.qty, 0);
  const subtotal = cart.reduce((sum, l) => sum + l.qty * (items.get(l.itemId)?.price || 0), 0);
  const whatsapp = whatsappLink(store.whatsapp);
  const qtyInCart = (itemId) => cart.filter((l) => l.itemId === itemId).reduce((n, l) => n + l.qty, 0);

  const facts = [
    store.prepMinutes > 0 && `${store.prepMinutes}–${store.prepMinutes + 15} min`,
    store.delivery && (store.deliveryFee ? `Entrega ${money(store.deliveryFee)}` : 'Entrega grátis'),
    store.minOrder > 0 && `Mínimo ${money(store.minOrder)}`,
  ].filter(Boolean);

  return (
    <div className="shop">
      <header className="hero">
        <div className="hero__cover" style={store.cover ? { backgroundImage: `url(${store.cover})` } : undefined} />
        <div className="hero__body">
          <div className="hero__logo">
            {store.logo ? <img src={store.logo} alt="" /> : <span aria-hidden="true">{initials(store.name)}</span>}
          </div>
          <div className="hero__text">
            <h1>{store.name}</h1>
            <div className="hero__facts">
              <span className={`status ${canOrder ? 'status--open' : 'status--closed'}`}>
                {canOrder ? 'Aberto' : reason === 'offline' ? 'Pedidos pausados' : 'Fechado'}
              </span>
              {facts.map((fact) => <span key={fact}>{fact}</span>)}
            </div>
            <button type="button" className="link" onClick={() => setShowInfo((v) => !v)} aria-expanded={showInfo}>
              {showInfo ? 'Ocultar informações' : 'Horários e endereço'}
            </button>
          </div>
        </div>
        {showInfo && (
          <div className="hero__info">
            {store.address && <p><strong>Endereço:</strong> {store.address}</p>}
            {store.pickup && <p>Retirada no local disponível.</p>}
            <div className="hours">
              {store.hours.map((h) => <div key={h.name}><span>{h.name}</span><span>{h.text}</span></div>)}
            </div>
          </div>
        )}
        {!canOrder && (
          <p className="notice">
            {reason === 'offline'
              ? 'A loja não está recebendo pedidos pelo site agora.'
              : 'Estamos fechados agora. Dá para olhar o cardápio e pedir quando abrirmos.'}
            {whatsapp && <> <a href={whatsapp}>Falar no WhatsApp</a></>}
          </p>
        )}
      </header>

      <div className="layout">
        <main className="menu">
          <div className="toolbar">
            <label className="search">
              <span className="sr-only">Buscar no cardápio</span>
              <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13 13l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <input type="search" placeholder="Buscar no cardápio" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {!query && menu.length > 1 && (
              <nav className="tabs" aria-label="Categorias">
                {menu.map((category) => (
                  <a key={category.id} href={`#cat-${category.id}`} aria-current={activeCat === category.id}>{category.name}</a>
                ))}
              </nav>
            )}
          </div>

          {menu.length === 0 && <p className="empty">O cardápio ainda não foi publicado.</p>}
          {query && visibleMenu.length === 0 && <p className="empty">Nada encontrado para “{query}”.</p>}

          {visibleMenu.map((category) => (
            <section key={category.id} id={`cat-${category.id}`} className="category">
              <h2>{category.name}</h2>
              <div className="products">
                {category.items.map((item) => {
                  const inCart = qtyInCart(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`product ${item.available ? '' : 'product--out'}`}
                      onClick={() => item.available && setProduct(item)}
                      disabled={!item.available}
                    >
                      <span className="product__text">
                        <span className="product__name">{inCart > 0 && <span className="product__count">{inCart}x</span>}{item.name}</span>
                        {item.description && <span className="product__desc">{item.description}</span>}
                        <span className="product__price num">{item.available ? money(item.price) : 'Esgotado'}</span>
                      </span>
                      {item.photo && <img className="product__img" src={item.photo} alt="" loading="lazy" />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </main>

        <aside className="side" aria-label="Sacola">
          <Bag cart={cart} items={items} setQty={setQty} subtotal={subtotal} store={store} canOrder={canOrder}
            onCheckout={() => setSheet('checkout')} />
        </aside>
      </div>

      {count > 0 && (
        <div className="bagbar">
          <button className="btn btn--primary btn--block" onClick={() => setSheet('bag')}>
            <span className="bagbar__count num">{count}</span>
            <span>Ver sacola</span>
            <span className="num">{money(subtotal)}</span>
          </button>
        </div>
      )}

      {product && (
        <ProductSheet
          item={product}
          canOrder={canOrder}
          onClose={() => setProduct(null)}
          onAdd={(qty, notes) => { addToCart(product.id, qty, notes); setProduct(null); }}
        />
      )}

      {sheet === 'bag' && (
        <Sheet title="Sua sacola" onClose={() => setSheet(null)}>
          <Bag cart={cart} items={items} setQty={setQty} subtotal={subtotal} store={store} canOrder={canOrder}
            onCheckout={() => setSheet('checkout')} bare />
        </Sheet>
      )}

      {sheet === 'checkout' && (
        <Sheet title="Finalizar pedido" onClose={() => setSheet(null)}>
          <Checkout
            slug={slug}
            refCode={refCode}
            store={store}
            items={items}
            cart={cart}
            onPlaced={(order) => {
              setCart([]);
              writeStorage(cartKey(slug), []);
              router.push(`/${slug}/pedido/${order.id}`);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet__panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ProductSheet({ item, canOrder, onClose, onAdd }) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet__panel sheet__panel--product" role="dialog" aria-modal="true" aria-label={item.name}>
        <button type="button" className="icon-btn icon-btn--float" onClick={onClose} aria-label="Fechar">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        {item.photo && <img className="pd__img" src={item.photo} alt="" />}
        <div className="pd__body">
          <h2>{item.name}</h2>
          {item.description && <p className="muted">{item.description}</p>}
          <p className="pd__price num">{money(item.price)}</p>
          <label className="field">Alguma observação?
            <textarea maxLength={140} placeholder="Ex.: sem cebola, ponto da carne…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <small>{notes.length}/140</small>
          </label>
        </div>
        {canOrder ? (
          <div className="pd__foot">
            <div className="stepper">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos um" disabled={qty <= 1}>−</button>
              <span className="num" aria-live="polite">{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="Mais um">+</button>
            </div>
            <button type="button" className="btn btn--primary pd__add" onClick={() => onAdd(qty, notes)}>
              <span>Adicionar</span><span className="num">{money(item.price * qty)}</span>
            </button>
          </div>
        ) : (
          <div className="pd__foot"><p className="muted">A loja não está aceitando pedidos agora.</p></div>
        )}
      </div>
    </div>
  );
}

function Bag({ cart, items, setQty, subtotal, store, canOrder, onCheckout, bare = false }) {
  const belowMin = subtotal < store.minOrder;
  if (cart.length === 0) {
    return (
      <div className={bare ? 'bag' : 'bag bag--card'}>
        {!bare && <h2>Sua sacola</h2>}
        <p className="muted">Sua sacola está vazia. Toque num produto para adicionar.</p>
      </div>
    );
  }
  return (
    <div className={bare ? 'bag' : 'bag bag--card'}>
      {!bare && <h2>Sua sacola</h2>}
      <ul className="bag__lines">
        {cart.map((line) => {
          const item = items.get(line.itemId);
          if (!item) return null;
          return (
            <li key={line.key}>
              <div className="bag__line-text">
                <span>{item.name}</span>
                {line.notes && <small className="muted">{line.notes}</small>}
                <span className="num">{money(item.price * line.qty)}</span>
              </div>
              <div className="stepper stepper--sm">
                <button type="button" onClick={() => setQty(line.key, line.qty - 1)} aria-label={`Tirar um ${item.name}`}>−</button>
                <span className="num">{line.qty}</span>
                <button type="button" onClick={() => setQty(line.key, Math.min(99, line.qty + 1))} aria-label={`Mais um ${item.name}`}>+</button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="totals num">
        <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {store.delivery && <div className="muted"><span>Entrega</span><span>{store.deliveryFee ? money(store.deliveryFee) : 'Grátis'}</span></div>}
      </div>
      {belowMin && <p className="hint">Faltam {money(store.minOrder - subtotal)} para o pedido mínimo de {money(store.minOrder)}.</p>}
      <button type="button" className="btn btn--primary btn--block" disabled={!canOrder || belowMin} onClick={onCheckout}>
        Finalizar pedido
      </button>
    </div>
  );
}

function Checkout({ slug, refCode, store, items, cart, onPlaced }) {
  const [mode, setMode] = useState(store.delivery ? 'delivery' : 'pickup');
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [payment, setPayment] = useState(store.payments[0] || '');
  const [changeFor, setChangeFor] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { setForm((f) => ({ ...f, ...readStorage('figrano:customer', {}) })); }, []);

  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const subtotal = cart.reduce((sum, l) => sum + l.qty * (items.get(l.itemId)?.price || 0), 0);
  const fee = mode === 'delivery' ? store.deliveryFee : 0;
  const total = subtotal + fee;
  const cash = /dinheiro/i.test(payment);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSending(true);
    try {
      writeStorage('figrano:customer', { name: form.name, phone: form.phone, address: form.address });
      const response = await fetch(`/api/s/${slug}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: refCode,
          customer: { name: form.name, phone: form.phone },
          items: cart.map(({ itemId, qty, notes: lineNotes }) => ({ itemId, qty, notes: lineNotes })),
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
    <form className="checkout" onSubmit={submit}>
      {store.delivery && store.pickup && (
        <fieldset className="group">
          <legend>Como quer receber?</legend>
          <div className="choice">
            <label><input type="radio" name="mode" checked={mode === 'delivery'} onChange={() => setMode('delivery')} /> Entrega</label>
            <label><input type="radio" name="mode" checked={mode === 'pickup'} onChange={() => setMode('pickup')} /> Retirada</label>
          </div>
        </fieldset>
      )}

      <fieldset className="group">
        <legend>Seus dados</legend>
        <label className="field">Nome<input type="text" required autoComplete="name" value={form.name} onChange={update('name')} /></label>
        <label className="field">WhatsApp com DDD
          <input type="tel" required autoComplete="tel" inputMode="tel" placeholder="(28) 99999-9999" value={form.phone} onChange={update('phone')} />
          <small>Os avisos do pedido chegam por aqui.</small>
        </label>
        {mode === 'delivery' && (
          <label className="field">Endereço de entrega
            <textarea required autoComplete="street-address" placeholder="Rua, número, bairro e complemento" value={form.address} onChange={update('address')} />
          </label>
        )}
      </fieldset>

      <fieldset className="group">
        <legend>Pagamento {mode === 'delivery' ? 'na entrega' : 'na retirada'}</legend>
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

      {error && <p className="error" role="alert">{error}</p>}

      <button className="btn btn--primary btn--block" disabled={sending || cart.length === 0}>
        {sending ? 'Enviando…' : `Enviar pedido · ${money(total)}`}
      </button>
    </form>
  );
}
