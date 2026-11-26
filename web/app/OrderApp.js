'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { STATUS_STEPS, descriptionLines, displayPhone, money, whatsappLink } from '../lib/format.js';
import { PAYMENT_LABELS, fetchNatal, findOrderAttempt, placeOrder, trackOrder } from '../lib/api.js';
import { classifySendError, clearAttempt, newAttemptKey, readAttempt, writeAttempt } from '../lib/order-attempt.js';
import StorePhoto from './StorePhoto.js';
import MyOrdersPanel from './MyOrders.js';
import { checkoutProblem, formatDeliveryAddress, restoreDeliveryContact } from '../lib/delivery-address.js';
import { contactOf, neighborhoodsOf, streetsOf } from '../lib/store.js';
import { nextOpening } from '../lib/hours.js';
import { rememberOrder } from '../lib/orders.js';
import { chosenIn, cleanPicks, groupRule, lineUnitPrice, missingRequired, optionLines, sameOptions } from '../lib/options.js';



const cartKey = (slug) => `sabores:delivery:cart:${slug}`;
const ordersKey = (slug) => `sabores:delivery:orders:${slug}`;
const BUFFET_URL = process.env.NEXT_PUBLIC_BUFFET_URL || '';
const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Cardápio da API → formato da tela (itens do delivery estão sempre à venda). */
function fromApi(data) {
  const c = data.config;
  return {
    store: {
      name: data.companyName || 'Nossa loja',
      logo: process.env.NEXT_PUBLIC_STORE_LOGO_URL || '/marca/logo.png',
      cover: process.env.NEXT_PUBLIC_DELIVERY_COVER_URL || '/fotos/caixas-festa-01-1280.webp',
      address: c.pickupAddress || '',
      whatsapp: data.whatsappPhone || '',
      owner: (data.ownerName || '').trim(),
      city: data.city || '',
      deliveryFee: Number(c.deliveryFee) || 0,
      // Taxa por bairro: com a lista preenchida, só entrega nesses bairros
      neighborhoods: Array.isArray(c.neighborhoods) ? c.neighborhoods.map((n) => ({ name: n.name, fee: Number(n.fee) || 0 })) : [],
      minOrder: Number(c.minOrder) || 0,
      prepMinutes: Number(c.prepMinutes) || 0,
      payments: c.payments,
      cardBrands: c.cardBrands ?? { credit: ['VISA', 'ELO', 'MASTERCARD'], debit: ['VISA', 'ELO', 'MASTERCARD'] },
      delivery: c.acceptsDelivery,
      pickup: c.acceptsPickup,
      pixOnline: Boolean(c.pixOnline?.enabled),
      rawHours: c.hours,
      override: c.override || null,
      hours: DAY_NAMES.map((name, day) => {
        const slot = c.hours?.[String(day)];
        // Abrir e fechar no mesmo horário = o dia todo (é assim que a regra de aberto/fechado entende)
        return { name, text: !slot || slot.closed ? 'Fechado' : slot.open === slot.close ? 'Dia todo' : `${slot.open} às ${slot.close}` };
      }),
    },
    menu: [
      // Destaques no topo: escolhidos pela loja ou os mais pedidos (a API decide)
      ...(data.featured?.length ? [{ id: 'mais-pedidos', name: '⭐ Mais pedidos', items: data.featured }] : []),
      ...data.categories,
    ].map((category) => ({
      id: category.id,
      name: category.name,
      items: category.items.map((item) => ({ ...item, description: item.description || '', photo: item.photoUrl || '', optionGroups: item.optionGroups || [], available: true })),
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

/**
 * Pedido confirmado pela loja: guarda neste aparelho o que o acompanhamento e "Meus pedidos"
 * usam. Recebe tudo explícito (telefone e itens), sem depender do formulário ou da sacola da tela:
 * a recuperação de um envio sem resposta acontece com o formulário ainda vazio (revalidação R01).
 * `summary.items`: [{ itemId?, name, qty, price, notes, extras, options }].
 */
function rememberPlaced(slug, order, suffix, summary) {
  writeStorage(`sabores:delivery:order:${order.id}`, {
    pixOnline: order.status === 'AWAITING_PIX',
    items: summary.items.map((l) => ({ name: l.name, qty: l.qty, price: l.price, notes: l.notes, extras: l.extras || [] })),
    address: summary.address || '',
  });
  const entry = {
    id: order.id, number: order.number, suffix, createdAt: order.createdAt || new Date().toISOString(),
    total: Number(order.total) || null, mode: order.mode,
    items: summary.items.map((l) => ({ itemId: l.itemId ?? null, name: l.name, qty: l.qty, notes: l.notes, options: l.options || [] })),
  };
  writeStorage(`sabores:delivery:last:${slug}`, entry);
  writeStorage(ordersKey(slug), rememberOrder(readStorage(ordersKey(slug), []), entry));
}

/** Resumo de um pedido recuperado, montado com o que a LOJA gravou (não com a sacola atual). */
function summaryFromStore(detail) {
  return {
    address: '',
    items: (detail?.items || []).map((i) => ({
      itemId: null, name: i.name, qty: i.quantity, price: i.unitPrice, notes: i.notes,
      extras: (i.options || []).map((o) => `${o.quantity}x ${o.name}`), options: [],
    })),
  };
}

/** Rascunho do fechamento: some ao fechar o navegador, mas sobrevive a fechar a janela do pedido. */
const draftKey = (slug) => `sabores:delivery:checkout-draft:${slug}`;
function readDraft(slug) {
  try { return JSON.parse(window.sessionStorage.getItem(draftKey(slug)) || 'null'); } catch { return null; }
}
function writeDraft(slug, value) {
  try {
    if (value) window.sessionStorage.setItem(draftKey(slug), JSON.stringify(value));
    else window.sessionStorage.removeItem(draftKey(slug));
  } catch { /* sem armazenamento: vale só enquanto a janela estiver aberta */ }
}

/**
 * Fechar ao tocar fora da janela: só se o toque COMEÇOU e TERMINOU no fundo escuro.
 * Selecionar texto num campo e soltar o mouse fora não fecha mais.
 */
/**
 * Gesto de celular: arrastar o dedo na direção pedida (`down` fecha janela, `up` abre a
 * sacola). Só conta se andou o bastante e mais na vertical que na horizontal.
 */
function useSwipe(direction, onSwipe, threshold = 60) {
  const start = useRef(null);
  return {
    onTouchStart: (event) => {
      const t = event.touches[0];
      start.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (event) => {
      const from = start.current;
      start.current = null;
      const t = event.changedTouches[0];
      if (!from || !t) return;
      const dy = t.clientY - from.y;
      const dx = Math.abs(t.clientX - from.x);
      if (Math.abs(dy) < threshold || dx > Math.abs(dy)) return;
      if ((direction === 'down' && dy > 0) || (direction === 'up' && dy < 0)) onSwipe();
    },
  };
}

function useBackdropDismiss(onClose, enabled = true) {
  const startedOnBackdrop = useRef(false);
  return {
    onPointerDown: (event) => { startedOnBackdrop.current = event.target === event.currentTarget; },
    onClick: (event) => {
      if (enabled && startedOnBackdrop.current && event.target === event.currentTarget) onClose();
      startedOnBackdrop.current = false;
    },
  };
}

const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function OrderApp({ menu: data, refCode, onReload = () => {} }) {
  const slug = `${data.companyName || 'loja'}:${data.whatsappPhone || ''}`;
  const { store, menu, canOrder, open, reason } = useMemo(() => fromApi(data), [data]);
  // Fechada mais cedo pelo atalho do painel: a próxima abertura conta depois desse fechamento
  const opening = useMemo(() => {
    if (open) return null;
    const until = store.override?.mode === 'closed' ? Date.parse(store.override.until) : NaN;
    return nextOpening(store.rawHours, Number.isFinite(until) && until > Date.now() ? new Date(until) : new Date());
  }, [open, store.rawHours, store.override]);
  useEffect(() => { document.title = `${store.name} · Delivery`; }, [store.name]);
  const items = useMemo(() => {
    const map = new Map();
    for (const category of menu) for (const item of category.items) map.set(item.id, item);
    return map;
  }, [menu]);

  // Linha da sacola: { key, itemId, qty, notes, options }. Mesmo item com observação ou adicionais diferentes vira outra linha.
  const [savedCart, setCart] = useState([]);
  const [cartStore, setCartStore] = useState(null);
  const cart = cartStore === slug ? savedCart : [];
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState(null);
  const [sheet, setSheet] = useState(null); // 'bag' | 'checkout' | null
  const [showInfo, setShowInfo] = useState(false);
  const [activeCat, setActiveCat] = useState(menu[0]?.id || '');
  const [overlayMounted, setOverlayMounted] = useState(false);
  const [toast, setToast] = useState(null);
  // Bairro do último fechamento: a sacola já mostra a taxa e o fechamento vem com ele marcado
  const [myBairro, setMyBairroState] = useState('');
  useEffect(() => { setMyBairroState(readStorage(`sabores:delivery:bairro:${slug}`, '')); }, [slug]);
  const setMyBairro = (name) => { setMyBairroState(name); writeStorage(`sabores:delivery:bairro:${slug}`, name); };
  // Último pedido feito neste aparelho: "Meu pedido" enquanto anda; "Pedir novamente" depois
  const [lastOrder, setLastOrder] = useState(null);
  useEffect(() => {
    const saved = readStorage(`sabores:delivery:last:${slug}`, null);
    if (!saved?.id || !saved?.suffix) return;
    setLastOrder({ ...saved, status: null });
    trackOrder(saved.id, saved.suffix).then((o) => setLastOrder({ ...saved, status: o.status })).catch(() => setLastOrder(null));
  }, [slug]);
  /**
   * Envio sem resposta guardado no aparelho: conferido aqui, na página da loja, e não só no
   * fechamento. Funciona com a sacola vazia, com o item fora do cardápio e com a loja fechada
   * (revalidação R02). Achou: guarda o pedido com o telefone da TENTATIVA e abre o acompanhamento.
   */
  const [attempt, setAttempt] = useState(null);
  const recoverAttempt = useCallback(async (a) => {
    setAttempt({ ...a, state: 'checking' });
    try {
      const order = await findOrderAttempt(a.key, a.phoneSuffix);
      let detail = null;
      try { detail = await trackOrder(order.id, a.phoneSuffix); } catch { /* sem itens: o acompanhamento busca */ }
      rememberPlaced(slug, order, a.phoneSuffix, summaryFromStore(detail));
      // Só apaga a tentativa depois de guardar o pedido no aparelho
      clearAttempt(window.localStorage, slug);
      setCart([]);
      writeStorage(cartKey(slug), []);
      writeDraft(slug, null);
      window.location.href = `/pedido/?id=${encodeURIComponent(order.id)}&t=${a.phoneSuffix}&novo=1`;
      return 'found';
    } catch (err) {
      const state = err.status === 404 ? 'not-arrived' : 'unknown';
      setAttempt({ ...a, state });
      return state;
    }
  }, [slug]);
  useEffect(() => {
    const saved = readAttempt(window.localStorage, slug);
    if (saved) void recoverAttempt(saved);
  }, [slug, recoverAttempt]);
  const dismissAttempt = () => { clearAttempt(window.localStorage, slug); setAttempt(null); };

  // Encomendas de Natal abertas no buffet: aviso com link para a seção de Natal
  const [natal, setNatal] = useState(null);
  useEffect(() => { if (BUFFET_URL) fetchNatal().then((n) => setNatal(n?.acceptingOrders ? n : null)); }, []);
  // "Meus pedidos": os pedidos feitos neste aparelho (o último, de antes da lista, entra nela)
  const [myOrders, setMyOrders] = useState([]);
  useEffect(() => {
    let list = readStorage(ordersKey(slug), []);
    if (!Array.isArray(list)) list = [];
    const last = readStorage(`sabores:delivery:last:${slug}`, null);
    if (last?.id && !list.some((o) => o?.id === last.id)) list = rememberOrder(list, last);
    setMyOrders(list);
  }, [slug]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  // Barra de busca/abas presa no topo ganha sombra, para se perceber que ela ficou fixa
  const toolbarRef = useRef(null);
  // Altura do rodapé: a última categoria desconta isso para ainda conseguir subir até as abas
  const footerRef = useRef(null);
  useEffect(() => {
    const el = footerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--footer-h', `${el.offsetHeight}px`));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const check = () => setStuck((toolbarRef.current?.getBoundingClientRect().top ?? 1) <= 0.5);
    window.addEventListener('scroll', check, { passive: true });
    check();
    return () => window.removeEventListener('scroll', check);
  }, []);
  useEffect(() => { if (product || sheet) setOverlayMounted(true); }, [product, sheet]);

  useEffect(() => {
    const saved = readStorage(cartKey(slug), []);
    // Sacola de outro dia: some o item que saiu e o adicional que mudou (a escolha precisa continuar valendo)
    setCart(Array.isArray(saved) ? saved.flatMap((line) => {
      const item = items.get(line.itemId);
      if (!item?.available) return [];
      const { picks, ok } = cleanPicks(item, line.options);
      return ok ? [{ ...line, options: picks }] : [];
    }) : []);
    setCartStore(slug);
  }, [slug, items]);
  useEffect(() => { if (cartStore === slug) writeStorage(cartKey(slug), savedCart); }, [slug, savedCart, cartStore]);
  // Link de um produto (?produto=id): abre o detalhe dele direto
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('produto');
    const item = wanted && items.get(wanted);
    if (item) setProduct(item);
  }, [items]);

  // Destaca na barra a categoria que está na tela.
  // Depois de um clique na aba, a rolagem suave passa por outras seções: o destaque fica na escolhida.
  const tabLock = useRef(0);
  const tabsRef = useRef(null);
  useEffect(() => {
    // Ativa a última seção cujo título já chegou perto do topo (logo abaixo da barra fixa)
    let frame = 0;
    let retry = 0;
    const update = () => {
      frame = 0;
      // Ainda na rolagem do clique: confere de novo quando a trava acabar
      if (Date.now() < tabLock.current) { clearTimeout(retry); retry = setTimeout(update, tabLock.current - Date.now() + 20); return; }
      let current = null;
      for (const category of menu) {
        const el = document.getElementById(`cat-${category.id}`);
        if (el && el.getBoundingClientRect().top <= 200) current = category.id;
      }
      if (current) setActiveCat(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); clearTimeout(retry); };
  }, [menu, query]);

  // No celular as abas rolam de lado: mantém a ativa à vista sem mexer na rolagem da página.
  useEffect(() => {
    const nav = tabsRef.current;
    const tab = nav?.querySelector('a[aria-current="true"]');
    if (!nav || !tab) return;
    const left = tab.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + tab.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' });
  }, [activeCat]);

  // Trava a rolagem do fundo enquanto uma janela está aberta.
  useEffect(() => {
    document.body.style.overflow = product || sheet || overlayMounted ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [product, sheet, overlayMounted]);

  const visibleMenu = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return menu;
    return menu
      .map((category) => ({ ...category, items: category.items.filter((item) => normalize(`${item.name} ${item.description}`).includes(q)) }))
      .filter((category) => category.items.length > 0);
  }, [menu, query]);

  const addToCart = (itemId, qty, notes, options = []) => setCart((current) => {
    const clean = notes.trim();
    const line = current.find((l) => l.itemId === itemId && l.notes === clean && sameOptions(l.options, options));
    if (line) return current.map((l) => (l === line ? { ...l, qty: Math.min(99, l.qty + qty) } : l));
    return [...current, { key: `${itemId}-${Date.now()}`, itemId, qty, notes: clean, options }];
  });
  const setQty = (key, qty) => setCart((current) => current.map((l) => (l.key === key ? { ...l, qty } : l)).filter((l) => l.qty > 0));

  const count = cart.reduce((n, l) => n + l.qty, 0);
  // Arrastar a barra "Ver sacola" para cima também abre a sacola
  const swipeOpenBag = useSwipe('up', () => setSheet('bag'), 30);
  const subtotal = cart.reduce((sum, l) => sum + l.qty * lineUnitPrice(items.get(l.itemId), l.options), 0);
  const whatsapp = whatsappLink(store.whatsapp);
  const qtyInCart = (itemId) => cart.filter((l) => l.itemId === itemId).reduce((n, l) => n + l.qty, 0);
  // Toque rápido no cartão: soma 1 (sem observação) ou tira 1 da linha mais recente do produto
  // Pedir de novo (último pedido ou um do histórico): só o que ainda está no cardápio, com o preço de hoje
  const repeatOrder = (lines = lastOrder?.items || []) => {
    const missing = [];
    let added = 0;
    for (const line of lines) {
      const item = items.get(line.itemId);
      const { picks, ok } = item?.available ? cleanPicks(item, line.options) : { picks: [], ok: false };
      if (!item || !item.available || !ok) { missing.push(line.name); continue; }
      addToCart(item.id, line.qty, line.notes || '', picks);
      added += line.qty;
    }
    setToast({ id: Date.now(), text: added ? `${added} ${added === 1 ? 'item voltou' : 'itens voltaram'} para a sacola, com o preço de hoje${missing.length ? `. Fora do cardápio hoje: ${missing.join(', ')}` : ''}` : 'Os itens desse pedido não estão no cardápio hoje.' });
    return added;
  };
  // Item com adicionais abre o detalhe: a pessoa vê (e escolhe) os molhos antes de pôr na sacola
  const quickAdd = (item) => {
    if (item.optionGroups.length) { setProduct(item); return; }
    addToCart(item.id, 1, '');
    setToast({ id: Date.now(), text: `1× ${item.name} na sacola` });
  };
  const removeOne = (itemId) => {
    const line = [...cart].reverse().find((l) => l.itemId === itemId);
    if (line) setQty(line.key, line.qty - 1);
  };

  const facts = [
    store.prepMinutes > 0 && `${store.prepMinutes}–${store.prepMinutes + 15} min`,
    store.delivery && feeLabel(store),
    store.minOrder > 0 && `Mínimo ${money(store.minOrder)}`,
  ].filter(Boolean);

  return (
    <MotionConfig reducedMotion="user"><div className="shop">
      <header className="hero" inert={product || sheet || overlayMounted ? true : undefined}>
        <div className="hero__cover" style={store.cover ? { backgroundImage: `url(${store.cover})` } : undefined} />
        <div className="hero__body">
          <div className="hero__logo">
            {store.logo ? <img src={store.logo} alt="" /> : <span aria-hidden="true">{initials(store.name)}</span>}
          </div>
          <div className="hero__text">
            <h1>{store.name}</h1>
            <div className="hero__facts">
              <span className={`status ${canOrder ? 'status--open' : 'status--closed'}`}>
                {canOrder ? 'Aberto' : open ? 'Pedidos pausados' : 'Fechado'}{!canOrder && !open && opening ? ` · abre ${opening.text}` : ''}
              </span>
              {facts.map((fact) => <span key={fact}>{fact}</span>)}
            </div>
            <div className="hero__links">
              <button type="button" className="link" onClick={() => setShowInfo((v) => !v)} aria-expanded={showInfo}>
                {showInfo ? 'Ocultar informações' : 'Horários e endereço'}
              </button>
              <button type="button" className="link" onClick={() => setSheet('orders')}>Meus pedidos{myOrders.length > 0 ? ` (${myOrders.length})` : ''}</button>
            </div>
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
        {attempt && <AttemptBanner attempt={attempt} onCheck={() => void recoverAttempt(attempt)} onDismiss={dismissAttempt} />}
        {lastOrder && <LastOrderBanner order={lastOrder} items={items} canOrder={canOrder} onRepeat={() => repeatOrder()} />}
        {!canOrder && (
          <p className="notice">
            {!open && opening ? `Estamos fechados agora. Abrimos ${opening.text}. Enquanto isso, dá para olhar o cardápio.` : reason || 'Estamos fechados agora. Dá para olhar o cardápio e pedir quando abrirmos.'}
            {whatsapp && <> <a href={whatsapp}>Falar no WhatsApp</a></>}
          </p>
        )}
        {natal && (
          <a className="natal-link" href={`${BUFFET_URL}/natal`}>
            <span aria-hidden="true">🎄</span>
            <span><strong>Encomendas de Natal abertas</strong><span className="natal-link__detail">Ceia, combos, pratos e chester · {natal.dates.map((d) => d.date.slice(8, 10) + '/' + d.date.slice(5, 7)).join(', ')}</span></span>
            <span className="natal-link__cta">Ver cardápio ›</span>
          </a>
        )}
        {BUFFET_URL && <p className="festa-link">
          <span>{store.owner ? `Vai ter festa? ${contactOf(store.owner).A} também faz buffet e salgados por cento.` : 'Vai ter festa? Conheça também as opções de buffet e salgados por cento.'}</span>
          <a href={`${BUFFET_URL}/#orcamento`}>Pedir orçamento de festa</a>
        </p>}
      </header>

      <div className="layout" inert={product || sheet || overlayMounted ? true : undefined}>
        <main className="menu">
          <div ref={toolbarRef} className={`toolbar${stuck ? ' toolbar--stuck' : ''}`}>
            <label className="search">
              <span className="sr-only">Buscar no cardápio</span>
              <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13 13l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <input type="search" placeholder="Buscar no cardápio" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {!query && menu.length > 1 && (
              <nav ref={tabsRef} className="tabs" aria-label="Categorias">
                {menu.map((category) => (
                  <a key={category.id} href={`#cat-${category.id}`} aria-current={activeCat === category.id} onClick={() => { tabLock.current = Date.now() + 1200; setActiveCat(category.id); }}>{category.name}</a>
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
                    <div key={item.id} className={`product ${item.available ? '' : 'product--out'}${item.photo ? '' : ' product--sem-foto'}`}>
                      {/* O cartão inteiro abre os detalhes (observação, quantidade); o "+" ao lado adiciona direto */}
                      <button type="button" className="product__open" onClick={() => item.available && setProduct(item)} disabled={!item.available}>
                        <span className="product__text">
                          <span className="product__name">{inCart > 0 && <span className="product__count">{inCart}x</span>}{item.name}</span>
                          <CardDescription text={item.description} />
                          {item.portionInfo && <span className="product__unit">{item.portionInfo}</span>}
                          <span className="product__price num">
                            {item.available ? money(item.price) : 'Esgotado'}
                            {item.available && item.saleUnit && <small className="product__per"> por {item.saleUnit}</small>}
                          </span>
                          <span className="product__action" aria-hidden="true" />
                        </span>
                        {item.photo && <StorePhoto className="product__img" src={item.photo} alt="" />}
                      </button>
                      {item.available && canOrder && (
                        <div className="product__quick">
                          {inCart > 0 ? (
                            <div className="stepper stepper--sm stepper--card">
                              <button type="button" onClick={() => removeOne(item.id)} aria-label={`Tirar um ${item.name}`}>−</button>
                              <AnimatedQuantity value={inCart} />
                              <button type="button" onClick={() => quickAdd(item)} aria-label={`Mais um ${item.name}`}>+</button>
                            </div>
                          ) : (
                            <button type="button" className="product__add" onClick={() => quickAdd(item)} aria-label={`Adicionar 1 ${item.name} à sacola`}>+</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </main>

        <aside className="side" aria-label="Sacola">
          <Bag cart={cart} items={items} setQty={setQty} subtotal={subtotal} store={store} canOrder={canOrder} bairro={myBairro}
            onCheckout={() => setSheet('checkout')} />
        </aside>
      </div>

      {count > 0 && (
        <motion.div className="bagbar" inert={product || sheet || overlayMounted ? true : undefined} initial={{ y: 90 }} animate={{ y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} {...swipeOpenBag}>
          <button className="btn btn--primary btn--block" onClick={() => setSheet('bag')}>
            <motion.span key={count} className="bagbar__count num" initial={{ scale: 1.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>{count}</motion.span>
            <span>Ver sacola</span>
            <span className="num">{money(subtotal)}</span>
          </button>
        </motion.div>
      )}

      <footer ref={footerRef} className="site-footer" inert={product || sheet || overlayMounted ? true : undefined}>
        <div className="site-footer__inner">
          <div>
            <p className="site-footer__name">{store.name}</p>
            {store.address && <p>{store.address}</p>}
            {store.city && !store.address.toLowerCase().includes(store.city.toLowerCase()) && <p>{store.city}</p>}
            {whatsapp && <p><a href={whatsapp}>{store.owner ? `Falar com ${contactOf(store.owner).a} no WhatsApp` : 'Falar no WhatsApp'}</a></p>}
            {BUFFET_URL && <p><a href={`${BUFFET_URL}/#orcamento`}>Buffet e salgados para festa</a></p>}
          </div>
          <div>
            <p className="site-footer__title">Horários</p>
            <dl className="site-footer__hours">{store.hours.map((h) => <div key={h.name}><dt>{h.name}</dt><dd>{h.text}</dd></div>)}</dl>
          </div>
        </div>
        <p className="site-footer__legal"><a href="/privacidade/">Privacidade e seus dados</a></p>
      </footer>

      <div className="toast-area" role="status" aria-live="polite">
        <AnimatePresence>
          {toast && (
            <motion.p key={toast.id} className="toast" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.18" /><path d="M6 10.5l2.6 2.6L14 7.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {toast.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait" initial={false} onExitComplete={() => { if (!product && !sheet) setOverlayMounted(false); }}>
      {product ? (
        <ProductSheet
          key={`product-${product.id}`}
          item={product}
          canOrder={canOrder}
          onClose={() => { setProduct(null); clearProductLink(); }}
          onShared={(text) => setToast({ id: Date.now(), text })}
          onAdd={(qty, notes, picks) => { addToCart(product.id, qty, notes, picks); setToast({ id: Date.now(), text: `${qty}× ${product.name} na sacola` }); setProduct(null); clearProductLink(); }}
        />
      ) : sheet === 'bag' ? (
        <Sheet key="bag" title="Sua sacola" onClose={() => setSheet(null)}>
          <Bag cart={cart} items={items} setQty={setQty} subtotal={subtotal} store={store} canOrder={canOrder} bairro={myBairro}
            onCheckout={() => setSheet('checkout')} bare />
        </Sheet>
      ) : sheet === 'orders' ? (
        <Sheet key="orders" title="Meus pedidos" onClose={() => setSheet(null)}>
          <MyOrdersPanel slug={slug} localOrders={myOrders} items={items} canOrder={canOrder}
            onRepeat={(lines) => setSheet(repeatOrder(lines) ? 'bag' : null)} />
        </Sheet>
      ) : sheet === 'checkout' ? (
        <Sheet key="checkout" title="Finalizar pedido" wide dismissOnBackdrop={false} onClose={() => setSheet(null)}>
          <Checkout
            slug={slug}
            bairro={myBairro}
            onBairro={setMyBairro}
            refCode={refCode}
            store={store}
            items={items}
            cart={cart}
            onMenuStale={onReload}
            onRecover={recoverAttempt}
            onPlaced={(order, suffix) => {
              setCart([]);
              writeStorage(cartKey(slug), []);
              window.location.href = `/pedido/?id=${encodeURIComponent(order.id)}&t=${suffix}&novo=1`;
            }}
          />
        </Sheet>
      ) : null}
      </AnimatePresence>
    </div></MotionConfig>
  );
}

function useSheetFocus(onClose, focusKey) {
  const ref = useRef(null);
  // Quem abriu a janela, lido antes de ela pegar o foco (no React de desenvolvimento o efeito
  // roda duas vezes e, na segunda, o foco já estaria dentro da própria janela).
  const opener = useRef(undefined);
  if (opener.current === undefined && typeof document !== 'undefined') opener.current = document.activeElement;
  useEffect(() => {
    const panel = ref.current;
    const previous = panel?.contains(document.activeElement) ? opener.current : document.activeElement;
    panel?.focus();
    const onKey = (event) => {
      if (panel?.closest('[inert]')) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab' || !panel) return;
      const fields = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter(el => el.getClientRects().length);
      const first = fields[0]; const last = fields.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (!panel.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Devolve o foco a quem abriu a janela. Durante a animação de saída o fundo ainda está
      // `inert` e o foco não pega: espera liberar (até ~1 s) em vez de deixar o foco perdido.
      let tries = 0;
      const restore = () => {
        if (document.querySelector('[role="dialog"]:not([aria-hidden="true"])') || !previous?.isConnected) return;
        if (previous.closest('[inert]') && tries++ < 60) { requestAnimationFrame(restore); return; }
        previous.focus();
      };
      requestAnimationFrame(restore);
    };
  }, [focusKey]); // Troca de etapa move o foco; digitação mantém a posição atual.
  return ref;
}

function Sheet({ title, onClose, children, wide = false, dismissOnBackdrop = true }) {
  const panel = useSheetFocus(onClose, title);
  const backdrop = useBackdropDismiss(onClose, dismissOnBackdrop);
  // Arrastar a alça (ou o título) para baixo fecha, como nos apps
  const swipeClose = useSwipe('down', onClose);
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <motion.div className="sheet" inert={!present ? true : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.16 }} {...backdrop}>
      <motion.div ref={panel} tabIndex={-1} className={`sheet__panel${wide ? ' sheet__panel--wide' : ''}`} role="dialog" aria-modal="true" aria-hidden={!present || undefined} aria-label={title} initial={{ y: reduced ? 0 : 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: reduced ? 0 : 8, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.2, ease: 'easeOut' }}>
        <div className="sheet__grab" aria-hidden="true" {...swipeClose}><span /></div>
        <div className="sheet__head" {...swipeClose}>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

/** Grupo de adicionais no detalhe do produto (como "Molhos · Escolha até 3 itens"). */
function OptionGroup({ group, picks, pickQty, onPick }) {
  const [search, setSearch] = useState('');
  const used = chosenIn(group, picks);
  const full = used >= group.max;
  const q = normalize(search.trim());
  const shown = q ? group.options.filter((o) => normalize(o.name).includes(q)) : group.options;
  const single = group.max === 1;
  return (
    <fieldset className="opt-group">
      <legend className="opt-group__head">
        <span className="opt-group__name">{group.name}</span>
        <span className={`opt-group__rule${group.min > 0 && used < group.min ? ' opt-group__rule--need' : ''}`}>{groupRule(group)}{!single && used > 0 ? ` · ${used}/${group.max}` : ''}</span>
      </legend>
      {group.options.length > 8 && (
        <label className="search opt-group__search">
          <span className="sr-only">Buscar em {group.name}</span>
          <input type="search" placeholder="Pesquise pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      )}
      <ul className="opt-group__list">
        {shown.map((option) => {
          const qty = pickQty(option.id);
          const price = option.price ? `+ ${money(option.price)}` : 'Grátis';
          return (
            <li key={option.id} className={qty ? 'is-on' : ''}>
              {single ? (
                <label className="opt-row">
                  <input type={group.min === 1 ? 'radio' : 'checkbox'} name={`opt-${group.id}`} checked={qty > 0}
                    onChange={(e) => onPick(group, option.id, e.target.checked || group.min === 1 ? 1 : 0)} />
                  <span className="opt-row__name">{option.name}</span>
                  <span className="opt-row__price num">{price}</span>
                </label>
              ) : (
                <div className="opt-row">
                  <span className="opt-row__name">{option.name}<span className="opt-row__price num">{price}</span></span>
                  {qty > 0 ? (
                    <div className="stepper stepper--sm">
                      <button type="button" onClick={() => onPick(group, option.id, qty - 1)} aria-label={`Tirar um ${option.name}`}>−</button>
                      <span className="num">{qty}</span>
                      <button type="button" disabled={full} onClick={() => onPick(group, option.id, qty + 1)} aria-label={`Mais um ${option.name}`}>+</button>
                    </div>
                  ) : (
                    <button type="button" className="product__add opt-row__add" disabled={full} onClick={() => onPick(group, option.id, 1)} aria-label={`Adicionar ${option.name}`}>+</button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="muted">Nada com esse nome.</li>}
      </ul>
    </fieldset>
  );
}

/** Tira o ?produto= do endereço ao fechar o detalhe (recarregar não reabre). */
function clearProductLink() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('produto')) return;
  url.searchParams.delete('produto');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/** Link direto do produto: no celular abre o compartilhar do sistema; no computador copia. */
async function shareProduct(item, onShared) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('produto', item.id);
  const link = url.toString();
  try {
    if (navigator.share) { await navigator.share({ title: item.name, text: `${item.name} · ${money(item.price)}`, url: link }); return; }
    await navigator.clipboard.writeText(link);
    onShared('Link do produto copiado');
  } catch (err) {
    if (err?.name !== 'AbortError') onShared('Não deu para compartilhar agora');
  }
}

/** Descrição no cartão do cardápio: em lista, um item embaixo do outro (até 3 + "e mais N"). */
function CardDescription({ text }) {
  const lines = descriptionLines(text);
  if (lines.length === 0) return null;
  if (lines.length === 1) return <span className="product__desc">{lines[0]}</span>;
  const shown = lines.slice(0, 3);
  return (
    <span className="product__list">
      {shown.map((line) => <span key={line} className="product__list-item">{line}</span>)}
      {lines.length > shown.length && <span className="product__list-more">e mais {lines.length - shown.length}</span>}
    </span>
  );
}

const CheckIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15" /><path d="M6 10.5l2.6 2.6L14 7.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function ProductSheet({ item, canOrder, onClose, onAdd, onShared = () => {} }) {
  const backdrop = useBackdropDismiss(onClose);
  const swipeClose = useSwipe('down', onClose);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [picks, setPicks] = useState([]);
  const panel = useSheetFocus(onClose, item.id);
  const unit = lineUnitPrice(item, picks);
  const missing = missingRequired(item, picks);
  const lines = descriptionLines(item.description);
  const pickQty = (optionId) => picks.find((p) => p.optionId === optionId)?.quantity || 0;
  const setPick = (group, optionId, quantity) => setPicks((current) => {
    // Grupo de uma escolha só: tocar em outra troca a escolhida
    const base = group.max === 1 && quantity > 0 ? current.filter((p) => !group.options.some((o) => o.id === p.optionId)) : current.filter((p) => p.optionId !== optionId);
    return quantity > 0 ? [...base, { optionId, quantity }] : base;
  });
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <motion.div className="sheet" inert={!present ? true : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.16 }} {...backdrop}>
      <motion.div ref={panel} tabIndex={-1} className={`sheet__panel sheet__panel--product${item.photo ? '' : ' pd--sem-foto'}`} role="dialog" aria-modal="true" aria-hidden={!present || undefined} aria-label={item.name} initial={{ y: reduced ? 0 : 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: reduced ? 0 : 8, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.2, ease: 'easeOut' }}>
        <div className="sheet__grab sheet__grab--over" aria-hidden="true" {...swipeClose}><span /></div>
        <div className="pd__actions">
          <button type="button" className="icon-btn icon-btn--float" onClick={() => shareProduct(item, onShared)} aria-label={`Compartilhar ${item.name}`}>
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="15" cy="4.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="5" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="15" cy="15.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M7 9l6-3.4M7 11l6 3.4" stroke="currentColor" strokeWidth="1.8" /></svg>
          </button>
          <button type="button" className="icon-btn icon-btn--float" onClick={onClose} aria-label="Fechar">
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {item.photo && <StorePhoto className="pd__img" src={item.photo} alt="" />}
        <div className="pd__body">
          <header className="pd__head">
            <h2>{item.name}</h2>
            <div className="pd__pricing">
              <span className="pd__price num">{money(item.price)}</span>
              {item.saleUnit && <span className="pd__chip">por {item.saleUnit}</span>}
              {item.portionInfo && <span className="pd__chip">{item.portionInfo}</span>}
            </div>
          </header>

          {lines.length > 1 ? (
            <section className="pd__contents" aria-labelledby={`vem-${item.id}`}>
              <h3 id={`vem-${item.id}`}>O que vem</h3>
              <ul className="pd__list">
                {lines.map((line) => <li key={line}><CheckIcon />{line}</li>)}
              </ul>
            </section>
          ) : lines.length === 1 ? (
            <p className="pd__desc">{lines[0]}</p>
          ) : null}

          {(item.accompaniments || item.allergens) && (
            <dl className="pd__facts">
              {item.accompaniments && <div><dt>Acompanha</dt><dd>{item.accompaniments}</dd></div>}
              {item.allergens && <div className="pd__allergens"><dt>Alergênicos</dt><dd>{item.allergens}</dd></div>}
            </dl>
          )}

          {item.optionGroups.map((group) => <OptionGroup key={group.id} group={group} picks={picks} pickQty={pickQty} onPick={setPick} />)}

          <details className="pd__note" open={notes.length > 0 || undefined}>
            <summary>Adicionar observação</summary>
            <label className="field">
              <span className="sr-only">Observação do item</span>
              <textarea maxLength={140} placeholder="Ex.: bem sequinho, sem cebola…" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <small>{notes.length}/140</small>
            </label>
          </details>
        </div>
        {canOrder ? (
          <div className="pd__foot">
            <div className="stepper">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos um" disabled={qty <= 1}>−</button>
              <AnimatedQuantity value={qty} />
              <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="Mais um">+</button>
            </div>
            <button type="button" className="btn btn--primary pd__add" disabled={missing.length > 0} onClick={() => onAdd(qty, notes, picks)}>
              {missing.length > 0
                ? <span>Escolha: {missing.map((g) => g.name).join(', ')}</span>
                : <><span>Adicionar</span><span className="num">{money(unit * qty)}</span></>}
            </button>
          </div>
        ) : (
          <div className="pd__foot"><p className="muted">A loja não está aceitando pedidos agora.</p></div>
        )}
      </motion.div>
    </motion.div>
  );
}

function Bag({ cart, items, setQty, subtotal, store, canOrder, onCheckout, bare = false, bairro = '' }) {
  const chosenFee = store.neighborhoods.find((n) => n.name === bairro);
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
                {optionLines(item, line.options).length > 0 && <small className="bag__options">+ {optionLines(item, line.options).join(', ')}</small>}
                {line.notes && <small className="muted">{line.notes}</small>}
                <span className="num">{money(lineUnitPrice(item, line.options) * line.qty)}</span>
              </div>
              <div className="stepper stepper--sm">
                <button type="button" onClick={() => setQty(line.key, line.qty - 1)} aria-label={`Tirar um ${item.name}`}>−</button>
                <AnimatedQuantity value={line.qty} />
                <button type="button" onClick={() => setQty(line.key, Math.min(99, line.qty + 1))} aria-label={`Mais um ${item.name}`}>+</button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="totals num">
        <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {store.delivery && <div className="muted"><span>Entrega{chosenFee ? ` (${chosenFee.name})` : ''}</span><span>{store.neighborhoods.length ? (chosenFee ? (chosenFee.fee ? money(chosenFee.fee) : 'Grátis') : 'conforme o bairro') : store.deliveryFee ? money(store.deliveryFee) : 'Grátis'}</span></div>}
      </div>
      {belowMin && (
        <div className="minbar">
          <div className="minbar__track" role="progressbar" aria-label="Pedido mínimo" aria-valuemin={0} aria-valuemax={store.minOrder} aria-valuenow={Math.round(subtotal * 100) / 100}>
            <motion.div className="minbar__fill" initial={false} animate={{ width: `${Math.min(100, (subtotal / store.minOrder) * 100)}%` }} transition={{ type: 'spring', stiffness: 260, damping: 30 }} />
          </div>
          <p className="hint">Faltam {money(store.minOrder - subtotal)} para o pedido mínimo de {money(store.minOrder)}.</p>
        </div>
      )}
      <button type="button" className="btn btn--primary btn--block" disabled={!canOrder || belowMin} onClick={onCheckout}>
        Finalizar pedido
      </button>
    </div>
  );
}

/** "Entrega R$ 6,00", "Entrega de R$ 5,00 a R$ 8,00" (por bairro) ou "Entrega grátis" */
function AnimatedQuantity({ value }) {
  const reduced = useReducedMotion();
  return <motion.span key={value} className="num" aria-live="polite" initial={{ opacity: reduced ? 1 : 0.4, y: reduced ? 0 : -2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.12 }}>{value}</motion.span>;
}

function feeLabel(store) {
  const fees = store.neighborhoods.map((n) => n.fee);
  if (fees.length) {
    const min = Math.min(...fees);
    const max = Math.max(...fees);
    return min === max ? `Entrega ${money(min)}` : `Entrega de ${money(min)} a ${money(max)}`;
  }
  return store.deliveryFee ? `Entrega ${money(store.deliveryFee)}` : 'Entrega grátis';
}

function Checkout({ slug, refCode, store, items, cart, onPlaced, onMenuStale = () => {}, onRecover = async () => 'unknown', bairro = '', onBairro = () => {} }) {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState(store.delivery ? 'delivery' : 'pickup');
  const [form, setForm] = useState(() => restoreDeliveryContact(null));
  const byNeighborhood = store.neighborhoods.length > 0;
  const who = contactOf(store.owner);
  const streets = useMemo(() => streetsOf(store.city), [store.city]);
  const cityNeighborhoods = useMemo(() => neighborhoodsOf(store.city), [store.city]);
  const [payment, setPayment] = useState(store.payments[0] || '');
  // Tentativa de envio guardada no aparelho (chave + telefone + total). Vale até uma resposta
  // definitiva da loja: resposta perdida, recarregar ou fechar a janela não gera outro pedido.
  const [pending, setPending] = useState(null);
  const [checking, setChecking] = useState(false);
  // A mesma chave já virou um pedido com outros itens: { orderId, number }
  const [alreadyPlaced, setAlreadyPlaced] = useState(null);
  const [changeFor, setChangeFor] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const [editingContact, setEditingContact] = useState(true);
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => {
    const draft = readDraft(slug);
    const saved = restoreDeliveryContact(draft?.form ?? readStorage(`sabores:delivery:customer:${slug}`, {}));
    // Bairro do último fechamento vale mais que o salvo de um pedido antigo
    if (!draft && bairro && bairro !== '__fora') saved.neighborhood = bairro;
    setForm(saved);
    // O que a pessoa já tinha escolhido antes de fechar a janela volta igual
    if (draft) {
      if (draft.mode === 'delivery' || draft.mode === 'pickup') setMode(draft.mode);
      if (store.payments.includes(draft.payment)) setPayment(draft.payment);
      setChangeFor(draft.changeFor || '');
      setNotes(draft.notes || '');
    }
    // Dados completos de um pedido anterior: mostra o resumo; incompletos: abre os campos
    const hasAddress = saved.address.trim() && (saved.noNumber || saved.number.trim()) && saved.neighborhood.trim() && !saved.legacyAddress;
    setEditingContact(draft?.editingContact ?? !(saved.name.trim() && saved.phone.trim() && hasAddress));
    setDraftReady(true);
    // Tentativa anterior ainda sem resposta definitiva: a mesma chave vale no próximo envio
    // (a página da loja já conferiu com a loja; aqui só reaproveita a chave)
    const previous = readAttempt(window.localStorage, slug);
    if (previous) setPending({ ...previous, status: 'idle' });
  }, [slug]);
  // Guarda o rascunho a cada mudança (fechar a janela ou recarregar a página não perde nada)
  useEffect(() => {
    if (draftReady) writeDraft(slug, { form, mode, payment, changeFor, notes, editingContact });
  }, [draftReady, slug, form, mode, payment, changeFor, notes, editingContact]);

  const update = (key) => (event) => {
    const value = event.target.value;
    if (key === 'neighborhood' && byNeighborhood) onBairro(value);
    setError('');
    setForm((f) => ({ ...f, [key]: value }));
  };
  const subtotal = cart.reduce((sum, l) => sum + l.qty * lineUnitPrice(items.get(l.itemId), l.options), 0);
  const chosen = store.neighborhoods.find((n) => n.name === form.neighborhood);
  const fee = mode !== 'delivery' ? 0 : byNeighborhood ? chosen?.fee ?? 0 : store.deliveryFee;
  const total = subtotal + fee;
  const cash = payment === 'CASH';
  const cardKind = payment === 'CREDIT_CARD' ? 'credit' : payment === 'DEBIT_CARD' ? 'debit' : null;
  const cardBrands = cardKind ? (store.cardBrands[cardKind] || []).filter(brand => ['VISA', 'ELO', 'MASTERCARD'].includes(brand)) : [];
  // Rua e número + complemento/referência, como o entregador lê na comanda
  const fullAddress = formatDeliveryAddress(form);
  const sendLock = useRef(false);

  async function submit(event) {
    event.preventDefault();
    if (sendLock.current) return;
    setError('');
    const problem = checkoutProblem({ mode, form });
    if (problem) {
      setError(problem);
      // Algum campo dos dados está escondido no resumo: abre para corrigir
      if (!editingContact && !problem.startsWith('Informe o número')) setEditingContact(true);
      return;
    }
    sendLock.current = true;
    setSending(true);
    setAlreadyPlaced(null);
    // Guarda a tentativa ANTES de enviar: se a resposta se perder, a mesma chave é conferida/reenviada
    const attempt = {
      key: pending?.key || newAttemptKey(),
      phoneSuffix: form.phone.replace(/\D/g, '').slice(-4),
      total: Math.round(total * 100) / 100,
      createdAt: pending?.createdAt || Date.now(),
    };
    writeAttempt(window.localStorage, slug, attempt);
    setPending({ ...attempt, status: 'sending' });
    try {
      writeStorage(`sabores:delivery:customer:${slug}`, { ...form, addressVersion: 2 });
      const change = cash && changeFor.trim() ? Number(changeFor.replace(/[^\d,.]/g, '').replace(',', '.')) : null;
      const order = await placeOrder({
        customer: { name: form.name.trim(), phoneWhatsapp: form.phone },
        mode: mode === 'pickup' ? 'PICKUP' : 'DELIVERY',
        address: mode === 'delivery' ? fullAddress : null,
        // Bairro sempre separado: com lista de taxas define o valor; sem lista vai para a comanda
        neighborhood: mode === 'delivery' ? form.neighborhood.trim() || null : null,
        paymentMethod: payment,
        changeFor: change && change > 0 ? change : null,
        notes: notes.trim() || null,
        items: cart.map(({ itemId, qty, notes: lineNotes, options }) => ({ productId: itemId, quantity: qty, notes: lineNotes || null, ...(options?.length ? { options } : {}) })),
        chatRef: refCode || null,
        idempotencyKey: attempt.key,
        // O total que o cliente viu no botão: se a loja calcular outro, nada é gravado
        expectedTotal: attempt.total,
      });
      finishPlaced(order, attempt.phoneSuffix);
    } catch (err) {
      sendLock.current = false;
      setSending(false);
      const kind = classifySendError(err);
      if (kind === 'unknown') {
        // Pode ter chegado: não gera chave nova. "Conferir envio" pergunta à loja.
        setPending({ ...attempt, status: 'unknown' });
        setError(`${err.message} Seu pedido pode ter chegado à loja: toque em "Conferir envio" antes de enviar de novo.`);
        return;
      }
      if (kind === 'price-changed') {
        // Nada foi gravado: atualiza os preços na tela e o cliente confirma o total novo
        setPending({ ...attempt, status: 'idle' });
        setError(err.message);
        onMenuStale();
        return;
      }
      clearAttempt(window.localStorage, slug);
      setPending(null);
      if (kind === 'already-placed') setAlreadyPlaced(err.details || null);
      setError(err.message);
    }
  }

  /** "Meu envio chegou?": pergunta à loja pela chave guardada, sem enviar outro pedido. */
  async function checkAttempt(attempt = pending) {
    if (!attempt) return;
    setChecking(true);
    // Mesma conferência da página da loja (achou = guarda com o telefone da tentativa e abre o acompanhamento)
    const result = await onRecover(attempt);
    setChecking(false);
    if (result === 'not-arrived') {
      // Não chegou: pode enviar de novo (a mesma chave garante um pedido só)
      setPending({ ...attempt, status: 'idle' });
      setError('Seu último envio não chegou à loja. Confira os dados e envie de novo.');
    } else if (result === 'unknown') {
      setPending({ ...attempt, status: 'unknown' });
      setError('Não deu para conferir seu último envio agora. Confira sua internet e toque em "Conferir envio".');
    }
  }

  /** Pedido confirmado pela loja (envio agora ou conferido depois): guarda o resumo e segue. */
  /** Envio confirmado agora (resposta recebida): a sacola e o endereço da tela são os que foram enviados. */
  function finishPlaced(order, suffix) {
    rememberPlaced(slug, order, suffix, {
      address: mode === 'delivery' ? fullAddress : '',
      items: cart.map((l) => ({
        itemId: l.itemId, name: items.get(l.itemId)?.name, qty: l.qty, price: lineUnitPrice(items.get(l.itemId), l.options),
        notes: l.notes, extras: optionLines(items.get(l.itemId), l.options), options: l.options || [],
      })),
    });
    // Só apaga a tentativa depois de guardar o pedido no aparelho
    clearAttempt(window.localStorage, slug);
    setPending(null);
    writeDraft(slug, null);
    onPlaced(order, suffix);
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

      <div className="checkout__cols"><div className="checkout__col">
      <fieldset className="group">
        <legend>Seus dados</legend>
        {!editingContact && (
          <div className="contact-summary">
            <div>
              <p><strong>{form.name}</strong> · {displayPhone(form.phone)}</p>
              {mode === 'delivery' && <p>{fullAddress}{form.neighborhood ? ` · ${form.neighborhood}` : ''}</p>}
            </div>
            <button type="button" className="link" onClick={() => setEditingContact(true)}>Alterar</button>
          </div>
        )}
        {/* Bairro com taxa fica sempre à vista: define o total */}
        {editingContact && <>
        <label className="field">Nome<input type="text" required autoComplete="name" value={form.name} onChange={update('name')} /></label>
        <label className="field">WhatsApp com DDD
          <input type="tel" required autoComplete="tel" inputMode="tel" placeholder="(DDD) 99999-9999" value={form.phone} onChange={update('phone')} />
          <small>Os avisos do pedido chegam por aqui.</small>
        </label>
        </>}
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
        {mode === 'delivery' && !byNeighborhood && editingContact && (
          <label className="field">Bairro
            <input type="text" required maxLength={80} autoComplete="address-level3" list={cityNeighborhoods.length ? 'bairros-da-cidade' : undefined} placeholder="Ex.: Centro" value={form.neighborhood} onChange={update('neighborhood')} />
            {cityNeighborhoods.length > 0 && <datalist id="bairros-da-cidade">{cityNeighborhoods.map((n) => <option key={n} value={n} />)}</datalist>}
          </label>
        )}
        {mode === 'delivery' && editingContact && (
          <>
            <div className="address-fields"><label className="field">Endereço
              <input
                type="text"
                required
                // Sugere as ruas da cidade da loja enquanto digita (base do OpenStreetMap)
                list={streets.length ? 'ruas-da-cidade' : undefined}
                autoComplete="address-line1"
                maxLength={300}
                placeholder="Rua, avenida ou estrada"
                value={form.address}
                onChange={update('address')}
              />
              {streets.length > 0 && (
                <datalist id="ruas-da-cidade">
                  {streets.map((nome) => <option key={nome} value={nome} />)}
                </datalist>
              )}
            </label>
            <label className="field">Número<input type="text" required={!form.noNumber} disabled={form.noNumber} maxLength={20} autoComplete="off" placeholder={form.noNumber ? 'Sem número' : 'Ex.: 120A'} value={form.noNumber ? '' : form.number} onChange={update('number')} /></label></div>
            <label className="address-no-number"><input type="checkbox" checked={form.noNumber} onChange={event => setForm(f => ({ ...f, noNumber: event.target.checked }))} />Sem número</label>
            {form.legacyAddress && !form.number && !form.noNumber && <p className="hint">Seu endereço salvo veio em um único campo. Confira e separe a rua e o número antes de enviar.</p>}
            <label className="field">Complemento ou ponto de referência <small>(opcional)</small>
              <input type="text" maxLength={140} autoComplete="address-line2" placeholder="Ex.: casa azul, apto 2, perto da praça" value={form.complement} onChange={update('complement')} />
            </label>
          </>
        )}
      </fieldset>

      </div><div className="checkout__col">
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
        <AnimatePresence initial={false} mode="wait">{cardKind && <motion.div key={cardKind} className="card-brands-reveal" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.18 }}>
          <div className="card-brands"><p>Bandeiras aceitas no {cardKind === 'credit' ? 'crédito' : 'débito'}</p>{cardBrands.length > 0 ? <ul aria-label={`Bandeiras aceitas no ${cardKind === 'credit' ? 'crédito' : 'débito'}`}>{cardBrands.map(brand => <li key={brand}><img src={`/pagamentos/${brand.toLowerCase()}.svg`} alt="" width="58" height="36" /><span>{({ VISA: 'Visa', ELO: 'Elo', MASTERCARD: 'Mastercard' })[brand]}</span></li>)}</ul> : <p className="muted">Consulte as bandeiras com a loja.</p>}<small>Pagamento na entrega ou retirada.</small></div>
        </motion.div>}</AnimatePresence>
        {payment === 'PIX' && store.pixOnline && (
          <p className="hint">
            Depois de enviar, aparece o Pix copia e cola com o valor. Seu pedido só vai para a cozinha quando {who.a}{' '}
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

      <section className="checkout__review" aria-label="Itens do pedido">
        <h3>Confira os itens</h3>
        <ul>{cart.map(line => { const item = items.get(line.itemId); const extras = optionLines(item, line.options); return <li key={line.key}><span>{line.qty} × {item?.name}{extras.length > 0 && <small>+ {extras.join(', ')}</small>}{line.notes && <small>{line.notes}</small>}</span><strong className="num">{money(line.qty * lineUnitPrice(item, line.options))}</strong></li>; })}</ul>
        {/* Valores aqui, no fim do formulário: o rodapé fixo fica só com o botão (sobra tela no celular) */}
        <div className="totals num">
          <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
          {mode === 'delivery' && <div><span>Entrega</span><span>{byNeighborhood && !chosen ? 'escolha o bairro' : fee ? money(fee) : 'Grátis'}</span></div>}
          <div className="grand"><span>Total</span><span>{mode === 'delivery' && byNeighborhood && !chosen ? 'Escolha o bairro' : money(total)}</span></div>
        </div>
      </section>
      <p className="checkout__legal">Seus dados servem só para este pedido e os avisos dele. <a href="/privacidade/" target="_blank" rel="noreferrer">Privacidade</a></p>
      </div></div>
      <div className="checkout__footer">
      {/* Sempre à vista: logo acima do botão (antes ficava escondida no fim do formulário) */}
      {error && <p className="error" role="alert">{error}</p>}
      {alreadyPlaced?.orderId && (
        <a className="btn btn--ghost btn--block" href={`/pedido/?id=${encodeURIComponent(alreadyPlaced.orderId)}&t=${form.phone.replace(/\D/g, '').slice(-4)}`}>
          Ver o pedido #{alreadyPlaced.number}
        </a>
      )}
      {pending?.status === 'unknown' && (
        <button type="button" className="btn btn--ghost btn--block" disabled={checking || sending} onClick={() => void checkAttempt()}>
          {checking ? 'Conferindo…' : 'Conferir envio'}
        </button>
      )}
      <button className="btn btn--primary btn--block" disabled={sending || checking || cart.length === 0}>
        {sending ? 'Enviando…' : mode === 'delivery' && byNeighborhood && !chosen ? 'Enviar pedido' : `Enviar pedido · ${money(total)}`}
      </button>
      </div>
    </form>
  );
}

const STATUS_LABEL = Object.fromEntries(STATUS_STEPS.map((s) => [s.status, s.label]));

/** Último envio sem resposta da loja: aparece na página, com ou sem sacola (revalidação R02). */
function AttemptBanner({ attempt, onCheck, onDismiss }) {
  if (attempt.state === 'checking') {
    return <p className="attempt" role="status">Conferindo seu último pedido com a loja…</p>;
  }
  if (attempt.state === 'not-arrived') {
    return (
      <div className="attempt" role="status">
        <p><strong>Seu último envio{attempt.total ? ` (${money(attempt.total)})` : ''} não chegou à loja.</strong> Se ainda quiser, monte o pedido e envie de novo.</p>
        <button type="button" className="btn btn--ghost" onClick={onDismiss}>Entendi</button>
      </div>
    );
  }
  return (
    <div className="attempt attempt--warn" role="alert">
      <p><strong>Seu último pedido{attempt.total ? ` (${money(attempt.total)})` : ''} ficou sem confirmação da loja.</strong> Ele pode ter chegado. Confira antes de pedir de novo.</p>
      <button type="button" className="btn btn--primary" onClick={onCheck}>Conferir envio</button>
    </div>
  );
}

/** Pedido feito neste aparelho: acompanhar enquanto anda, pedir de novo depois. */
function LastOrderBanner({ order, items, canOrder, onRepeat }) {
  const active = order.status && !['DONE', 'CANCELED'].includes(order.status);
  const link = `/pedido/?id=${encodeURIComponent(order.id)}&t=${order.suffix}`;
  if (active) {
    return (
      <a className="last-order last-order--active" href={link}>
        <span><strong>Meu pedido #{order.number}</strong> · {STATUS_LABEL[order.status] || 'em andamento'}</span>
        <span className="last-order__cta">Acompanhar ›</span>
      </a>
    );
  }
  if (!order.status || !(order.items || []).length) return null;
  const names = order.items.map((l) => `${l.qty}× ${l.name}`).join(', ');
  const available = order.items.some((l) => items.get(l.itemId));
  return (
    <div className="last-order">
      <span><strong>Seu último pedido</strong> · {names}</span>
      <span className="last-order__actions">
        <a href={link}>Ver</a>
        {canOrder && available && <button type="button" className="btn btn--primary" onClick={onRepeat}>Pedir novamente</button>}
      </span>
    </div>
  );
}

