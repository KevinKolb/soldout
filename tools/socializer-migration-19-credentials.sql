-- The rest of what the SETTINGS tab remembers: which platforms we post to at all, and each
-- one's publishing credential - entered on the page once and kept, instead of being set from a
-- terminal with `supabase secrets set`.
--
-- WHAT IS ACTUALLY IN HERE
-- `secret` is ciphertext, not a token. The page posts the token to the soc-connect function,
-- which seals it with AES-256-GCM under SOC_SECRET_KEY - a function secret - and writes the
-- result. Nothing that can read this table can read the credential: not the page, not the
-- publishable key, not a stranger who finds either, and not a future read-only role.
--
-- That is also why this project still has no service-role key and still must not. The usual
-- shape for storing tokens is a function holding a service key to read them back, and that key
-- bypasses row-level security for everything. Sealing the value instead means the ordinary
-- owner-only policies below are enough. See supabase/functions/_shared/secretbox.ts.
--
-- The protection is the sealing, not a hidden column. The ciphertext is deliberately readable
-- by the owner, because soc-publish reads it with the CALLER's own session - it has no
-- service-role key to read it with - so a column the page cannot see is a column the publisher
-- cannot see either. Handing out ciphertext costs nothing: without SOC_SECRET_KEY it is noise,
-- and anyone holding an owner session could ask soc-publish to post regardless.
--
-- Everything else in here is plainly not a secret, and is what the settings page shows: which
-- account the credential belongs to, when it was saved, and when it runs out.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.socializer_secret (
    platform   text primary key
               check (platform in ('X', 'Bluesky', 'Threads', 'Facebook',
                                   'Reddit', 'Instagram', 'TikTok')),

    -- AES-256-GCM, nonce first, base64. Useless without SOC_SECRET_KEY.
    secret     text        not null,

    -- The non-secret half of a credential: the Threads user id, the Facebook Page id, the
    -- Bluesky handle. Shown on the settings page so you can see WHICH account is connected,
    -- which is the question you actually have when something posts to the wrong place.
    account    text        not null default '',

    -- Threads hands out tokens that die after 60 days. Null for the ones that do not expire,
    -- like a Bluesky app password or a Facebook System User token.
    expires_at timestamptz,

    updated_at timestamptz not null default now(),
    set_by     text        not null default ''
);

alter table public.socializer_secret enable row level security;

drop policy if exists "owner reads credential status" on public.socializer_secret;
drop policy if exists "owner adds a credential"       on public.socializer_secret;
drop policy if exists "owner replaces a credential"   on public.socializer_secret;
drop policy if exists "owner clears a credential"     on public.socializer_secret;

create policy "owner reads credential status"
    on public.socializer_secret for select to authenticated
    using (public.is_soc_owner());

create policy "owner adds a credential"
    on public.socializer_secret for insert to authenticated
    with check (public.is_soc_owner());

create policy "owner replaces a credential"
    on public.socializer_secret for update to authenticated
    using (public.is_soc_owner())
    with check (public.is_soc_owner());

-- Delete IS allowed here, unlike on the queue. A credential is not a record of anything: the
-- point of Disconnect is that the token stops existing, and moving it to a "disconnected"
-- status would leave it sitting in the table still able to post.
create policy "owner clears a credential"
    on public.socializer_secret for delete to authenticated
    using (public.is_soc_owner());

-- Signed out, this table does not exist. `anon` and `authenticated` are different roles and a
-- policy naming one does not cover the other, so the absence of an anon policy above is already
-- the answer - this only makes it true at the privilege level as well, one layer lower down.
revoke all on public.socializer_secret from anon;


-- Which platforms are in play. The POST tab offers a button for a platform only when this is
-- true, so the column is what turns a card from a wall of destinations into the three you
-- actually use. `method` says HOW a platform is posted to; this says WHETHER.
--
-- Default true, and seeded true, because that is what the page did before this column existed:
-- every platform with a composer got a button. Nothing disappears on the day this runs - the
-- curating is yours to do, by unchecking.
alter table public.socializer_channel
    add column if not exists enabled boolean not null default true;

comment on column public.socializer_channel.enabled is
    'Does the POST tab offer a button for this platform at all. Set by the checkbox on SETTINGS.';


-- Threads is the third platform soc-publish can publish to, alongside Bluesky and the Facebook
-- Page. It was already in the channel table from migration 18, and `method` already accepts
-- API for every platform, so there is nothing to alter for it. Recorded here so the history
-- says when Threads became publishable rather than leaving that to the page.
