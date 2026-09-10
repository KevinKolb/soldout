-- The shop's curated list: which items appear on /shop and how they are tagged.
--
-- Run this once in the Supabase SQL editor for the SOLD OUT! project.
-- It replaces the Ambassador table in Airtable. tools/build-inventory.py reads it
-- at deploy time with the project's publishable key.
--
-- A NOTE ON THE POLICIES, because they are deliberately narrower than
-- tools/socializer-schema.sql:
--
-- The socializer queue lets the anon role insert and update, because that queue is
-- reviewed by a person before anything leaves the building. This table is not. A row
-- here becomes a link on a public page that we are asking an audience to click, so an
-- anon insert policy would let anyone who finds the publishable key put an arbitrary
-- URL on the shop under our name. Read is public because the build needs it and the
-- rows are public anyway. Writes arrive later, in tools/shop-migration-01-auth.sql,
-- bound to a signed-in owner rather than to a key.

create table if not exists public.shop (
    id            bigint generated always as identity primary key,

    -- Where a buyer lands. The one thing a row cannot do without.
    item_url      text        not null unique,

    -- How the listing is classified. Each ships as an element of the same name in
    -- assets/data/inventory.xml and is read by shop/index.html.
    tag_source    text        not null default 'eBay',        -- the marketplace, on the photo sticker
    tag_type      text        not null default 'Commission',  -- how we get paid: Commission | Owned
    tag_location  text        not null default 'External',    -- whose stock: External | First-party

    -- Groups items into the tabs across the top of the shop. Never printed on a
    -- card: it is a grouping key, not a label. '' means the item only shows under
    -- the E'RYTHING tab.
    tab_tag       text        not null default '',

    -- Our own caption. When set it replaces the marketplace's title on the card,
    -- which is usually keyword soup written for a search engine rather than a reader.
    blurb         text        not null default '',

    -- Overrides. Leave these empty for an eBay row and the build fills them from the
    -- influencer storefront at deploy time, which is the only way to keep the price
    -- and the remaining count current. Anything set here wins over what eBay says,
    -- permanently. A row from any other source has nothing to enrich it, so it must
    -- carry its own title, price and image or its card publishes blank.
    title         text        not null default '',
    price         numeric(10,2),
    condition     text        not null default '',
    image_url     text        not null default '',

    -- Hidden by default: a prop has no title, price or photo until a build reads them
    -- from the storefront, so nothing should reach a visitor before somebody has looked
    -- at it and pressed ACTIVE.
    status        text        not null default 'Hidden'
                              check (status in ('Active', 'Sold', 'Hidden')),

    -- Hand ordering. The grid sorts by price in the browser, so this only decides
    -- the order rows reach the XML, which is what a price tie falls back on.
    position      int         not null default 0,

    created_at    timestamptz not null default now()
);

create index if not exists shop_status_position_idx
    on public.shop (status, position, created_at);

alter table public.shop enable row level security;

drop policy if exists "read the shop" on public.shop;

-- anon and authenticated are different roles, so a signed-in owner needs naming here
-- too or the shop reads empty the moment anyone logs in.
create policy "read the shop"
    on public.shop for select to anon, authenticated
    using (true);

comment on table public.shop is
    'Curated shop listings. Read by tools/build-inventory.py into assets/data/inventory.xml.';
comment on column public.shop.tab_tag is
    'Tab grouping key for the shop page. Never displayed on the item itself.';
comment on column public.shop.blurb is
    'Our own caption. Replaces the marketplace title on the card when set.';

-- ---------------------------------------------------------------------------
-- Seed
--
-- The two listings already on the shop, so running this leaves /shop exactly as
-- it looks today rather than empty, plus the tab tag for the wipes. Safe to run
-- twice: item_url is unique and a repeat does nothing.
--
-- Store the clean /itm/ URL. The build rebuilds the eBay Partner Network
-- tracking from the item id at deploy time, so tracking params here are ignored.

insert into public.shop (item_url, tag_source, tab_tag, position)
values
    ('https://www.ebay.com/itm/336676054781', 'eBay', '',              10),
    ('https://www.ebay.com/itm/800501436417', 'eBay', 'PUMPKIN SPICE', 20)
on conflict (item_url) do nothing;

-- The J. Peterman catalog. NOTE: at the time of writing this listing was not on
-- the influencer storefront, and only storefront items get enriched. Add it there
-- and this row fills itself in; leave it off and the card publishes with no title,
-- price or photo until title/price/image_url are set here by hand.

insert into public.shop (item_url, tag_source, tab_tag, position)
values ('https://www.ebay.com/itm/188661521338', 'eBay', 'INSPIRED BY SEINFELD', 30)
on conflict (item_url) do nothing;

-- The mini 49ers helmet.

insert into public.shop (item_url, tag_source, tab_tag, position)
values ('https://www.ebay.com/itm/298366062400', 'eBay', 'REAL NFL PLAYERS ONLY', 40)
on conflict (item_url) do nothing;
