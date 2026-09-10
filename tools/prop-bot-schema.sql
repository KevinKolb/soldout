-- What the SOC PROP BOT finds. Run this once in the Supabase SQL editor.
--
-- WHY THIS IS NOT THE shop TABLE
--
-- Two reasons, and both matter.
--
-- The shop table is owner-write-only: a bot has no login, and the alternative is
-- handing it a key that can write to the live shop, which is the thing the whole
-- auth setup exists to avoid. This table takes anon inserts the way the socializer
-- queue does, for the same reason - a person reads every row before anything
-- reaches an audience.
--
-- And a found listing is not a shop item yet. Only what sits on our eBay influencer
-- storefront gets a title, a price, a photo and a commission link at build time; a
-- random eBay URL published straight to the shop would be a card with no picture, no
-- price, and no money in it. So the bot's job ends at "look at this", and a human
-- decides whether to put it on the storefront, which is what actually makes it real.

create table if not exists public.prop_candidates (
    id          bigint generated always as identity primary key,

    -- eBay item id where there is one, else url:<host><path>. Unique, so a re-run
    -- cannot nominate the same listing twice or argue with a rejection.
    item_key    text        not null unique,
    item_url    text        not null,

    title       text        not null default '',
    price       numeric(10,2),
    image_url   text        not null default '',

    -- One sentence from the bot: why this is worth a look.
    why         text        not null default '',

    -- KEPT is the only status that means anything downstream: it says a person
    -- decided to put the listing on the storefront. Nothing here reaches the shop
    -- on its own.
    status      text        not null default 'NEW'
                            check (status in ('NEW', 'SKIPPED', 'KEPT')),

    found_at    timestamptz not null default now(),
    handled_at  timestamptz
);

create index if not exists prop_candidates_status_found_idx
    on public.prop_candidates (status, found_at desc);

alter table public.prop_candidates enable row level security;

drop policy if exists "read the candidates"   on public.prop_candidates;
drop policy if exists "add a candidate"       on public.prop_candidates;
drop policy if exists "rule on a candidate"   on public.prop_candidates;

-- Read and insert are open, like the socializer queue: the bot has no login, and the
-- rows are nominations rather than anything an audience sees.
create policy "read the candidates"
    on public.prop_candidates for select to anon, authenticated
    using (true);

create policy "add a candidate"
    on public.prop_candidates for insert to anon
    with check (true);

-- Ruling on one is the owner's, since it is a decision rather than a suggestion.
create policy "rule on a candidate"
    on public.prop_candidates for update to authenticated
    using (public.is_shop_owner())
    with check (public.is_shop_owner());

comment on table public.prop_candidates is
    'Listings the SOC PROP BOT found. Nominations only - nothing here reaches the shop by itself.';
