-- Somewhere to put a row you want gone from the page but not gone from the table.
--
-- WHY A COLUMN AND NOT A DELETE. This table has never had a delete policy and should not
-- get one: "a candidate is ruled on by moving it, never by removing the evidence." So
-- DELETE on a card sets this instead. The page filters hidden rows out of every tab and
-- every count; the row itself stays where it is.
--
--   hidden = false   the normal state. Nothing to see here.
--   hidden = true    gone from the page, and gone as far as the bot is concerned.
--
-- REVISED, and worth reading if you are looking at a hidden row wondering what happened
-- to its key. This column first shipped meaning "gone, but still deduping" - the row kept
-- its post_key so the bot could never nominate that post again. That was the wrong call.
-- Skipping something is a judgement worth remembering; deleting it is "get this off my
-- screen", and it should not quietly bar the post for good. So the page now stands the
-- key down at the same time, rewriting it to 'gone:<id>:<the old key>'. The original is
-- still legible inside it, and the post is free to be found again.
--
-- Nothing in the page unsets any of this. That is deliberate: deleting is meant to be the
-- end of a thing. If you need one back, it is one update in this editor.
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
