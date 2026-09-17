-- DELETED goes away. A pass now says whether it liked the thing.
--
-- WHAT WAS WRONG WITH DELETED. It was meant to be the loose one - throw this out, and
-- never mind if it turns up again - but it never worked that way. post_key is a unique
-- index, so every row in this table blocks its own URL from being nominated twice,
-- whatever its status. DELETED and SKIPPED were the same answer wearing two hats.
--
-- WHAT REPLACES IT. The exact link is still always blocked, by the index, for every row.
-- What varies is what the bot should make of it, and that is now its own column rather
-- than a fourth status:
--
--   bot_hint = 'LIKE'   a good post we did not run. Keep finding things like it.
--   bot_hint = 'HIDE'   not for us. Steer away from this and its kind.
--   bot_hint = ''       does not apply - nothing has been passed here.
--
-- 'similar' is deliberately the bot's judgement and not a rule. A hint is a lean, not
-- a filter: the only hard exclusion in this system is the exact URL.
--
-- Run once in the Supabase SQL editor. It undoes socializer-migration-06-deleted.sql,
-- and is safe whether or not that one was ever run.

alter table public.socializer
    add column if not exists bot_hint text not null default ''
    check (bot_hint in ('', 'LIKE', 'HIDE'));

-- Deleting something was the strongest no available, so it lands as a pass that hides.
-- Order matters: claim these rows while they can still be told apart by status.
update public.socializer set bot_hint = 'HIDE'    where status = 'DELETED';
update public.socializer set status   = 'SKIPPED' where status = 'DELETED';

-- Everything passed before today was passed without an opinion being recorded. LIKE is
-- the softer reading and the one the page now defaults to, so it is the fair guess.
update public.socializer set bot_hint = 'LIKE'
    where status = 'SKIPPED' and bot_hint = '';

alter table public.socializer
    drop constraint if exists socializer_status_check;

alter table public.socializer
    add constraint socializer_status_check
    check (status in ('NEW', 'SKIPPED', 'POSTED'));

-- soc_taste gains a column, and a return type cannot be replaced in place.
drop function if exists public.soc_taste();

create or replace function public.soc_taste()
returns table (verdict text, why text, source text, post_url text)
language sql
security definer
set search_path = public
as $$
    select
        case
            when status = 'POSTED'  then 'POSTED'
            when bot_hint = 'HIDE'  then 'HIDE'
            else                         'LIKE'
        end,
        why, source, post_url
    from public.socializer
    where status = 'POSTED'
       or (status = 'SKIPPED' and bot_hint <> '')
    order by created_at desc
    limit 80;
$$;

revoke all on function public.soc_taste() from public;
grant execute on function public.soc_taste() to anon, authenticated;
