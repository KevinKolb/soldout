-- Migration 02: Bluesky, and a tidy-up.
--
-- Run this once in the Supabase SQL editor. Safe to run twice.
--
-- Bluesky is a destination now, and can be a source as well, so the platform
-- check has to admit it. Until this runs the page still works: a Bluesky
-- capture falls back to the 'Web' label and keeps its real URL.
--
-- The delete also clears the probe rows left behind while wiring the table up.
-- They cannot be removed from the page, because the anon role deliberately has
-- no delete policy.

alter table public.socializer
    drop constraint if exists socializer_platform_check;

alter table public.socializer
    add constraint socializer_platform_check
    check (platform in ('X', 'Bluesky', 'Facebook', 'Instagram', 'YouTube', 'Web'));

delete from public.socializer where post_key like 'probe:%';
