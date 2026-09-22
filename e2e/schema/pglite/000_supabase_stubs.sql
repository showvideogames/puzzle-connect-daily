-- Stand-ins for the parts of Supabase that are NOT in this repository's
-- migrations: the auth schema, auth.uid()/auth.role(), and the three roles
-- the migrations' GRANT/REVOKE statements name.
--
-- PGLITE ONLY. This file is never applied to the real local Supabase stack —
-- there, GoTrue owns auth.users and auth.uid(), and redefining them would
-- break real authentication. `npm run e2e:db:verify` (the Docker-free
-- migration + seed check) applies it; `npm run e2e:reset` does not.
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

-- Several migrations declare foreign keys against auth.users.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
