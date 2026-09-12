-- Migration 03: Threads, and the files the bot finds.
--
-- Run this once in the Supabase SQL editor. Safe to run twice.
--
-- media_url is the image or video the source post carries, as the bot found it. Until
-- now the queue recorded only whether media existed, which was enough to grey out the
-- Instagram button and no help at all when it was time to actually post: somebody still
-- had to go back to the original and screenshot it. With the URL on the row the page can
-- show the thing and hand it over.
--
-- It holds a link rather than a file. The bot reads pages with curl and has no login, so
-- uploading into storage would mean giving it a key that can write files - and a link is
-- what it has anyway. The trade is that media disappears if the source deletes the post,
-- which is survivable for a queue worked down within a few days.
--
-- Threads joins the platform list. It was already a place a funny post could come from,
-- and it is now somewhere we post to as well.

alter table public.socializer
    add column if not exists media_url text not null default '';

comment on column public.socializer.media_url is
    'Image or video from the source post, as a URL. Empty when there is none or it could not be read.';

alter table public.socializer
    drop constraint if exists socializer_platform_check;

alter table public.socializer
    add constraint socializer_platform_check
    check (platform in ('X', 'Bluesky', 'Threads', 'Facebook', 'Instagram', 'YouTube', 'Web'));

-- A row that already carries a media URL plainly has media, whatever was guessed before.
update public.socializer
   set has_media = true
 where media_url <> ''
   and has_media is distinct from true;
