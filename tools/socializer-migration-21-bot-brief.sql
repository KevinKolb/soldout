-- What the bot is allowed to know before it goes looking.
--
-- The bot reads the queue through soc_taste and nothing else, and that function was handing it
-- three columns: our caption, the platform, and the link. Two things were wrong with that.
--
-- FIRST, it was told to learn "which sources keep earning their place" from a column that holds
-- the PLATFORM. `source` is 'Instagram' or 'X'. The account is in `author`, which it never saw -
-- so the most useful thing on the table, the handful of people who reliably make what we want,
-- was the one thing it could not learn. soc_sources below is that list, counted rather than
-- guessed, so the hand-written source list in tools/socializer-bot.md can grow by itself.
--
-- SECOND, it saw our captions without the posts they were written about. It could learn the
-- voice and not the subject, and was left inferring what kind of thing we like backwards from
-- our own jokes about them. soc_taste now hands over the headline and whether there was a
-- picture, which is what the row is actually evidence of.
--
-- Deliberately still no negative signal. Everything here counts a yes, exactly as
-- socializer-migration-17-no-hints.sql settled: a skip is "good, not this week", and the one
-- time somebody means never is DELETE, which sets `hidden` and takes the row out of reach of
-- every function below. Nothing here lets the bot weigh one kind of yes against another,
-- because why we did not run a post we liked is usually timing and says nothing about the post.
--
-- soc_brief is new and is about restraint rather than taste: it says how many candidates are
-- already waiting to be read. Twelve more on top of forty unread is not a better run, it is a
-- longer scroll, so the bot sizes its own haul from this.
--
-- The author handles these return are already implied by the post_url the old function handed
-- out, so nothing becomes visible that was not. Run once in the Supabase SQL editor.

-- Same name, replaced in place; the return type grows, so drop first.
drop function if exists public.soc_taste();

create or replace function public.soc_taste()
returns table (
    why       text,   -- our caption, which is the voice
    headline   text,  -- the post's own words, which is the subject
    author     text,  -- who made it, which is the source worth going back to
    source     text,  -- the platform it was on
    has_media  boolean,
    post_url   text
)
language sql
security definer
set search_path = public
as $$
    -- Qualified through an alias throughout. Each output column above is named after the table
    -- column it carries, and in a SQL-language function those output names are parameters in
    -- scope over this query - so a bare `has_media` is a question about resolution order that
    -- nobody should have to answer. `s.` answers it.
    select s.why, s.headline, s.author, s.source, coalesce(s.has_media, false), s.post_url
    from public.socializer s
    where not s.hidden
      and s.status in ('POSTED', 'POST', 'SKIPPED')
    order by s.created_at desc
    limit 80;
$$;

revoke all on function public.soc_taste() from public;
grant execute on function public.soc_taste() to anon, authenticated;


-- The accounts that have earned a look, counted from what survived a human reading it. This is
-- the hand-written source list's other half: that one is where taste is declared, this one is
-- where it is observed.
--
-- `kept` is how many of their posts are on the table and not deleted. One is not a pattern, so
-- the bot is told in its own orders to treat a single hit as a maybe rather than a source.
create or replace function public.soc_sources()
returns table (author text, source text, kept bigint, newest timestamptz)
language sql
security definer
set search_path = public
as $$
    select s.author, min(s.source), count(*), max(s.created_at)
    from public.socializer s
    where not s.hidden
      and s.status in ('POSTED', 'POST', 'SKIPPED')
      and s.author <> ''
    group by s.author
    order by count(*) desc, max(s.created_at) desc
    limit 25;
$$;

revoke all on function public.soc_sources() from public;
grant execute on function public.soc_sources() to anon, authenticated;


-- How much is already waiting. Not taste - load. A run that adds nothing because there are
-- thirty unread candidates is a good run, and this is the only way the bot can know that.
create or replace function public.soc_brief()
returns table (waiting bigint, ready bigint, newest timestamptz)
language sql
security definer
set search_path = public
as $$
    select
        count(*) filter (where s.status = 'NEW'),
        count(*) filter (where s.status = 'POST'),
        max(s.created_at) filter (where s.status = 'NEW')
    from public.socializer s
    where not s.hidden;
$$;

revoke all on function public.soc_brief() from public;
grant execute on function public.soc_brief() to anon, authenticated;


-- VERIFY IT, straight after running this. soc_taste is replaced in place and the bot's whole
-- reading half depends on it, so a mistake here is a bot that silently loses its taste. Run this
-- in Git Bash; each function should answer with JSON rather than an error. The key is the
-- committed publishable one, which is all the bot ever uses.
--
--   K=sb_publishable_AHzqW00erP1wModfz3mzVA_dxM6RtPr
--   U=https://tjteeqofqozmncfoiofy.supabase.co/rest/v1/rpc
--   for f in soc_taste soc_sources soc_brief; do echo "-- $f"; curl -s -X POST "$U/$f" -H "apikey: $K" -H "Content-Type: application/json" | head -c 300; echo; done
