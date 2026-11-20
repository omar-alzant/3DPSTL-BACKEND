-- Error log for the website (frontend crashes + server errors).
-- Same error = same fingerprint → one row with a counter, not thousands of rows.
-- Run once in Supabase → SQL Editor.

create table if not exists public.app_errors (
  id           bigserial primary key,
  fingerprint  text not null unique,
  source       text not null check (source in ('client', 'server')),
  message      text not null,
  stack        text,
  url          text,
  user_agent   text,
  user_id      uuid,
  count        integer not null default 1,
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  emailed_at   timestamptz,
  resolved     boolean not null default false
);

create index if not exists app_errors_last_idx on public.app_errors (resolved, last_at desc);

-- only the backend (service role) touches this table
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
revoke all on sequence public.app_errors_id_seq from anon, authenticated;

-- Record one occurrence: insert, or bump the counter (and re-open it if it was resolved).
-- Returns true when an email should be sent: new error, came back after "resolved", or last email > 6 hours ago.
create or replace function public.app_error_hit(
  p_fingerprint text, p_source text, p_message text, p_stack text,
  p_url text, p_user_agent text, p_user uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r public.app_errors;
begin
  insert into public.app_errors as e (fingerprint, source, message, stack, url, user_agent, user_id)
  values (p_fingerprint, p_source, left(p_message, 1000), left(p_stack, 4000), left(p_url, 500), left(p_user_agent, 300), p_user)
  on conflict (fingerprint) do update
    set count = e.count + 1,
        last_at = now(),
        url = excluded.url,
        user_agent = excluded.user_agent,
        user_id = coalesce(excluded.user_id, e.user_id),
        resolved = false,
        emailed_at = case when e.resolved then null else e.emailed_at end
  returning * into r;

  if r.emailed_at is null or r.emailed_at < now() - interval '6 hours' then
    update public.app_errors set emailed_at = now() where id = r.id;
    return true;
  end if;
  return false;
end $$;

revoke all on function public.app_error_hit(text, text, text, text, text, text, uuid) from public, anon, authenticated;
