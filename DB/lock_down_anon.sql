-- =====================================================================
-- 3DSTL: database access only through the backend (service role)
--
-- The anon key is public (it ships in the website's JavaScript), so the anon and
-- authenticated roles must not be able to touch any table, sequence or function.
-- The backend uses SUPABASE_SERVICE_ROLE_KEY for all data, which bypasses RLS.
-- Supabase Auth (login, sign-up, reset password) keeps working with the anon key:
-- it does not need access to the public schema.
--
-- Run once in Supabase → SQL Editor. Safe to run again.
-- =====================================================================

-- 1. Turn on Row Level Security for every table in public, with NO policies
--    = anon / authenticated see nothing; service_role is not affected.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 2. Remove the broad grants (the old "GRANT ALL ... TO anon, authenticated")
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- 3. Same for tables / functions created in the future
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- 4. The backend's role keeps full access
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges for role postgres in schema public grant all on tables    to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- =====================================================================
-- Checks — run these after; every result should be EMPTY
-- =====================================================================

-- a) tables without RLS
select tablename as "RLS OFF" from pg_tables where schemaname = 'public' and not rowsecurity;

-- b) anything still granted to anon / authenticated on tables
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');

-- c) RLS policies that would let anon / authenticated in again
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and roles && array['anon', 'authenticated', 'public']::name[];

-- d) Storage: who may upload/delete files (only service_role should; public READ of
--    product images is fine because images are shown on the site)
select policyname, roles, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and cmd <> 'SELECT';
