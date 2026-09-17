-- Let the bot back in, without giving it a key to the building.
--
-- WHY THIS EXISTS. socializer-migration-04-auth.sql dropped the `anon` policies and
-- granted the table to `authenticated` where the JWT's email is the owner's. That was
-- right for the browser. It also silently cut off the SOC SOCIALIZER BOT, which reaches
-- PostgREST with the publishable key - and the publishable key IS the anon role.
--
-- The damage was invisible because RLS does not raise on select, it filters. The bot
-- read the queue, got HTTP 200 and an empty array, believed the queue was empty, then
-- found candidates it could not insert. Confirmed on 2026-09-17: a select returns
-- `[]` with a count of zero, and an insert returns 42501.
--
-- WHAT THIS DOES. Two functions, and no new way to reach the table itself. `anon` still
-- cannot select, update or delete a single row - that stays exactly as migration 04 left
-- it. All it gains is the ability to call these two, which is strictly less than it had
-- before migration 04.
--
--   soc_nominate()  adds one candidate. It cannot choose the submitter or the status.
--   soc_taste()     returns the POSTED rows, and only those.
--
-- On soc_taste: POSTED means we published it. Everything it returns is already public,
-- so it gives the bot back the one signal its orders call the most valuable - what a
-- human actually put their name to - while the working queue stays invisible.
--
-- WHAT IT COSTS. Anyone who finds the publishable key can nominate a candidate. That is
-- junk rows to pass or delete, not a breach, and it is the same door that stood open
-- before migration 04. They still cannot read the queue, rule on anything, or delete.
--
-- Run once in the Supabase SQL editor. Nothing else is needed: no user, no password.

-- `security definer` runs the body as the function's owner, which is how it writes to a
-- table the caller cannot touch. `set search_path` is not optional on such a function:
-- without it a caller can point `public` at a schema of their own and have the body run
-- their code as the owner.

create or replace function public.soc_nominate(
    p_post_key  text,
    p_post_url  text,
    p_source    text,
    p_author    text    default '',
    p_why       text    default '',
    p_has_media boolean default null,
    p_media_url text    default ''
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
    -- The queue page puts post_url straight into an href and media_url into an img src.
    -- Now that an unauthenticated caller can reach this, a 'javascript:' URL here would
    -- be script running in the owner's signed-in session the moment they click it.
    if p_post_url !~* '^https?://' then
        raise exception 'post_url must start with http:// or https://';
    end if;

    if p_media_url <> '' and p_media_url !~* '^https?://' then
        raise exception 'media_url must start with http:// or https://';
    end if;

    insert into public.socializer
        (post_key, post_url, source, author, why, has_media, media_url, submitter, status)
    values
        (p_post_key, p_post_url, p_source, p_author, p_why,
         p_has_media, p_media_url, 'Bot', 'NEW');

    return 'added';
exception
    -- The unique index on post_key is the dedupe. The bot cannot read the queue to check
    -- first, so this is the answer to "is it already there" rather than a failure.
    when unique_violation then
        return 'duplicate';
end;
$$;

create or replace function public.soc_taste()
returns table (why text, source text, post_url text)
language sql
security definer
set search_path = public
as $$
    select why, source, post_url
    from public.socializer
    where status = 'POSTED'
    order by created_at desc
    limit 50;
$$;

-- `public` includes every role, present and future. Revoke first, then name the two.
revoke all on function public.soc_nominate(text, text, text, text, text, boolean, text) from public;
revoke all on function public.soc_taste() from public;

grant execute on function public.soc_nominate(text, text, text, text, text, boolean, text)
    to anon, authenticated;
grant execute on function public.soc_taste() to anon, authenticated;
