-- The bot stops being told which way to lean, and just gets the good ones.
--
-- WHAT WENT. Every skipped card carried a LIKE / HIDE toggle saying what the bot should
-- make of that kind of thing, and soc_taste handed back a verdict per row so the bot
-- could weigh them. The toggle is gone from the page and the verdict is gone from here.
--
-- WHY. It was asking a question nobody needed to answer. Skipping something is almost
-- never "never show me this again" - it is "good, not this week", which is exactly the
-- kind of thing we want more of. So a skip is inspiration, full stop, and the one time
-- you really do mean never is DELETE, which hides the row and takes it out of this
-- function's reach. The setting and the delete button were two ways to say one thing,
-- and the setting was the one nobody was going to remember to use.
--
-- WHAT THE BOT SEES NOW. Every row a human ruled on and did not delete: posted, queued
-- to post, or skipped. All of it a yes about the kind of thing it is, nothing to weigh.
--
-- bot_hint stays on the table. It is written by nothing and read by nothing now, and
-- dropping a column is the one change here that could not be undone by editing a file.
--
-- Run once in the Supabase SQL editor.

drop function if exists public.soc_taste();

create or replace function public.soc_taste()
returns table (why text, source text, post_url text)
language sql
security definer
set search_path = public
as $$
    select why, source, post_url
    from public.socializer
    where not hidden
      and status in ('POSTED', 'POST', 'SKIPPED')
    order by created_at desc
    limit 80;
$$;

revoke all on function public.soc_taste() from public;
grant execute on function public.soc_taste() to anon, authenticated;
