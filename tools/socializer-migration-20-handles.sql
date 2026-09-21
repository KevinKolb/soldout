-- The account name for each platform, so the settings page works out the address instead of
-- holding a copy of it.
--
-- Every tile on the SETTINGS tab used to carry its profile URL twice as literal text: once in
-- the View link and once in a box to copy out of, with the handle written a third time above
-- them. Three copies of one fact, and they had already drifted - the Bluesky tile said
-- SOLDOUTcomedy above a link to soldoutcomedy.bsky.social, and YouTube's handle and its URL
-- disagreed about capitals. Now the handle is the fact and the address is computed from it, by
-- a template per platform in PUBLISH in socializer/index.html.
--
-- Run once in the Supabase SQL editor, after migration 19.

-- The table was made for platforms the POST tab can post to. A handle is wanted for every
-- account on the settings page, including the three that are only ever visited by hand, so the
-- list widens to match the tiles.
alter table public.socializer_channel
    drop constraint if exists socializer_channel_platform_check;

alter table public.socializer_channel
    add constraint socializer_channel_platform_check
    check (platform in ('X', 'Bluesky', 'Threads', 'Facebook', 'Reddit', 'Instagram',
                        'TikTok', 'YouTube', 'Whatnot', 'Poshmark'));

alter table public.socializer_channel
    add column if not exists handle text not null default '';

comment on column public.socializer_channel.handle is
    'The account name on that platform. The profile URL is computed from it, never stored.';

-- The three visit-only accounts, added now that the constraint allows them. Not enabled: there
-- is no way to post to any of them from the queue, and a checkbox promising otherwise would be
-- a lie the page tells.
insert into public.socializer_channel (platform, method, enabled)
values ('YouTube', 'INTENT', false), ('Whatnot', 'INTENT', false), ('Poshmark', 'INTENT', false)
on conflict (platform) do nothing;

-- Seeded from what each tile's LINK said rather than from the handle printed above it, because
-- the link is the half that was demonstrably working. Bluesky's is the full handle its profile
-- address needs; YouTube and Reddit keep their capitals.
--
-- Only where the column is still empty, so re-running this cannot undo a correction made on the
-- page afterwards.
update public.socializer_channel as c
set handle = v.handle
from (values
    ('Facebook',  'soldoutcomedy'),
    ('Instagram', 'soldout.comedy'),
    ('Threads',   'soldout.comedy'),
    ('X',         'soldoutcomedy'),
    ('Bluesky',   'soldoutcomedy.bsky.social'),
    ('TikTok',    'soldoutcomedy'),
    ('YouTube',   'SOLDOUTComedy'),
    ('Reddit',    'SOLDOUTComedy'),
    ('Whatnot',   'soldoutcomedy'),
    ('Poshmark',  'soldoutcomedy')
) as v(platform, handle)
where c.platform = v.platform and c.handle = '';
