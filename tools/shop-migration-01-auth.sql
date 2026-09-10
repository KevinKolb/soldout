-- Migration 01: the shop becomes editable by its owner.
--
-- Run this once in the Supabase SQL editor. Safe to run twice.
--
-- Until now the table was read-only from outside: anon could select, nobody could
-- write, and every change went through the dashboard. This binds write access to a
-- single email address so the Prop Shop page itself can be edited in place by whoever
-- proves they are that person through Google sign-in.
--
-- WHY THE SELECT POLICY IS REPLACED TOO, which is not optional:
-- anon and authenticated are different Postgres roles, and a policy granted "to anon"
-- does not apply to a signed-in user. Left alone, signing in would make the shop go
-- empty - the one bug guaranteed to look like the login broke everything.
--
-- The owner check reads the email claim out of the JWT rather than pinning a user id,
-- so it keeps working if the Google account is ever disconnected and reconnected.
-- auth.jwt() is null for anon, so anon still gets select and nothing else.

create or replace function public.is_shop_owner()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') = 'kevinmkolb@gmail.com'
$$;

comment on function public.is_shop_owner() is
    'True when the caller is signed in as the shop owner. Used by the shop write policies.';

-- Read stays public, but now covers signed-in callers as well.
drop policy if exists "read the shop" on public.shop;

create policy "read the shop"
    on public.shop for select to anon, authenticated
    using (true);

drop policy if exists "owner adds props"    on public.shop;
drop policy if exists "owner edits props"   on public.shop;
drop policy if exists "owner removes props" on public.shop;

create policy "owner adds props"
    on public.shop for insert to authenticated
    with check (public.is_shop_owner());

create policy "owner edits props"
    on public.shop for update to authenticated
    using (public.is_shop_owner())
    with check (public.is_shop_owner());

create policy "owner removes props"
    on public.shop for delete to authenticated
    using (public.is_shop_owner());

-- After running this, in the Supabase dashboard:
--
--   1. Authentication > Providers > Google: enable it, and paste in a Google OAuth
--      client id and secret from console.cloud.google.com (Credentials > Create
--      credentials > OAuth client ID > Web application).
--   2. In that Google client, add the authorised redirect URI Supabase shows you:
--      https://tjteeqofqozmncfoiofy.supabase.co/auth/v1/callback
--   3. Authentication > URL Configuration: set Site URL to
--      https://www.soldoutcomedy.com and add these to Redirect URLs:
--        https://www.soldoutcomedy.com/backstage/
--        https://www.soldoutcomedy.com/shop/
--        http://localhost:8080/backstage/
--        http://localhost:8080/shop/
--
-- Nothing signs in until step 1 is done; the page will say so rather than hang.
--
-- On the Google side the consent screen can stay in Testing with the owner added
-- under Test users - it does not need publishing to work. The only cost is that
-- Google expires refresh tokens for unpublished apps after 7 days, so signing in
-- comes round again about weekly. Publishing removes that and needs no review,
-- since email and profile are not sensitive scopes, but the Publish button stays
-- greyed out until the Branding section is complete: an app home page and an
-- authorised domain of soldoutcomedy.com are the fields usually missing.
