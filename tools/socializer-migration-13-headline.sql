-- The post's own words, kept apart from ours.
--
-- why has been carrying two different things. It is meant to be OUR sentence - what the
-- joke is, in the voice of whoever filed it - and the orders say so plainly. But the
-- funny button has been filling it with the page's own title whenever it found one, so
-- a good half of the queue says what the post says instead of what we think of it.
--
-- They are two columns now:
--
--   headline   the post's own words. Its title, or the text you had selected when you
--              pressed the funny button. Nobody's opinion, nobody's voice but theirs.
--   why        our two cents, always. Written by the person who filed it, or by the bot
--              about its own find. Never pasted from the post.
--
-- No new column: `body` has been sitting in this table unused since the beginning and is
-- exactly this, under a vaguer name. Renaming it costs nothing and empties nothing.
--
-- Run once in the Supabase SQL editor.

alter table public.socializer rename column body to headline;

-- soc_nominate takes one more argument. A signature cannot be replaced in place - a
-- `create or replace` with different arguments makes a second overload sitting beside
-- the first - so the old one is dropped by its exact signature first.

drop function if exists public.soc_nominate(text, text, text, text, text, boolean, text);

create or replace function public.soc_nominate(
    p_post_key  text,
    p_post_url  text,
    p_source    text,
    p_headline  text    default '',
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
    if p_post_url !~* '^https?://' then
        raise exception 'post_url must start with http:// or https://';
    end if;

    if p_media_url <> '' and p_media_url !~* '^https?://' then
        raise exception 'media_url must start with http:// or https://';
    end if;

    insert into public.socializer
        (post_key, post_url, source, headline, author, why,
         has_media, media_url, submitter, status)
    values
        (p_post_key, p_post_url, p_source, p_headline, p_author, p_why,
         p_has_media, p_media_url, 'Bot', 'NEW');

    return 'added';
exception
    when unique_violation then
        return 'duplicate';
end;
$$;

revoke all on function
    public.soc_nominate(text, text, text, text, text, text, boolean, text) from public;
grant execute on function
    public.soc_nominate(text, text, text, text, text, text, boolean, text)
    to anon, authenticated;
