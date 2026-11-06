-- Removes the shared social hub and nothing else: the social schema and the two
-- roles 0001_social_hub.sql makes. Every friendship, group and result card in the
-- hub goes with it, for good. Like the install, a hosted run needs the owner's
-- explicit approval.
--
-- One statement, so it all happens or none of it does, even in a client that carries
-- on after an error. It can be run again safely once the hub is gone.
--
-- CASCADE takes anything built on the hub along with it, so the block first looks
-- for objects outside the schema that depend on the schema's tables, types or
-- functions, and stops if it finds any. Nothing should: games never read hub tables.
--
-- A role that still holds a right somewhere else makes its drop fail, which also
-- leaves the schema in place. Dropping a role takes its memberships with it.

do $$
declare
  v_schema oid;
  v_outside text;
begin
  select n.oid into v_schema from pg_namespace n where n.nspname = 'social';

  select string_agg(distinct pg_describe_object(d.classid, d.objid, d.objsubid), ', ')
    into v_outside
    from pg_depend d
    cross join lateral pg_identify_object(d.classid, d.objid, d.objsubid) o
   where d.deptype = 'n'
     and o.schema is distinct from 'social'
     and (
       (d.refclassid = 'pg_class'::regclass and exists (
         select 1 from pg_class c where c.oid = d.refobjid and c.relnamespace = v_schema
       ))
       or (d.refclassid = 'pg_proc'::regclass and exists (
         select 1 from pg_proc p where p.oid = d.refobjid and p.pronamespace = v_schema
       ))
       or (d.refclassid = 'pg_type'::regclass and exists (
         select 1 from pg_type t where t.oid = d.refobjid and t.typnamespace = v_schema
       ))
     );
  if v_outside is not null then
    raise exception 'social hub not removed: these objects depend on it: %', v_outside;
  end if;

  drop schema if exists social cascade;
  drop role if exists social_gateway;
  drop role if exists social_game_server;
end;
$$;
