'use strict';

const api = window.figrano;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state = null;
let page = 'orders';
const errors = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason?.message || event.reason)));

// ----------------------------------------------------------------- utilidades

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (value) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
const clock = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const isToday = (ts) => new Date(ts).toDateString() === new Date().toDateString();
const errorText = (error) => String(error?.message || error).replace(/^Error invoking remote method 'api': (Error: )?/, '');

let toastTimer = null;
function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6000 : 3000);
}

/** Chama o processo principal e mostra o erro, se houver. Devolve undefined em caso de falha. */
async function call(method, ...args) {
  try {
    return await api.call(method, ...args);
  } catch (error) {
    toast(errorText(error), 'error');
    return undefined;
  }
}

// --------------------------------------------------------------------- shell

const CONN_TEXT = {
  loading: 'Abrindo o WhatsApp',
  qr: 'WhatsApp desconectado',
  syncing: 'Sincronizando conversas',
  ready: 'WhatsApp conectado',
  error: 'WhatsApp com erro',
};

function renderShell() {
  for (const button of $$('[data-bot-status]')) {
    button.setAttribute('aria-pressed', String(button.dataset.botStatus === state.settings.bot.status));
  }
  const conn = $('#conn');
  conn.dataset.state = state.whatsapp.state;
  $('#conn-text').textContent = CONN_TEXT[state.whatsapp.state] || '';

  const fresh = state.orders.filter((o) => o.status === 'new').length;
  $('#badge-orders').hidden = fresh === 0;
  $('#badge-orders').textContent = fresh;
  $('#badge-handoffs').hidden = state.handoffs.length === 0;
  $('#badge-handoffs').textContent = state.handoffs.length;

  for (const button of $$('.sidebar [data-page]')) {
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function navigate(target) {
  page = target;
  for (const section of $$('.page')) section.hidden = section.id !== `page-${page}`;
  renderShell();
  renderPage(true);
  layoutWhatsapp();
}

function renderPage(entering = false) {
  if (page === 'orders') renderOrders();
  else if (page === 'menu') renderMenu();
  else if (page === 'handoffs') renderHandoffs();
  else if (page === 'whatsapp') renderChatbar();
  else if (page === 'settings' && entering) {
    renderSettings();
    const aiForm = $('form[data-form="ai"]');
    if (aiForm) refreshAiForm(aiForm);
  }
}

// ------------------------------------------------------------------- pedidos

const COLUMNS = [
  { key: 'new', title: 'Novos', match: (o) => o.status === 'new' },
  { key: 'preparing', title: 'Em preparo', match: (o) => o.status === 'preparing' },
  { key: 'going', title: 'A caminho ou prontos', match: (o) => o.status === 'out' || o.status === 'ready' },
  { key: 'closed', title: 'Encerrados hoje', match: (o) => (o.status === 'done' || o.status === 'canceled') && isToday(o.updatedAt) },
];

function orderActions(order) {
  const next = [];
  if (order.status === 'new') {
    next.push(['preparing', 'Aceitar', 'btn--primary'], ['canceled', 'Recusar', 'btn--danger']);
  } else if (order.status === 'preparing') {
    next.push(order.mode === 'delivery' ? ['out', 'Saiu para entrega', 'btn--primary'] : ['ready', 'Pronto para retirada', 'btn--primary']);
    next.push(['canceled', 'Cancelar', 'btn--danger']);
  } else if (order.status === 'out' || order.status === 'ready') {
    next.push(['done', 'Concluir', 'btn--primary']);
  }
  const buttons = next.map(([status, label, cls]) => `<button class="btn ${cls}" data-order-status="${status}">${label}</button>`);
  buttons.push('<button class="btn btn--quiet" data-order-print>Imprimir</button>');
  if (order.customer.chatId) buttons.push('<button class="btn btn--quiet" data-order-chat>Conversa</button>');
  return buttons.join('');
}

function orderCard(order) {
  const items = order.items.map((line) => `<li>${line.qty}x ${esc(line.name)}${line.notes ? ` <small>${esc(line.notes)}</small>` : ''}</li>`).join('');
  const where = order.mode === 'delivery' ? `Entrega: ${esc(order.address)}` : 'Retirada na loja';
  const pay = `${esc(order.payment)}${order.changeFor ? `, troco para ${money(order.changeFor)}` : ''}`;
  return `
    <article class="order ${order.status === 'canceled' ? 'order--canceled' : ''}" data-order="${order.id}">
      <div class="order__top"><span class="order__num">#${order.number}</span>${order.source === 'online' ? ' <span class="tag tag--ok">Site</span>' : ''}<span class="order__time">${clock(order.createdAt)}</span></div>
      <div class="order__who">${esc(order.customer.name)}</div>
      <ul>${items}</ul>
      <div class="order__meta">${where}</div>
      <div class="order__meta">${pay}${order.status === 'canceled' ? ' · cancelado' : ''}</div>
      ${order.notes ? `<div class="order__meta">Obs.: ${esc(order.notes)}</div>` : ''}
      <div class="order__total"><span>Total</span><span>${money(order.total)}</span></div>
      <div class="order__actions">${orderActions(order)}</div>
    </article>`;
}

function renderOrders() {
  const columns = COLUMNS.map((column) => {
    const orders = state.orders.filter(column.match).sort((a, b) => a.createdAt - b.createdAt);
    return `
      <div class="col col--${column.key}">
        <div class="col__head"><h2>${column.title}</h2><span>${orders.length}</span></div>
        ${orders.map(orderCard).join('')}
      </div>`;
  }).join('');
  const hasAny = state.orders.length > 0;
  $('#page-orders').innerHTML = `
    <div class="page__head">
      <h1>Pedidos</h1><span class="spacer"></span>
      <button class="btn btn--primary" data-new-order>Novo pedido</button>
    </div>
    ${hasAny ? '' : '<p class="empty">Nenhum pedido ainda. Os pedidos fechados pelo robô no WhatsApp aparecem aqui, e você também pode lançar um pedido de balcão ou telefone.</p>'}
    <div class="board">${columns}</div>`;
}

function openOrderDialog(prefill = {}) {
  const s = state.settings.store;
  const categories = state.menu.categories
    .map((c) => ({ ...c, items: c.items.filter((i) => i.available !== false) }))
    .filter((c) => c.items.length);
  if (categories.length === 0) {
    toast('Cadastre itens no cardápio antes de lançar um pedido.', 'error');
    return;
  }
  const picks = categories.map((category) => `
    <h3>${esc(category.name)}</h3>
    ${category.items.map((item) => `
      <label for="qty-${item.id}">${esc(item.name)}</label>
      <span class="pick__price">${money(item.price)}</span>
      <input type="number" id="qty-${item.id}" min="0" max="99" value="0" data-item="${item.id}" aria-label="Quantidade de ${esc(item.name)}">`).join('')}`).join('');
  const modes = [s.delivery && ['delivery', `Entrega (${money(s.deliveryFee)})`], s.pickup && ['pickup', 'Retirada']].filter(Boolean);

  showDialog(`
    <div class="dialog__head"><h2>Novo pedido</h2></div>
    <div class="dialog__body">
      <div class="fields-2">
        <label class="field"><span>Cliente</span><input type="text" name="name" value="${esc(prefill.name || '')}" required></label>
        <label class="field"><span>Telefone com DDD</span><input type="tel" name="phone" value="${esc(prefill.phone || '')}" inputmode="numeric"></label>
      </div>
      <div class="pick">${picks}</div>
      <div class="fields-2">
        <label class="field"><span>Recebimento</span><select name="mode">${modes.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Pagamento</span><select name="payment">${s.payments.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Endereço de entrega</span><input type="text" name="address"></label>
      <label class="field"><span>Observações</span><input type="text" name="notes"></label>
    </div>
    <div class="dialog__foot">
      <span class="dialog__error" id="dialog-error"></span>
      <button type="button" class="btn" data-close>Cancelar</button>
      <button type="submit" class="btn btn--primary">Lançar pedido</button>
    </div>`, async (form) => {
    const data = new FormData(form);
    const byId = new Map(categories.flatMap((c) => c.items).map((i) => [i.id, i]));
    const items = $$('[data-item]', form)
      .map((input) => ({ item: byId.get(input.dataset.item), qty: Number(input.value) || 0 }))
      .filter((line) => line.qty > 0)
      .map((line) => ({ name: line.item.name, price: line.item.price, qty: line.qty }));
    if (items.length === 0) return 'Escolha ao menos um item.';
    const mode = data.get('mode');
    if (mode === 'delivery' && String(data.get('address')).trim().length < 8) return 'Informe o endereço de entrega.';
    await api.call('orders:create', {
      customer: { name: data.get('name'), phone: data.get('phone'), chatId: prefill.chatId || '' },
      items, mode, address: data.get('address'), payment: data.get('payment'), notes: data.get('notes'),
    });
    return null;
  });
}

// ------------------------------------------------------------------ cardápio

function renderMenu() {
  const categories = state.menu.categories.map((category) => `
    <div class="cat" data-category="${category.id}">
      <div class="cat__head">
        <h2>${esc(category.name)}</h2>
        <button class="btn btn--quiet" data-cat-rename>Renomear</button>
        <button class="btn btn--quiet" data-cat-delete>Excluir</button>
        <button class="btn" data-item-new>Adicionar item</button>
      </div>
      ${category.items.length ? `
      <table>
        <thead><tr><th>Item</th><th class="num">Preço</th><th>Situação</th><th></th></tr></thead>
        <tbody>${category.items.map((item) => `
          <tr data-item-row="${item.id}" class="${item.available === false ? 'off' : ''}">
            <td><div class="item-cell">${item.photo ? `<img class="thumb" src="figrano-img://${item.photo}" alt="">` : '<span class="thumb thumb--empty" aria-hidden="true"></span>'}<div>${esc(item.name)}${item.description ? `<small>${esc(item.description)}</small>` : ''}</div></div></td>
            <td class="num">${money(item.price)}</td>
            <td><span class="tag ${item.available === false ? '' : 'tag--ok'}">${item.available === false ? 'Em falta' : 'Disponível'}</span></td>
            <td class="acts">
              <button class="btn btn--quiet" data-item-toggle>${item.available === false ? 'Voltar a vender' : 'Marcar em falta'}</button>
              <button class="btn btn--quiet" data-item-edit>Editar</button>
              <button class="btn btn--quiet" data-item-delete>Excluir</button>
            </td>
          </tr>`).join('')}</tbody>
      </table>` : '<p class="empty" style="padding:16px">Categoria sem itens.</p>'}
    </div>`).join('');

  $('#page-menu').innerHTML = `
    <div class="page__head">
      <h1>Cardápio</h1><span class="spacer"></span>
      <form class="inline-form" id="category-form">
        <input type="text" name="name" placeholder="Nova categoria, ex.: Pizzas" aria-label="Nome da nova categoria" required>
        <button class="btn btn--primary">Criar categoria</button>
      </form>
    </div>
    ${state.menu.categories.length ? categories : '<p class="empty">O cardápio está vazio. Crie uma categoria e adicione os itens: é esta lista, numerada, que o robô envia aos clientes.</p>'}`;
}

function openItemDialog(categoryId, item = null) {
  showDialog(`
    <div class="dialog__head"><h2>${item ? 'Editar item' : 'Novo item'}</h2></div>
    <div class="dialog__body">
      <label class="field"><span>Nome</span><input type="text" name="name" value="${esc(item?.name || '')}" required></label>
      <label class="field"><span>Descrição</span><input type="text" name="description" value="${esc(item?.description || '')}"><small>Aparece abaixo do nome no cardápio enviado.</small></label>
      <label class="field"><span>Preço (R$)</span><input type="number" name="price" min="0" step="0.01" value="${item ? item.price : ''}" required></label>
      <div class="field"><span>Foto</span>
        <div class="photo-pick">
          <img class="photo-pick__img" data-photo-preview ${item?.photo ? `src="figrano-img://${item.photo}"` : 'hidden'} alt="">
          <div class="photo-pick__actions">
            <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" data-photo-input>
            ${item?.photo ? '<label class="check"><input type="checkbox" name="removePhoto"> Remover foto</label>' : ''}
          </div>
        </div>
        <small>Aparece no cardápio online. Quadrada ou deitada fica melhor.</small>
      </div>
    </div>
    <div class="dialog__foot">
      <span class="dialog__error" id="dialog-error"></span>
      <button type="button" class="btn" data-close>Cancelar</button>
      <button type="submit" class="btn btn--primary">Salvar</button>
    </div>`, async (form) => {
    const data = new FormData(form);
    const saved = await api.call('menu:saveItem', categoryId, {
      id: item?.id, name: data.get('name'), description: data.get('description'),
      price: Number(data.get('price')), available: item ? item.available !== false : true,
    });
    const file = form.elements.photo.files[0];
    if (file) await api.call('menu:setItemPhoto', categoryId, saved.id, await readAsDataUrl(file));
    else if (data.has('removePhoto')) await api.call('menu:setItemPhoto', categoryId, saved.id, null);
    return null;
  });
}

function openRenameDialog(category) {
  showDialog(`
    <div class="dialog__head"><h2>Renomear categoria</h2></div>
    <div class="dialog__body"><label class="field"><span>Nome</span><input type="text" name="name" value="${esc(category.name)}" required></label></div>
    <div class="dialog__foot">
      <span class="dialog__error" id="dialog-error"></span>
      <button type="button" class="btn" data-close>Cancelar</button>
      <button type="submit" class="btn btn--primary">Salvar</button>
    </div>`, async (form) => {
    await api.call('menu:saveCategory', { id: category.id, name: new FormData(form).get('name') });
    return null;
  });
}

// -------------------------------------------------------------- atendimentos

const PRIORITY = { high: 'Alta', medium: 'Média', low: 'Baixa' };
const MOOD = { calm: 'Calmo', frustrated: 'Frustrado', hostile: 'Hostil' };

function renderHandoffs() {
  const order = { high: 0, medium: 1, low: 2 };
  const rows = [...state.handoffs]
    .sort((a, b) => order[a.priority] - order[b.priority] || a.createdAt - b.createdAt)
    .map((h) => `
      <div class="row" data-handoff="${h.id}">
        <div>
          <div class="row__name">${esc(h.name)} <span class="row__sub">· ${esc(h.phone)} · ${clock(h.createdAt)}</span></div>
          <div class="row__sub">${esc(h.motive || 'Sem motivo informado')}</div>
        </div>
        <div class="row__tags"><span class="tag tag--${h.priority}">${PRIORITY[h.priority]}</span><span class="tag">${MOOD[h.mood]}</span></div>
        <div>
          <button class="btn btn--primary" data-handoff-open>Assumir conversa</button>
          <button class="btn btn--quiet" data-handoff-resolve>Dispensar</button>
        </div>
      </div>`).join('');
  $('#page-handoffs').innerHTML = `
    <div class="page__head"><h1>Clientes esperando atendente</h1></div>
    ${state.handoffs.length
    ? `<div class="rows">${rows}</div>`
    : '<p class="empty">Ninguém na fila. Quando um cliente pedir para falar com uma pessoa, o robô para de responder naquela conversa e o chamado aparece aqui.</p>'}
    <p class="lede" style="margin-top:16px">Ao assumir, o Figrano abre a conversa no WhatsApp, envia sua mensagem de apresentação e mantém o robô pausado nela por 24 horas.</p>`;
}

// ------------------------------------------------------------------ whatsapp

function pauseLabel(until) {
  if (until > Date.now() + 365 * 86400e3) return 'Robô pausado até você reativar';
  const date = new Date(until);
  const day = isToday(until) ? '' : ' de amanhã';
  return `Robô pausado até ${clock(date)}${day}`;
}

function renderChatbar() {
  const { whatsapp, settings } = state;
  const chat = whatsapp.activeChat;
  const bar = $('#chatbar');
  const note = $('#wa-note');
  note.textContent = whatsapp.state === 'error'
    ? `Não foi possível abrir o WhatsApp Web. ${whatsapp.detail || ''}`
    : 'Abrindo o WhatsApp Web…';

  if (whatsapp.state === 'error') {
    bar.innerHTML = '<span class="chatbar__state">Sem conexão com o WhatsApp Web.</span><span class="spacer"></span><button class="btn" data-wa-reload>Tentar de novo</button>';
    return;
  }
  if (whatsapp.state !== 'ready') {
    const text = whatsapp.state === 'qr'
      ? 'Leia o QR code abaixo com o WhatsApp do celular da loja para conectar.'
      : 'Aguarde o WhatsApp terminar de carregar.';
    bar.innerHTML = `<span class="chatbar__state">${text}</span>`;
    return;
  }
  if (!chat || chat.isGroup) {
    bar.innerHTML = `<span class="chatbar__state">${chat ? 'O robô não responde em grupos.' : 'Abra uma conversa para ver e controlar o robô nela.'}</span>`;
    return;
  }

  const paused = Boolean(chat.pausedUntil);
  let status;
  let controls;
  if (settings.bot.status !== 'active') {
    status = settings.bot.status === 'alerts' ? 'Robô em Só avisos: não responde ninguém' : 'Robô desligado';
    controls = '';
  } else if (paused) {
    status = pauseLabel(chat.pausedUntil);
    controls = '<button class="btn btn--primary" data-wa-resume>Reativar robô</button>';
  } else {
    status = 'Robô respondendo esta conversa';
    controls = `
      <div class="seg"><span class="seg__label">Pausar por</span>
        <button class="btn" data-wa-pause="15m">15 min</button>
        <button class="btn" data-wa-pause="1h">1 hora</button>
        <button class="btn" data-wa-pause="24h">24 horas</button>
        <button class="btn" data-wa-pause="indefinite">Até eu reativar</button>
      </div>`;
  }
  bar.innerHTML = `
    <span class="chatbar__who">${esc(chat.name || chat.chatId.split('@')[0])}</span>
    <span class="chatbar__state" data-paused="${paused}">${status}</span>
    <span class="spacer"></span>
    <button class="btn" data-wa-menu>Enviar cardápio</button>
    <button class="btn" data-wa-order>Lançar pedido</button>
    ${controls}`;
}

/** Informa ao processo principal onde desenhar a visão do WhatsApp (ou que deve escondê-la). */
function layoutWhatsapp() {
  const show = page === 'whatsapp' && state && state.whatsapp.state !== 'error' && !$('#dialog').open;
  if (!show) {
    api.call('wa:layout', null);
    return;
  }
  const rect = $('#wa-slot').getBoundingClientRect();
  api.call('wa:layout', { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
}

// -------------------------------------------------------------------- ajustes

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function renderSettings() {
  const { store: s, bot, ai, app } = state.settings;
  const hours = DAYS.map((day, i) => {
    const slot = s.hours[i] || { closed: true, open: '18:00', close: '23:00' };
    return `
      <span>${day}</span>
      <label class="check" style="margin:0"><input type="checkbox" name="open-${i}" ${slot.closed ? '' : 'checked'}> Abre</label>
      <input type="time" name="from-${i}" value="${esc(slot.open)}" aria-label="${day}: abre às">
      <input type="time" name="to-${i}" value="${esc(slot.close)}" aria-label="${day}: fecha às">`;
  }).join('');

  $('#page-settings').innerHTML = `
    <div class="page__head"><h1>Ajustes</h1></div>
    <div class="settings">
      <form class="panel" data-form="store">
        <h2>Loja</h2>
        <p>Estes dados aparecem nas respostas do robô.</p>
        <label class="field"><span>Nome da loja</span><input type="text" name="name" value="${esc(s.name)}" required></label>
        <label class="field"><span>Endereço</span><input type="text" name="address" value="${esc(s.address)}"></label>
        <div class="fields-2">
          <div class="field"><span>Logo</span>
            <div class="photo-pick">${s.logo ? `<img class="photo-pick__img photo-pick__img--round" src="figrano-img://${s.logo}" alt="">` : ''}
              <div class="photo-pick__actions"><input type="file" accept="image/jpeg,image/png,image/webp" data-store-image="logo">${s.logo ? '<button type="button" class="btn btn--quiet" data-store-image-remove="logo">Remover</button>' : ''}</div></div>
          </div>
          <div class="field"><span>Capa do cardápio online</span>
            <div class="photo-pick">${s.cover ? `<img class="photo-pick__img photo-pick__img--wide" src="figrano-img://${s.cover}" alt="">` : ''}
              <div class="photo-pick__actions"><input type="file" accept="image/jpeg,image/png,image/webp" data-store-image="cover">${s.cover ? '<button type="button" class="btn btn--quiet" data-store-image-remove="cover">Remover</button>' : ''}</div></div>
          </div>
        </div>
        <div class="fields-2">
          <label class="field"><span>Taxa de entrega (R$)</span><input type="number" name="deliveryFee" min="0" step="0.01" value="${s.deliveryFee}"></label>
          <label class="field"><span>Pedido mínimo (R$)</span><input type="number" name="minOrder" min="0" step="0.01" value="${s.minOrder}"></label>
        </div>
        <div class="fields-2">
          <label class="field"><span>Tempo de preparo (min)</span><input type="number" name="prepMinutes" min="0" step="1" value="${s.prepMinutes}"></label>
          <label class="field"><span>Formas de pagamento</span><input type="text" name="payments" value="${esc(s.payments.join(', '))}"><small>Separe por vírgula.</small></label>
        </div>
        <label class="check"><input type="checkbox" name="delivery" ${s.delivery ? 'checked' : ''}> Faz entrega</label>
        <label class="check"><input type="checkbox" name="pickup" ${s.pickup ? 'checked' : ''}> Aceita retirada na loja</label>
        <div class="panel__foot"><button class="btn btn--primary">Salvar loja</button><span class="panel__msg"></span></div>
      </form>

      <form class="panel" data-form="hours">
        <h2>Horário de funcionamento</h2>
        <p>Fora do horário o robô avisa que a loja está fechada e não anota pedidos. Um fechamento menor que a abertura (ex.: 18:00 às 02:00) vale para a madrugada seguinte.</p>
        <div class="hours">${hours}</div>
        <div class="panel__foot"><button class="btn btn--primary">Salvar horário</button><span class="panel__msg"></span></div>
      </form>

      <form class="panel" data-form="bot">
        <h2>Robô</h2>
        <p>O status geral (Ativo, Só avisos, Desligado) fica na barra do topo.</p>
        <label class="field"><span>Mensagem ao assumir uma conversa</span><textarea name="handoffMessage">${esc(bot.handoffMessage)}</textarea></label>
        <label class="check"><input type="checkbox" name="autoPauseOnManualReply" ${bot.autoPauseOnManualReply ? 'checked' : ''}> Pausar o robô por 15 min quando eu responder um cliente</label>
        <label class="check"><input type="checkbox" name="autoArchive" ${bot.autoArchive ? 'checked' : ''}> Arquivar conversas antigas ao conectar</label>
        <label class="field"><span>Arquivar conversas paradas há mais de (dias)</span><input type="number" name="archiveDays" min="1" max="365" value="${bot.archiveDays}"></label>
        <div class="panel__foot">
          <button class="btn btn--primary">Salvar robô</button>
          <button type="button" class="btn" data-archive-now>Arquivar agora</button>
          <span class="panel__msg"></span>
        </div>
      </form>

${onlinePanel(state.settings.online)}

      <form class="panel" data-form="ai">
        <h2>Inteligência artificial</h2>
        <p>Com a IA ligada, a atendente virtual entende frases livres como "duas calabresas sem cebola para entregar". Sem ela, o cliente pede pelos números do cardápio.</p>
        <label class="check"><input type="checkbox" name="enabled" ${ai.enabled ? 'checked' : ''}> Usar IA para mensagens livres</label>
        <label class="field"><span>Onde a IA roda</span>
          <select name="provider">
            <option value="ollama" ${ai.provider === 'ollama' ? 'selected' : ''}>Neste computador (Ollama, sem custo por mensagem)</option>
            <option value="anthropic" ${ai.provider !== 'ollama' ? 'selected' : ''}>Na nuvem (Anthropic, cobrado por mensagem)</option>
          </select>
        </label>
        <div data-ai-provider="ollama" ${ai.provider === 'ollama' ? '' : 'hidden'}>
          <label class="field"><span>Modelo do Ollama</span>
            <input type="text" name="ollamaModel" list="ollama-models" value="${esc(ai.ollamaModel)}" autocomplete="off">
            <datalist id="ollama-models"></datalist>
            <small>Precisa aceitar ferramentas (ex.: qwen3.5:9b). O Ollama tem que estar aberto.</small>
          </label>
          <label class="field"><span>Endereço do Ollama</span><input type="text" name="ollamaUrl" value="${esc(ai.ollamaUrl)}" autocomplete="off"></label>
        </div>
        <label class="field" data-ai-provider="anthropic" ${ai.provider === 'ollama' ? 'hidden' : ''}><span>Chave de API da Anthropic</span>
          <input type="password" name="apiKey" placeholder="${ai.hasKey ? 'Chave salva. Preencha só para trocar.' : 'sk-ant-...'}" autocomplete="off">
          <small>Fica guardada neste computador, criptografada pelo Windows.</small>
        </label>
        <div class="panel__foot">
          <button class="btn btn--primary">Salvar IA</button>
          <button type="button" class="btn" data-ai-test>Testar</button>
          <span class="panel__msg" ${ai.lastError ? 'data-kind="error"' : ''}>${esc(ai.lastError ? `Última falha: ${ai.lastError}` : '')}</span>
        </div>
      </form>

      <form class="panel" data-form="app">
        <h2>Aplicativo</h2>
        <p>Fechar a janela mantém o Figrano na bandeja do sistema, com o robô respondendo. Para encerrar, use Sair no ícone da bandeja.</p>
        <label class="check"><input type="checkbox" name="autoStart" ${app.autoStart ? 'checked' : ''}> Abrir o Figrano ao ligar o computador</label>
        <div class="panel__foot"><button class="btn btn--primary">Salvar</button><span class="panel__msg">Versão ${esc(state.version)}</span></div>
      </form>
    </div>`;
}

/** Lê um arquivo escolhido como data URL, para enviar ao processo principal. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

/** Painel de Ajustes > Pedido online. */
function onlinePanel(online) {
  if (!online.url) {
    return `
      <form class="panel" data-form="online">
        <h2>Pedido online</h2>
        <p>A loja ganha uma página com o cardápio onde o cliente monta o pedido sozinho. O robô passa a mandar o link da página em vez da lista inteira, e os pedidos caem aqui no painel. Este computador precisa estar ligado com o Figrano aberto para a página aceitar pedidos.</p>
        <label class="field"><span>Endereço da página</span>
          <input type="text" name="slug" placeholder="cantina-do-ze" pattern="[a-z0-9-]{3,40}" required autocomplete="off">
          <small>Letras minúsculas, números e hífen. Fica assim: ${esc(online.apiUrl)}/<b>endereço</b></small>
        </label>
        <details><summary>Servidor</summary>
          <label class="field"><span>Endereço do servidor</span><input type="text" name="apiUrl" value="${esc(online.apiUrl)}" autocomplete="off"></label>
        </details>
        <div class="panel__foot"><button class="btn btn--primary">Ativar pedido online</button><span class="panel__msg"></span></div>
      </form>`;
  }
  const status = !online.enabled ? 'Pausado: a página mostra o cardápio, mas não aceita pedidos.'
    : online.lastError ? `Sem conexão: ${online.lastError}`
      : online.connected ? 'Conectado. Pedidos novos chegam em até 5 segundos.' : 'Conectando…';
  return `
    <form class="panel" data-form="online">
      <h2>Pedido online</h2>
      <p>Link da sua página. O robô envia este link quando o cliente pede o cardápio.</p>
      <label class="field"><span>Link</span><input type="text" readonly value="${esc(online.url)}" data-online-url></label>
      <label class="check"><input type="checkbox" name="enabled" ${online.enabled ? 'checked' : ''} data-online-toggle> Receber pedidos pela página</label>
      <div class="panel__foot">
        <button type="button" class="btn" data-online-copy>Copiar link</button>
        <button type="button" class="btn" data-online-open>Abrir página</button>
        <span class="panel__msg" ${online.enabled && online.lastError ? 'data-kind="error"' : ''}>${esc(status)}</span>
      </div>
    </form>`;
}

/** Valores do formulário de IA; a chave só vai quando foi preenchida. */
function aiFormValues(form) {
  const data = new FormData(form);
  const apiKey = String(data.get('apiKey') || '').trim();
  return {
    enabled: data.has('enabled'),
    provider: String(data.get('provider')),
    ollamaModel: String(data.get('ollamaModel') || '').trim(),
    ollamaUrl: String(data.get('ollamaUrl') || '').trim(),
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Mostra os campos do provedor escolhido e sugere os modelos instalados no Ollama. */
async function refreshAiForm(form) {
  const provider = form.elements.provider.value;
  for (const el of form.querySelectorAll('[data-ai-provider]')) el.hidden = el.dataset.aiProvider !== provider;
  if (provider !== 'ollama') return;
  const models = await api.call('ai:models').catch(() => []);
  const list = $('#ollama-models', form);
  if (list) list.innerHTML = models.map((name) => `<option value="${esc(name)}">`).join('');
}

document.addEventListener('change', async (event) => {
  if (event.target.matches?.('[data-photo-input]')) {
    const file = event.target.files[0];
    const preview = $('[data-photo-preview]', event.target.closest('form'));
    if (file && preview) { preview.src = await readAsDataUrl(file); preview.hidden = false; }
    return;
  }
  if (event.target.matches?.('[data-store-image]')) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await api.call('store:setImage', event.target.dataset.storeImage, await readAsDataUrl(file));
      renderSettings();
      toast('Imagem salva.');
    } catch (error) {
      toast(errorText(error), 'error');
    }
    return;
  }
  if (event.target.matches?.('[data-online-toggle]')) {
    try {
      await api.call('online:setEnabled', event.target.checked);
      renderSettings();
    } catch (error) {
      event.target.checked = !event.target.checked;
      toast(errorText(error));
    }
    return;
  }
  const form = event.target.closest?.('form[data-form="ai"]');
  if (form && event.target.name === 'provider') refreshAiForm(form);
});

async function saveSettings(form) {
  const data = new FormData(form);
  const kind = form.dataset.form;
  const message = $('.panel__msg', form);
  const say = (text, tone) => { message.textContent = text; message.dataset.kind = tone; };
  try {
    if (kind === 'store') {
      const payments = String(data.get('payments')).split(',').map((p) => p.trim()).filter(Boolean);
      if (payments.length === 0) throw new Error('Informe ao menos uma forma de pagamento.');
      if (!data.has('delivery') && !data.has('pickup')) throw new Error('Marque entrega, retirada ou as duas.');
      await api.call('settings:update', 'store', {
        name: String(data.get('name')).trim(), address: String(data.get('address')).trim(),
        deliveryFee: Number(data.get('deliveryFee')) || 0, minOrder: Number(data.get('minOrder')) || 0,
        prepMinutes: Number(data.get('prepMinutes')) || 0, payments,
        delivery: data.has('delivery'), pickup: data.has('pickup'),
      });
    } else if (kind === 'hours') {
      const hours = {};
      for (let i = 0; i < 7; i++) {
        hours[i] = { closed: !data.has(`open-${i}`), open: data.get(`from-${i}`) || '18:00', close: data.get(`to-${i}`) || '23:00' };
      }
      await api.call('settings:update', 'store', { hours });
    } else if (kind === 'bot') {
      await api.call('settings:update', 'bot', {
        handoffMessage: String(data.get('handoffMessage')),
        autoPauseOnManualReply: data.has('autoPauseOnManualReply'),
        autoArchive: data.has('autoArchive'),
        archiveDays: Math.min(365, Math.max(1, Number(data.get('archiveDays')) || 60)),
      });
    } else if (kind === 'online') {
      say('Ativando…', '');
      const url = await api.call('online:activate', { slug: String(data.get('slug') || ''), apiUrl: String(data.get('apiUrl') || '') });
      renderSettings();
      toast(`Página no ar: ${url}`);
      return;
    } else if (kind === 'ai') {
      await api.call('ai:configure', aiFormValues(form));
      form.elements.apiKey.value = '';
    } else if (kind === 'app') {
      await api.call('settings:update', 'app', { autoStart: data.has('autoStart') });
    }
    say('Salvo.', 'ok');
  } catch (error) {
    say(errorText(error), 'error');
  }
}

// -------------------------------------------------------------------- diálogo

/**
 * Abre o diálogo com um formulário. `onSubmit` devolve uma mensagem de erro
 * (mantém aberto) ou null (fecha).
 */
function showDialog(html, onSubmit) {
  const dialog = $('#dialog');
  dialog.innerHTML = `<form method="dialog">${html}</form>`;
  const form = $('form', dialog);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    let problem;
    try {
      problem = await onSubmit(form);
    } catch (error) {
      problem = errorText(error);
    }
    if (problem) $('#dialog-error', dialog).textContent = problem;
    else dialog.close();
  });
  $('[data-close]', dialog)?.addEventListener('click', () => dialog.close());
  dialog.showModal();
  layoutWhatsapp();
}

// --------------------------------------------------------------------- eventos

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  const d = target.dataset;

  if (d.page) return navigate(d.page);
  if (d.botStatus) return call('settings:update', 'bot', { status: d.botStatus });

  // Pedidos
  if ('newOrder' in d) return openOrderDialog();
  const orderEl = target.closest('[data-order]');
  if (orderEl) {
    const order = state.orders.find((o) => o.id === orderEl.dataset.order);
    if (d.orderStatus) return call('orders:setStatus', order.id, d.orderStatus);
    if ('orderPrint' in d) return call('orders:print', order.id);
    if ('orderChat' in d) {
      await call('wa:openChat', order.customer.chatId);
      return navigate('whatsapp');
    }
  }

  // Cardápio
  const categoryEl = target.closest('[data-category]');
  if (categoryEl) {
    const category = state.menu.categories.find((c) => c.id === categoryEl.dataset.category);
    const row = target.closest('[data-item-row]');
    const item = row ? category.items.find((i) => i.id === row.dataset.itemRow) : null;
    if ('itemNew' in d) return openItemDialog(category.id);
    if ('catRename' in d) return openRenameDialog(category);
    if ('catDelete' in d) {
      if (category.items.length && !window.confirm(`Excluir "${category.name}" e seus ${category.items.length} itens?`)) return undefined;
      return call('menu:deleteCategory', category.id);
    }
    if (item && 'itemEdit' in d) return openItemDialog(category.id, item);
    if (item && 'itemToggle' in d) return call('menu:saveItem', category.id, { ...item, available: item.available === false });
    if (item && 'itemDelete' in d) return call('menu:deleteItem', category.id, item.id);
  }

  // Atendimentos
  const handoffEl = target.closest('[data-handoff]');
  if (handoffEl) {
    if ('handoffResolve' in d) return call('handoffs:resolve', handoffEl.dataset.handoff);
    if ('handoffOpen' in d) {
      try {
        await api.call('handoffs:open', handoffEl.dataset.handoff);
        return navigate('whatsapp');
      } catch (error) {
        return toast(errorText(error), 'error');
      }
    }
  }

  // WhatsApp
  const chat = state.whatsapp.activeChat;
  if ('waReload' in d) return call('wa:reload');
  if (chat && d.waPause) return call('wa:pause', chat.chatId, d.waPause);
  if (chat && 'waResume' in d) return call('wa:resume', chat.chatId);
  if (chat && 'waMenu' in d) {
    target.disabled = true;
    await call('wa:sendMenu', chat.chatId);
    target.disabled = false;
    return undefined;
  }
  if (chat && 'waOrder' in d) {
    const digits = chat.chatId.endsWith('@c.us') ? chat.chatId.split('@')[0].replace(/^55/, '') : '';
    navigate('orders');
    return openOrderDialog({ name: chat.name, phone: digits, chatId: chat.chatId });
  }

  // Ajustes
  if ('archiveNow' in d) {
    const count = await call('wa:archiveOld');
    if (count !== undefined) toast(count ? `${count} conversas arquivadas.` : 'Nenhuma conversa antiga para arquivar.');
    return undefined;
  }
  if (d.storeImageRemove) {
    await call('store:setImage', d.storeImageRemove, null);
    renderSettings();
    return undefined;
  }
  if ('onlineCopy' in d) {
    const url = $('[data-online-url]')?.value || '';
    try { await navigator.clipboard.writeText(url); toast('Link copiado.'); } catch { $('[data-online-url]')?.select(); }
    return undefined;
  }
  if ('onlineOpen' in d) {
    await call('online:openPage');
    return undefined;
  }
  if ('aiTest' in d) {
    const form = target.closest('form');
    const message = $('.panel__msg', form);
    const { enabled, ...config } = aiFormValues(form);
    message.textContent = config.provider === 'ollama' ? 'Testando (a primeira vez carrega o modelo)…' : 'Testando…';
    message.dataset.kind = '';
    try {
      await api.call('ai:configure', config);
      form.elements.apiKey.value = '';
      message.textContent = await api.call('ai:test');
      message.dataset.kind = 'ok';
    } catch (error) {
      message.textContent = errorText(error);
      message.dataset.kind = 'error';
    }
  }
  return undefined;
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'category-form') {
    event.preventDefault();
    await call('menu:saveCategory', { name: new FormData(form).get('name') });
  } else if (form.dataset.form) {
    event.preventDefault();
    await saveSettings(form);
  }
});

$('#dialog').addEventListener('close', layoutWhatsapp);
new ResizeObserver(layoutWhatsapp).observe($('#wa-slot'));

// A pausa expira sozinha: atualiza a barra da conversa de tempos em tempos.
setInterval(() => { if (page === 'whatsapp' && state?.whatsapp.activeChat?.pausedUntil) refresh(); }, 20000);

// --------------------------------------------------------------------- arranque

async function refresh() {
  state = await api.call('state:get');
  renderShell();
  renderPage(false);
  layoutWhatsapp();
}

api.onChange(() => refresh());
api.onNavigate((target) => navigate(target));

window.__smoke = () => ({
  ok: errors.length === 0 && Boolean(state) && $$('.sidebar [data-page]').length === 5 && !$('#page-orders').hidden,
  errors,
  page,
  title: $('#page-orders h1')?.textContent,
});

(async () => {
  state = await api.call('state:get');
  navigate('orders');
})();
