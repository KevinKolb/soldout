-- How each platform gets posted to, chosen per platform on the SETTINGS tab.
--
-- Until now there was one way out of the queue: open the platform's composer in a tab with
-- our words already in it, and press their Post button by hand. That is INTENT below, and
-- it is the only route some platforms will ever offer.
--
-- API is us publishing outright, from supabase/functions/soc-publish. It is the one that
-- makes this an app rather than a set of bookmarks, and it is not available everywhere:
-- Facebook will publish as a Page but never as a person, Instagram refuses a post with no
-- picture, X wants a paid tier. So the choice is per platform and it is a choice - INTENT
-- stays correct, and stays the default, because it needs no credentials and cannot fail in
-- a way that leaves you wondering whether something went out.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.socializer_channel (
    platform   text primary key
               check (platform in ('X', 'Bluesky', 'Threads', 'Facebook',
                                   'Reddit', 'Instagram', 'TikTok')),

    -- INTENT: open their composer, press their button. API: soc-publish does it.
    method     text        not null default 'INTENT'
               check (method in ('INTENT', 'API')),

    updated_at timestamptz not null default now()
);

-- Every platform the POST tab can offer a button for, all starting where they are today.
-- A platform missing from this table reads as INTENT anyway, so this is a convenience for
-- the settings page rather than something the queue depends on.
insert into public.socializer_channel (platform)
values ('X'), ('Bluesky'), ('Threads'), ('Facebook'), ('Reddit'), ('Instagram'), ('TikTok')
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
