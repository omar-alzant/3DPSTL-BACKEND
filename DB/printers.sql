-- 3DSTL: the shop's printers, as reported by the bridge program that runs on a computer in the shop
-- (Admin → Printers). Run once in the Supabase SQL editor.
create table if not exists public.printers (
  id          text primary key,              -- the id written in the bridge's config.json (e.g. "k1max")
  name        text not null,
  kind        text not null,                 -- creality | bambu
  online      boolean not null default false,
  status      jsonb,                         -- { state, file, progress, leftSec, jobSec, nozzle, nozzleTarget, bed, bedTarget, model }
  updated_at  timestamptz not null default now()
);

create table if not exists public.printer_commands (
  id          bigserial primary key,
  printer_id  text not null references public.printers(id) on delete cascade,
  command     text not null check (command in ('pause', 'resume', 'stop')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  done_at     timestamptz,
  ok          boolean,
  message     text
);
create index if not exists printer_commands_pending_idx on public.printer_commands (printer_id) where done_at is null;

-- only the backend (service role) reads and writes these
alter table public.printers enable row level security;
alter table public.printer_commands enable row level security;
