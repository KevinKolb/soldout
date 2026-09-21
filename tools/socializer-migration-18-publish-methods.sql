-- How each platform gets posted to, chosen per platform on the SETTINGS tab.
--
-- There are three ways out of the queue, and the SETTINGS tab picks one per platform:
--
--   INTENT  open the platform's composer with our words already in the URL, and press
--           their Post button. Free, needs no credentials, cannot half-work.
--   PASTE   put our words on the clipboard, open the destination, paste them in. This is
--           the only manual route where a composer URL will not carry text - Facebook
--           ignores the quote= parameter it used to honour - and the only one at all for a
--           platform with no composer URL, like Instagram.
--   API     supabase/functions/soc-publish publishes it outright. Needs a credential per
--           platform, and is not available everywhere: Facebook publishes as a Page but
--           never as a person, Instagram refuses a post with no picture, X wants a paid
--           tier.
--
-- Which of the three each platform can actually carry out is declared in the page, in
-- PUBLISH. This table holds only the choice, so a platform that stops offering a method
-- falls back to one it does rather than stranding a card behind a dead button.
--
-- Run once in the Supabase SQL editor. Safe to run again: the constraint is dropped and
-- re-added rather than declared inline, so an earlier run that only knew INTENT and API
-- gets PASTE from a second one.

create table if not exists public.socializer_channel (
    platform   text primary key
               check (platform in ('X', 'Bluesky', 'Threads', 'Facebook',
                                   'Reddit', 'Instagram', 'TikTok')),
    method     text        not null default 'INTENT',
    updated_at timestamptz not null default now()
);

-- Out here rather than inline, so re-running this file widens it. `create table if not
-- exists` would skip a changed inline check silently and leave the page unable to save a
-- method the table has never heard of.
alter table public.socializer_channel
    drop constraint if exists socializer_channel_method_check;

alter table public.socializer_channel
    add constraint socializer_channel_method_check
    check (method in ('INTENT', 'PASTE', 'API'));

-- Every platform the POST tab can offer a button for, each starting on the method it
-- already behaved as. Facebook starts on PASTE because INTENT was never a real option
-- there - its composer drops our words, which is the reason PASTE exists.
--
-- do nothing on conflict: a choice already made is not this file's to overwrite. A platform
-- missing from the table falls back to its first method in PUBLISH anyway, so this is a
-- convenience for the settings page rather than something the queue depends on.
insert into public.socializer_channel (platform, method)
values ('X', 'INTENT'), ('Bluesky', 'INTENT'), ('Threads', 'INTENT'),
       ('Facebook', 'PASTE'), ('Reddit', 'INTENT'),
       ('Instagram', 'PASTE'), ('TikTok', 'PASTE')
on conflict (platform) do nothing;

alter table public.socializer_channel enable row level security;

-- The same rule as the queue itself (socializer-migration-04-auth.sql): owner only, reads
-- included. Nothing public renders this, and what it holds is a map of which accounts we
-- can publish to without a human - not something to hand a stranger.
drop policy if exists "owner reads the channels" on public.socializer_channel;
drop policy if exists "owner sets the channels"  on public.socializer_channel;

create policy "owner reads the channels"
    on public.socializer_channel for select to authenticated
    using (public.is_soc_owner());

create policy "owner sets the channels"
    on public.socializer_channel for update to authenticated
    using (public.is_soc_owner())
    with check (public.is_soc_owner());

-- No insert and no delete policy. The platform list is this migration's business, not the
-- browser's: a row that appears from a page would be a platform nothing knows how to post
-- to, and a row that disappears would silently turn a channel back to INTENT.


-- What the API route actually published, per platform: Facebook's post id, Bluesky's at://
-- uri, whatever the next one hands back. posted_to already says a destination has had it;
-- this is the receipt, so an archived card can point at the thing that went out instead of
-- only claiming it did. INTENT posts leave no receipt and never will - nobody hands a
-- number back when you press Post in their own tab.
alter table public.socializer
    add column if not exists posted_ref jsonb not null default '{}'::jsonb;

comment on column public.socializer.posted_ref is
    'platform -> id or uri of the post the API created there. Empty for anything posted by hand.';
