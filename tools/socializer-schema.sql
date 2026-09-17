-- The Socializer's repost queue.
--
-- Run this once in the Supabase SQL editor for the SOLD OUT! project.
-- admin/socializer.html reads and writes this table with the project's publishable
-- key, and so does the SOC SOCIALIZER BOT routine. (That key is what Supabase used to
-- call the anon key; it still maps to the anon role the policies below name.)
--
-- It is committed in admin/socializer.html and the page is served from a public site,
-- so treat everything below as reachable by anyone who finds the page.
-- The policies are written accordingly: read, add and rule on rows, nothing else.
-- There is deliberately no delete policy, so nothing can be destroyed from a browser.

create table if not exists public.socializer (
    id          bigint generated always as identity primary key,

    -- The dedupe key the page derives from the URL: 'x:1234567890', 'yt:dQw4w9WgXcQ',
    -- 'ig:C1a2b3', 'fb:9876543210', or 'url:host/path' for anything else.
    post_key    text        not null unique,
    post_url    text        not null,

    -- Where the post came FROM. Where it goes is always X, for now.
    source      text        not null default 'Web'
                            check (source in ('X', 'Bluesky', 'Facebook', 'Instagram', 'YouTube',
                                              'Threads', 'TikTok', 'Reddit', 'Web')),

    author      text        not null default '',

    -- The post's own words: its title, or the text that was selected when the funny
    -- button was pressed. Not ours - see `why` for that.
    headline    text        not null default '',
    posted_at   text        not null default '',
    why         text        not null default '',

    -- Who put it here: 'Bot' for the routine, or the signed-in email address of the
    -- person who filed it. How they filed it is not recorded and never mattered.
    submitter   text        not null default 'Bot'
                            check (submitter = 'Bot' or submitter like '_%@_%._%'),

    status      text        not null default 'NEW'
                            check (status in ('NEW', 'SKIPPED', 'POSTED')),

    -- What the bot should make of a pass. The exact URL is blocked for every row by the
    -- unique index on post_key, whatever this says; this only leans the bot toward or
    -- away from things of the same kind. '' where nothing has been passed.
    bot_hint    text        not null default ''
                            check (bot_hint in ('', 'LIKE', 'HIDE')),

    repost_text text        not null default '',

    -- Where it has actually gone out. status says whether the article is still
    -- waiting; this says which destinations already have it.
    posted_to   text[]      not null default '{}',

    -- The post's own image, from its og:image tag: the bookmarklet reads it off the
    -- page it was pressed on, and the bot reads it when it confirms the permalink.
    -- Empty means no picture was found, not that there is none.
    media_url   text        not null default '',

    -- Did the source carry an image or video? Instagram will not take a text-only
    -- post, so the page greys its button out when this is false. NULL = never checked.
    has_media   boolean,

    handled_at  timestamptz,
    created_at  timestamptz not null default now()
);

-- The queue is read newest first and filtered by status on every load.
create index if not exists socializer_status_created_idx
    on public.socializer (status, created_at desc);

alter table public.socializer enable row level security;

drop policy if exists "read the queue"    on public.socializer;
drop policy if exists "add to the queue"  on public.socializer;
drop policy if exists "rule on the queue" on public.socializer;

create policy "read the queue"
    on public.socializer for select to anon
    using (true);

create policy "add to the queue"
    on public.socializer for insert to anon
    with check (true);

create policy "rule on the queue"
    on public.socializer for update to anon
    using (true)
    with check (true);
