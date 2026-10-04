-- ===========================================================================
-- RAINBOW: STORAGE (the custom-emoji bucket and its policies)
-- ===========================================================================
--
-- Kept apart from 0001 because Supabase Storage is not part of every backend
-- the baseline runs on: PGlite (`npm run e2e:db:verify`) has no `storage`
-- schema at all, and the local e2e stack starts without the storage API.
-- Everything here is therefore guarded: on a database without the storage
-- schema it does nothing and says so.
--
-- What Rainbow needs from Storage is exactly one bucket, `custom-emoji`,
-- holding admin-uploaded PNGs that puzzle tiles reference BY NAME (the URL is
-- built from VITE_SUPABASE_URL at render time — see src/lib/customEmoji.ts —
-- so nothing in the database ever contains a project-specific address).
--
--   read    anyone (the bucket is public; the app fetches emoji unauthenticated)
--   write   Rainbow admins only (src/components/admin/CustomEmojiManager.tsx)
--
-- The beta project's live storage policies were never in git (see the
-- integration plan, risk R4). These are the policies the app needs; the
-- Phase 2 read-only comparison against the live project confirms or amends
-- them before the beta reset.
-- ===========================================================================

do $$
begin
  -- Two guards, not one: PGlite has no storage schema at all, and a local
  -- stack started without the storage API has the schema but not the
  -- columns the API adds when it initialises (public, file_size_limit, ...).
  if to_regclass('storage.buckets') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public'
     )
     or to_regclass('storage.objects') is null then
    raise notice 'Supabase Storage is not initialised on this database; skipping 0002_rainbow_storage';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('custom-emoji', 'custom-emoji', true)
  on conflict (id) do update set public = excluded.public;

  -- Policies on storage.objects, scoped to this one bucket by name. Dropped
  -- and recreated so the file is idempotent.
  execute 'drop policy if exists "custom-emoji: anyone can read" on storage.objects';
  execute 'create policy "custom-emoji: anyone can read" on storage.objects
             for select
             using (bucket_id = ''custom-emoji'')';

  execute 'drop policy if exists "custom-emoji: admins can upload" on storage.objects';
  execute 'create policy "custom-emoji: admins can upload" on storage.objects
             for insert to authenticated
             with check (bucket_id = ''custom-emoji'' and public.has_role(public.rainbow_uid(), ''admin''::public.app_role))';

  execute 'drop policy if exists "custom-emoji: admins can replace" on storage.objects';
  execute 'create policy "custom-emoji: admins can replace" on storage.objects
             for update to authenticated
             using (bucket_id = ''custom-emoji'' and public.has_role(public.rainbow_uid(), ''admin''::public.app_role))
             with check (bucket_id = ''custom-emoji'' and public.has_role(public.rainbow_uid(), ''admin''::public.app_role))';

  execute 'drop policy if exists "custom-emoji: admins can delete" on storage.objects';
  execute 'create policy "custom-emoji: admins can delete" on storage.objects
             for delete to authenticated
             using (bucket_id = ''custom-emoji'' and public.has_role(public.rainbow_uid(), ''admin''::public.app_role))';
end
$$;
