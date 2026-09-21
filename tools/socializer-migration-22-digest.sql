-- What the run-end email needs to read, and a brake so it cannot be used to flood an inbox.
--
-- The bot has no session and no password - it holds the committed publishable key, which is the
-- `anon` role, which no policy on the queue names. So the digest function reads through
-- soc_pending below, in the same shape as soc_taste and soc_nominate: a security-definer
-- function, granted to anon, returning exactly what the email prints and nothing else.
--
-- WHAT THIS DISCLOSES. soc_pending hands unread candidates to anyone holding the publishable
-- key: the link, the post's own words, our caption, the handle. That is the same class of thing
-- soc_taste has always given out about the ones we kept, and none of it is private - every row
-- is a public post somebody else made, plus a line we wrote about it. Nothing here exposes the
-- rulings, the credentials or the ability to change anything.
--
-- WHY THE BRAKE. soc-digest has to be callable by the bot, and the bot cannot prove who it is,
-- so anybody who reads this repo could call it too. It only ever sends to the owner's own
-- address - never one from the request - so the worst that can be done with it is a duplicate
-- email, and soc_digest_claim limits even that. One UPDATE does the check and the stamp together,
-- so two callers at once cannot both win.
--
-- Run once in the Supabase SQL editor.

create or replace function public.soc_pending()
returns table (
    id        bigint,
    post_url  text,
    headline  text,
    why       text,
    author    text,
    source    text,
    media_url text,
    filed     timestamptz
)
language sql
security definer
set search_path = public
as $$
    select s.id, s.post_url, s.headline, s.why, s.author, s.source, s.media_url, s.created_at
    from public.socializer s
    where not s.hidden
      and s.status = 'NEW'
    order by s.created_at desc
    limit 25;
$$;

revoke all on function public.soc_pending() from public;
grant execute on function public.soc_pending() to anon, authenticated;


-- One row, holding when the digest last went out.
create table if not exists public.socializer_digest (
    id      smallint primary key default 1 check (id = 1),
    sent_at timestamptz
);

insert into public.socializer_digest (id) values (1) on conflict (id) do nothing;

alter table public.socializer_digest enable row level security;

-- No policies at all, for either role. Nothing reaches this table except the definer function
-- below, which is the only thing that has any business with it.
revoke all on public.socializer_digest from anon, authenticated;

-- True if the caller may send now, and if so the clock is reset in the same statement. False
-- means too soon, and the caller sends nothing.
create or replace function public.soc_digest_claim(p_gap_minutes int default 20)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    won boolean;
begin
    update public.socializer_digest
    set sent_at = now()
    where id = 1
      and (sent_at is null or sent_at < now() - make_interval(mins => greatest(p_gap_minutes, 1)))
    returning true into won;

    return coalesce(won, false);
end;
$$;

revoke all on function public.soc_digest_claim(int) from public;
grant execute on function public.soc_digest_claim(int) to anon, authenticated;


-- VERIFY, after running. soc_pending should answer with JSON; the first claim should be true and
-- the second false, which is the brake working.
--
--   K=sb_publishable_AHzqW00erP1wModfz3mzVA_dxM6RtPr
--   U=https://tjteeqofqozmncfoiofy.supabase.co/rest/v1/rpc
--   curl -s -X POST "$U/soc_pending" -H "apikey: $K" -H "Content-Type: application/json" | head -c 300; echo
--   curl -s -X POST "$U/soc_digest_claim" -H "apikey: $K" -H "Content-Type: application/json" -d '{"p_gap_minutes":20}'; echo
--   curl -s -X POST "$U/soc_digest_claim" -H "apikey: $K" -H "Content-Type: application/json" -d '{"p_gap_minutes":20}'; echo
