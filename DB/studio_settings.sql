-- Run this file alone in Supabase → SQL Editor if studio_orders.sql was already run before.
-- 3DSTL Studio: pricing settings, edited from Admin → Studio Pricing (one row, id = 1)
create table if not exists public.studio_settings (
  id          integer primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,   -- { currency, pricePerGram, minPrice, colorFee, whatsapp, tools: {…} }
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.studio_settings enable row level security;
