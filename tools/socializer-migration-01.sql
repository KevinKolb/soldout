-- Migration 01: more than one destination.
--
-- Run this once in the Supabase SQL editor. Safe to run twice.
--
-- Until now "POSTED" meant posted to X, because X was the only place it could go.
-- With Facebook and Instagram as destinations, status alone cannot say where an
-- article actually went, so posted_to records it and status just says whether the
-- article is still waiting.
--
-- has_media answers the Instagram question. Instagram will not take a text-only
-- post, so the page greys its button out when we know the source has no image or
-- video. NULL means we never checked, and the button stays available.

alter table public.socializer
    add column if not exists posted_to text[]  not null default '{}',
    add column if not exists has_media boolean;

-- Anything already marked POSTED went to X, since X was the only option.
update public.socializer
   set posted_to = array['X']
 where status = 'POSTED'
   and cardinality(posted_to) = 0;

comment on column public.socializer.posted_to is
    'Destinations this article has actually gone out on: X, Facebook, Instagram.';
comment on column public.socializer.has_media is
    'Did the source page carry an image or video? NULL means never checked.';
