-- Esquema do pedido online. Rode com: npm run migrate

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  token_hash text not null,
  name text not null default '',
  info jsonb not null default '{}',   -- endereço, horário, taxa, pagamentos...
  menu jsonb not null default '[]',   -- categorias com itens, enviados pelo app desktop
  last_seen_at timestamptz,           -- última consulta do app desktop
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  ref text not null default '',       -- liga o pedido à conversa do WhatsApp que recebeu o link
  customer jsonb not null,
  items jsonb not null,
  mode text not null,
  address text not null default '',
  payment text not null,
  change_for numeric(10, 2),
  notes text not null default '',
  subtotal numeric(10, 2) not null,
  fee numeric(10, 2) not null,
  total numeric(10, 2) not null,
  -- pending: esperando o app desktop; depois espelha o status do app
  status text not null default 'pending',
  local_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_pending_idx on orders (store_id, created_at) where status = 'pending';

-- Fotos do cardápio, logo e capa. O nome é o hash do JPEG, então nunca muda.
create table if not exists images (
  store_id uuid not null references stores(id) on delete cascade,
  hash text not null,
  bytes bytea not null,
  created_at timestamptz not null default now(),
  primary key (store_id, hash)
);
