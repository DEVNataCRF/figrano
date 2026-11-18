'use client';

import { useEffect, useMemo, useState } from 'react';
import { money, whatsappLink } from '../lib/format.js';
import { PAYMENT_LABELS, placeOrder } from '../lib/api.js';
import cidade from '../lib/guacui.json';

const SLUG = 'sabores-da-sil';
const cartKey = (slug) => `sabores:delivery:cart:${slug}`;
const BUFFET_URL = process.env.NEXT_PUBLIC_BUFFET_URL || 'http://localhost:5173';
const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Cardápio da API → formato da tela (itens do delivery estão sempre à venda). */
function fromApi(data) {
  const c = data.config;
  return {
    store: {
      name: data.companyName || 'Sabores da Sil',
      logo: '/marca/logo.png',
      cover: '/fotos/caixas-festa-01-1280.webp',
      address: c.pickupAddress || '',
      whatsapp: data.whatsappPhone || '',
      deliveryFee: Number(c.deliveryFee) || 0,
      // Taxa por bairro: com a lista preenchida, só entrega nesses bairros
      neighborhoods: Array.isArray(c.neighborhoods) ? c.neighborhoods.map((n) => ({ name: n.name, fee: Number(n.fee) || 0 })) : [],
      minOrder: Number(c.minOrder) || 0,
      prepMinutes: Number(c.prepMinutes) || 0,
      payments: c.payments,
      delivery: c.acceptsDelivery,
      pickup: c.acceptsPickup,
      pixOnline: Boolean(c.pixOnline?.enabled),
      hours: DAY_NAMES.map((name, day) => {
        const slot = c.hours?.[String(day)];
        return { name, text: !slot || slot.closed ? 'Fechado' : `${slot.open} às ${slot.close}` };
      }),
    },
    menu: data.categories.map((category) => ({
      id: category.id,
      name: category.name,
      items: category.items.map((item) => ({ ...item, description: item.description || '', photo: item.photoUrl || '', available: true })),
    })),
    canOrder: data.acceptingOrders,
    open: data.open,
    reason: data.closedReason,
  };
}
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

export default function OrderApp({ menu: data, refCode }) {
  const slug = SLUG;
  const { store, menu, canOrder, open, reason } = useMemo(() => fromApi(data), [data]);
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
    store.delivery && feeLabel(store),
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
                {canOrder ? 'Aberto' : open ? 'Pedidos pausados' : 'Fechado'}
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
            {reason || 'Estamos fechados agora. Dá para olhar o cardápio e pedir quando abrirmos.'}
            {whatsapp && <> <a href={whatsapp}>Falar no WhatsApp</a></>}
          </p>
        )}
        <p className="festa-link">
          <span>Vai ter festa? A Sil também faz buffet e salgados por cento.</span>
          <a href={`${BUFFET_URL}/#orcamento`}>Pedir orçamento de festa</a>
        </p>
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
            onPlaced={(order, suffix) => {
              setCart([]);
              writeStorage(cartKey(slug), []);
              window.location.href = `/pedido/?id=${encodeURIComponent(order.id)}&t=${suffix}`;
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
            <textarea maxLength={140} placeholder="Ex.: bem sequinho, sem cebola…" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
        {store.delivery && <div className="muted"><span>Entrega</span><span>{store.neighborhoods.length ? 'conforme o bairro' : store.deliveryFee ? money(store.deliveryFee) : 'Grátis'}</span></div>}
      </div>
      {belowMin && <p className="hint">Faltam {money(store.minOrder - subtotal)} para o pedido mínimo de {money(store.minOrder)}.</p>}
      <button type="button" className="btn btn--primary btn--block" disabled={!canOrder || belowMin} onClick={onCheckout}>
        Finalizar pedido
      </button>
    </div>
  );
}

/** "Entrega R$ 6,00", "Entrega de R$ 5,00 a R$ 8,00" (por bairro) ou "Entrega grátis" */
function feeLabel(store) {
  const fees = store.neighborhoods.map((n) => n.fee);
  if (fees.length) {
    const min = Math.min(...fees);
    const max = Math.max(...fees);
    return min === max ? `Entrega ${money(min)}` : `Entrega de ${money(min)} a ${money(max)}`;
  }
  return store.deliveryFee ? `Entrega ${money(store.deliveryFee)}` : 'Entrega grátis';
}

function Checkout({ slug, refCode, store, items, cart, onPlaced }) {
  const [mode, setMode] = useState(store.delivery ? 'delivery' : 'pickup');
  const [form, setForm] = useState({ name: '', phone: '', address: '', complement: '', neighborhood: '' });
  const byNeighborhood = store.neighborhoods.length > 0;
  const [payment, setPayment] = useState(store.payments[0] || '');
  // Mesma chave se o cliente clicar duas vezes: a loja grava um pedido só
  const [idempotencyKey] = useState(() => `site-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const [changeFor, setChangeFor] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { setForm((f) => ({ ...f, ...readStorage('sabores:delivery:customer', {}) })); }, []);

  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const subtotal = cart.reduce((sum, l) => sum + l.qty * (items.get(l.itemId)?.price || 0), 0);
  const chosen = store.neighborhoods.find((n) => n.name === form.neighborhood);
  const fee = mode !== 'delivery' ? 0 : byNeighborhood ? chosen?.fee ?? 0 : store.deliveryFee;
  const total = subtotal + fee;
  const cash = payment === 'CASH';
  // Rua e número + complemento/referência, como o entregador lê na comanda
  const fullAddress = [form.address.trim(), form.complement.trim()].filter(Boolean).join(' - ');

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSending(true);
    try {
      writeStorage('sabores:delivery:customer', { name: form.name, phone: form.phone, address: form.address, complement: form.complement, neighborhood: form.neighborhood });
      const change = cash && changeFor.trim() ? Number(changeFor.replace(/[^\d,.]/g, '').replace(',', '.')) : null;
      const order = await placeOrder({
        customer: { name: form.name.trim(), phoneWhatsapp: form.phone },
        mode: mode === 'pickup' ? 'PICKUP' : 'DELIVERY',
        address: mode === 'delivery' ? fullAddress : null,
        neighborhood: mode === 'delivery' && byNeighborhood ? form.neighborhood : null,
        paymentMethod: payment,
        changeFor: change && change > 0 ? change : null,
        notes: notes.trim() || null,
        items: cart.map(({ itemId, qty, notes: lineNotes }) => ({ productId: itemId, quantity: qty, notes: lineNotes || null })),
        chatRef: refCode || null,
        idempotencyKey,
      });
      // O resumo fica neste aparelho para a página de acompanhamento
      writeStorage(`sabores:delivery:order:${order.id}`, {
        pixOnline: order.status === 'AWAITING_PIX',
        items: cart.map((l) => ({ name: items.get(l.itemId)?.name, qty: l.qty, price: items.get(l.itemId)?.price, notes: l.notes })),
        address: mode === 'delivery' ? fullAddress : '',
      });
      onPlaced(order, form.phone.replace(/\D/g, '').slice(-4));
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
        {mode === 'delivery' && byNeighborhood && (
          <label className="field">Bairro
            <select required value={chosen ? form.neighborhood : ''} onChange={update('neighborhood')}>
              <option value="" disabled>Escolha o bairro</option>
              {store.neighborhoods.map((n) => (
                <option key={n.name} value={n.name}>{n.name} · entrega {n.fee ? money(n.fee) : 'grátis'}</option>
              ))}
            </select>
            <small>Seu bairro não está na lista? Ainda não entregamos lá{store.pickup ? ', mas você pode retirar na loja' : ''}.</small>
          </label>
        )}
        {mode === 'delivery' && (
          <>
            <label className="field">Rua e número
              {/* Sugere as ruas de Guaçuí enquanto digita (base do OpenStreetMap) */}
              <input
                type="text"
                required
                list="ruas-da-cidade"
                autoComplete="street-address"
                placeholder={byNeighborhood ? 'Ex.: Rua Marechal Deodoro, 120' : 'Ex.: Rua Marechal Deodoro, 120, Centro'}
                value={form.address}
                onChange={update('address')}
              />
              <datalist id="ruas-da-cidade">
                {cidade.ruas.map((r) => <option key={r.nome} value={r.nome} />)}
              </datalist>
            </label>
            <label className="field">Complemento ou ponto de referência <small>(opcional)</small>
              <input type="text" placeholder="Ex.: casa azul, apto 2, perto da praça" value={form.complement} onChange={update('complement')} />
            </label>
          </>
        )}
      </fieldset>

      <fieldset className="group">
        <legend>Pagamento</legend>
        <div className="choice choice--stack">
          {store.payments.map((p) => (
            <label key={p}>
              <input type="radio" name="payment" checked={payment === p} onChange={() => setPayment(p)} />{' '}
              {p === 'PIX' && store.pixOnline ? 'Pix agora, pelo site' : PAYMENT_LABELS[p] || p}
            </label>
          ))}
        </div>
        {payment === 'PIX' && store.pixOnline && (
          <p className="hint">
            Depois de enviar, aparece o Pix copia e cola com o valor. Seu pedido só vai para a cozinha quando a Sil
            receber o comprovante no WhatsApp.
          </p>
        )}
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
        {mode === 'delivery' && <div><span>Entrega</span><span>{byNeighborhood && !chosen ? 'escolha o bairro' : fee ? money(fee) : 'Grátis'}</span></div>}
        <div className="grand"><span>Total</span><span>{money(total)}</span></div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <button className="btn btn--primary btn--block" disabled={sending || cart.length === 0}>
        {sending ? 'Enviando…' : `Enviar pedido · ${money(total)}`}
      </button>
    </form>
  );
}
