-- Two columns swap names.
--
--   platform  ->  source      Where the post came from: X, Instagram, YouTube...
--   source    ->  submitter   How it reached the queue: Bot, Manual, Bookmarklet.
--
-- The old `source` meant "how it got here", which reads as the same question as
-- "where is it from" and was not. The platform IS the source of a post; Bot or Manual
-- is who submitted it. On a card they are the first and second tags.
--
-- Run this once in the Supabase SQL editor for the SOLD OUT! project. /socializer and
-- the SOC SOCIALIZER BOT both use the new names, so the page reads an empty queue and
-- the bot's inserts fail until it has run.
--
-- ORDER MATTERS in both halves: `source` has to get out of the way before `platform`
-- can take the name, and the same for the constraints that follow the columns.

alter table public.socializer rename column source   to submitter;
alter table public.socializer rename column platform to source;

-- A column rename leaves its check constraint behind under the old name, so a table
-- freshly renamed still says socializer_platform_check. If these two fail, run
-- \d public.socializer and use whatever names it actually prints.
alter table public.socializer
    rename constraint socializer_source_check   to socializer_submitter_check;
alter table public.socializer
    rename constraint socializer_platform_check to socializer_source_check;
