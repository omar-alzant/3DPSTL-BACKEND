-- =====================================================================
-- 3DSTL Studio: credits (كريدت)
-- الزبون يشتري باقة (يحوّل عبر Whish Money أو Neo) → الأدمن يوافق → تُضاف الكريدتات.
-- كل تنزيل ملف من الـ Studio يخصم قيمة الأداة (تُحدَّد من Admin → Studio Pricing).
-- الأدمن لا يُخصم منه شيء.
--
-- Run once in Supabase → SQL Editor. Safe to run again.
-- Only the backend (service role) touches these tables (RLS on, no policies).
-- =====================================================================

-- الرصيد الحالي لكل مستخدم
create table if not exists public.credit_balances (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  balance     integer not null default 0 check (balance >= 0),
  updated_at  timestamptz not null default now()
);

-- الباقات المعروضة للبيع (يديرها الأدمن)
create table if not exists public.credit_packages (
  id          bigserial primary key,
  name        text,
  credits     integer not null check (credits > 0),
  price       numeric(10,2) not null check (price >= 0),
  currency    text not null default 'USD',
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

-- طلبات الشحن (بانتظار موافقة الأدمن)
create table if not exists public.credit_requests (
  id          text primary key,                       -- e.g. CR-261118-4F2A
  user_id     uuid not null references auth.users(id) on delete cascade,
  package_id  bigint references public.credit_packages(id) on delete set null,
  credits     integer not null check (credits > 0),
  price       numeric(10,2) not null,
  currency    text not null default 'USD',
  method      text not null check (method in ('whish', 'neo')),
  reference   text not null,                          -- رقم العملية من التطبيق
  sender      text,                                   -- اسم/رقم المحوِّل
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note  text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid
);
create index if not exists credit_requests_status_idx on public.credit_requests (status, created_at desc);
create index if not exists credit_requests_user_idx on public.credit_requests (user_id, created_at desc);

-- سجل كل حركة (إضافة / خصم)
create table if not exists public.credit_ledger (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  delta          integer not null,
  balance_after  integer not null,
  kind           text not null check (kind in ('topup', 'download', 'admin', 'refund')),
  tool_id        text,
  design_hash    text,                                -- نفس التصميم لا يُخصم مرتين خلال 24 ساعة
  ref            text,                                -- رقم طلب الشحن...
  note           text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
create index if not exists credit_ledger_hash_idx on public.credit_ledger (user_id, design_hash) where kind = 'download';

alter table public.credit_balances enable row level security;
alter table public.credit_packages enable row level security;
alter table public.credit_requests enable row level security;
alter table public.credit_ledger   enable row level security;

-- حركة واحدة ذرّية: تعدّل الرصيد وتكتب السجل، وترفض إذا صار الرصيد سالباً
create or replace function public.credit_apply(
  p_user uuid, p_delta integer, p_kind text,
  p_tool text default null, p_hash text default null, p_ref text default null,
  p_note text default null, p_by uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare nb integer;
begin
  insert into credit_balances (user_id, balance) values (p_user, 0) on conflict (user_id) do nothing;
  update credit_balances
     set balance = balance + p_delta, updated_at = now()
   where user_id = p_user and balance + p_delta >= 0
  returning balance into nb;
  if nb is null then
    raise exception 'insufficient_credits';
  end if;
  insert into credit_ledger (user_id, delta, balance_after, kind, tool_id, design_hash, ref, note, created_by)
  values (p_user, p_delta, nb, p_kind, p_tool, p_hash, p_ref, p_note, p_by);
  return nb;
end $$;

-- موافقة الأدمن على طلب شحن (مرة واحدة فقط لكل طلب)
create or replace function public.credit_approve(p_id text, p_by uuid, p_note text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare r credit_requests%rowtype;
begin
  select * into r from credit_requests where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;
  update credit_requests set status = 'approved', admin_note = p_note, decided_at = now(), decided_by = p_by where id = p_id;
  return credit_apply(r.user_id, r.credits, 'topup', null, null, p_id, p_note, p_by);
end $$;

revoke execute on function public.credit_apply(uuid, integer, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.credit_approve(text, uuid, text) from public, anon, authenticated;
grant execute on function public.credit_apply(uuid, integer, text, text, text, text, text, uuid) to service_role;
grant execute on function public.credit_approve(text, uuid, text) to service_role;

-- باقات مبدئية (عدّلها من لوحة الإدارة)
insert into public.credit_packages (name, credits, price, sort)
select * from (values ('Starter', 1000, 5.00, 1), ('Plus', 2500, 10.00, 2), ('Pro', 6000, 20.00, 3)) v
where not exists (select 1 from public.credit_packages);

-- ملفات الزبون: كل تصميم نزّله (مع إعداداته) حتى يعيد فتحه وتنزيله من صفحة الكريدت بلا خصم جديد
create table if not exists public.credit_downloads (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  tool_id      text not null,
  tool_name    text,
  label        text,                                  -- الاسم/النص في التصميم
  design_hash  text not null,
  params       jsonb,
  charged      integer not null default 0,
  created_at   timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  unique (user_id, design_hash)
);
create index if not exists credit_downloads_user_idx on public.credit_downloads (user_id, last_at desc);
alter table public.credit_downloads enable row level security;
