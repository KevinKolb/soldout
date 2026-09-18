-- Somewhere to put a row you want gone from the page but not gone from the table.
--
-- WHY A COLUMN AND NOT A DELETE. This table has never had a delete policy and should not
-- get one: "a candidate is ruled on by moving it, never by removing the evidence." There
-- is a second, harder reason now. post_key is the only thing stopping the bot nominating
-- something you have already seen, and it only works while the row exists. Delete the row
-- and the post comes back a week later as a fresh find.
--
-- So DELETE on an archived card sets this instead. The page filters hidden rows out of
-- every tab and every count; the row itself stays where it is, holding its key.
--
--   hidden = false   the normal state. Nothing to see here.
--   hidden = true    gone from the page. Still deduping, still unrepostable by accident.
--
-- Nothing in the page unsets it. That is deliberate: hiding is meant to be the end of a
-- thing. If you need one back, it is one update in this editor.
--
-- Run once in the Supabase SQL editor.

alter table public.socializer
    add column if not exists hidden boolean not null default false;

-- Reading the queue filters on status already; hidden rows are a small tail on the end
-- of it, so the index carries them too rather than making the planner check each row.
drop index if exists socializer_status_created_idx;
create index if not exists socializer_status_created_idx
    on public.socializer (hidden, status, created_at desc);

-- A hidden row stops teaching the bot as well. Deleting something is a plainer statement
-- than posting it ever was, and a queue that keeps quoting a thing back at the bot after
-- you have thrown it away is arguing with you.

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
    where not hidden
      and (status in ('POSTED', 'POST')
           or (status = 'SKIPPED' and bot_hint <> ''))
    order by created_at desc
    limit 80;
$$;

revoke all on function public.soc_taste() from public;
grant execute on function public.soc_taste() to anon, authenticated;
