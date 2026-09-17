-- Two verdicts, not three. A posted row counts as a LIKE.
--
-- soc_taste used to hand the bot three answers: POSTED, LIKE and HIDE. POSTED was
-- described to it as the strongest possible yes, which invited it to weigh the two
-- kinds of yes against each other - and there is nothing useful in that distinction.
-- Why we did not run a post we liked is usually timing, or the fact that we only run
-- so many. It says nothing about the kind of thing it was, which is the only question
-- the bot is being asked.
--
-- So: HIDE where somebody said hide, and LIKE for everything else it can see - the
-- posted and the liked-but-passed alike.
--
-- Run once in the Supabase SQL editor. Same return type as before, so the function is
-- replaced in place and nothing that calls it has to change.

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
    where status = 'POSTED'
       or (status = 'SKIPPED' and bot_hint <> '')
    order by created_at desc
    limit 80;
$$;

revoke all on function public.soc_taste() from public;
grant execute on function public.soc_taste() to anon, authenticated;
