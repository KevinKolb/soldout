-- A fifth status: POST.
--
-- The queue used to have one decision in it. A candidate arrived NEW, and the same press
-- that sent it somewhere marked it POSTED - so choosing a thing and posting a thing were
-- the same act, done in the same moment, on the same card.
--
-- They are two acts now, and the tabs are the shape of it:
--
--   NEW      CANDIDATES. Worth it or not? Skip it, or send it on.
--   POST     POST. Chosen, not yet out. This is where the destination buttons live.
--   POSTED   ARCHIVE. Gone out, somewhere, and done with.
--   SKIPPED  SKIP. Not this one - with LIKE or HIDE saying what the bot makes of it.
--
-- Deciding at a glance and posting with attention are different jobs done at different
-- times, and a queue that made you do both at once made you do neither properly.
--
-- Run once in the Supabase SQL editor.

alter table public.socializer
    drop constraint if exists socializer_status_check;

alter table public.socializer
    add constraint socializer_status_check
    check (status in ('NEW', 'POST', 'POSTED', 'SKIPPED'));

-- soc_taste learns the new one. A row sitting in POST has been picked by a human and is
-- only waiting for a spare minute, which is the same yes as one already out - so the bot
-- hears about it now rather than whenever somebody gets round to sending it.

create or replace function public.soc_taste()
returns table (verdict text, why text, source text, post_url text)
language sql
security definer
set search_path = public
as $$
    select
        case when bot_hint = 'HIDE' then 'HIDE' else 'LIKE' end,
        why, source, post_url
    from public.socializer
    where status in ('POSTED', 'POST')
       or (status = 'SKIPPED' and bot_hint <> '')
    order by created_at desc
    limit 80;
$$;

revoke all on function public.soc_taste() from public;
grant execute on function public.soc_taste() to anon, authenticated;
