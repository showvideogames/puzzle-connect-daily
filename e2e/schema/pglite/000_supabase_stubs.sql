-- Stand-ins for the parts of Supabase that are NOT in this repository's
-- migrations: the auth schema, auth.uid()/auth.role(), and the three roles
-- the baseline's GRANT/REVOKE statements name.
--
-- PGLITE ONLY. This file is never applied to the real local Supabase stack —
-- there, GoTrue owns auth.users and auth.uid(), and redefining them would
-- break real authentication. `npm run e2e:db:verify` (the Docker-free
-- baseline + seed check) applies it; `npm run e2e:reset` does not.
--
-- The impersonation contract is the real one: auth.uid() reads
-- `request.jwt.claims`, so a seed or test can act as a given user with
--     select set_config('request.jwt.claims', '{"sub":"<uuid>"}', true);
-- exactly as it does on a real Supabase instance.

create schema if not exists auth;
create schema if not exists extensions;

-- Same shape as Supabase's own definitions: the claims GUC is read
-- defensively, so an UNSET or blank value means "anonymous" rather than a
-- cast error. That matters here because switching identity between seed
-- steps is done by blanking the GUC.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    'anon'
  );
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- gen_random_uuid() is core from PG13 onward; PGlite ships no pgcrypto, and
-- none is needed.

-- The baseline declares foreign keys against auth.users, and the account
-- layer reads the caller's shared-identity link from auth.identities
-- (ensure_account). Both are modelled with the columns Rainbow touches.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_id text not null,
  identity_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  unique (provider, provider_id)
);

-- Supabase's bootstrap default privileges, exactly as a real project (and
-- e2e/schema/000_reset.sql on the local stack) has them: every new table and
-- function in `public` is reachable by the client roles UNLESS a migration
-- revokes it. Modelled here so that PGlite reports the same grants as the
-- real stack — which is what makes the manifest check meaningful on both,
-- and what forces the baseline to REVOKE explicitly from anon/authenticated
-- for anything that must stay internal.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
