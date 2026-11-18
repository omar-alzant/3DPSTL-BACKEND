-- 3DSTL Studio: print orders for custom designs (keychains, plates, keycaps…)
-- Run once in Supabase → SQL Editor. Only the backend (service role) reads/writes this table.

create table if not exists public.studio_orders (
  id             text primary key,                       -- e.g. ST-261117-A3F9
  user_id        uuid references auth.users(id) on delete set null,
  status         text not null default 'new'
                 check (status in ('new','printing','ready','delivered','cancelled')),
  tool_id        text not null,
  tool_name      text,
  params         jsonb not null,                         -- full design settings (incl. uploaded logo)
  customer_name  text not null,
  customer_phone text not null,
  customer_address text,                                 -- عنوان السكن (إلزامي في الطلبات الجديدة)
  qty            integer not null default 1 check (qty between 1 and 500),
  notes          text,
  estimate       jsonb,                                  -- { grams, price, currency }
  size           numeric[],                              -- [x, y, z] mm
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists studio_orders_created_at_idx on public.studio_orders (created_at desc);
create index if not exists studio_orders_status_idx on public.studio_orders (status);

-- Block direct access with the anon key; the backend uses the service role, which bypasses RLS
alter table public.studio_orders enable row level security;

-- 3DSTL Studio: pricing settings, edited from Admin → Studio Pricing (one row, id = 1)
create table if not exists public.studio_settings (
  id          integer primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,   -- { currency, pricePerGram, minPrice, colorFee, whatsapp, tools: {…} }
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.studio_settings enable row level security;
