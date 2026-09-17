-- Somewhere to keep the picture.
--
-- has_media was only ever a boolean: it said a post carried an image or a video, which
-- is what decides whether the candidate can go to Instagram and Threads. It never said
-- WHERE that image was, so the queue could tell you a thing had media and then not show
-- it to you. This is the column that holds the URL.
--
-- Run this once in the Supabase SQL editor for the SOLD OUT! project.
--
-- Two things fill it. The FUNNY bookmarklet runs on the post's own page, so it reads
-- the og:image meta tag out of the page it is looking at and hands it over with the
-- link. The SOC SOCIALIZER BOT fills it from the same tag when it confirms a permalink.
--
-- Rows added before this ran keep an empty string and simply show no picture, except
-- YouTube, which the page works out from the video id in post_key without help.
--
-- Empty string rather than null, so nothing has to test for two kinds of nothing.

alter table public.socializer
    add column if not exists media_url text not null default '';
