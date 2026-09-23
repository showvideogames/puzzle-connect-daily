-- Return the LOCAL test database to a known-empty state.
--
-- Only ever executed against a target that has already passed
-- e2e/safety.ts's assertDisposableTarget(). See e2e/scripts/reset.ts.
--
-- `supabase db reset` is deliberately not used: it applies the repository's
-- migrations by itself, and those migrations are not sufficient on their own
-- (six tables and eight columns of this schema were created outside git —
-- see 010_pre_git_tables.sql). The E2E harness therefore owns the ordering.

drop schema if exists public cascade;
create schema public;

alter schema public owner to postgres;

-- Supabase's own bootstrap grants, restored so that tables created by the
-- migrations below are reachable by PostgREST's anon/authenticated roles
-- exactly as they are on a real project. Several migrations then REVOKE from
-- these roles; that is the intended end state and it only means anything if
-- the grant existed first.
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- Auth users are part of the fixture set, so a reset clears them too.
-- Deleting from auth.users cascades to identities, sessions and refresh
-- tokens through GoTrue's own foreign keys.
delete from auth.users;
