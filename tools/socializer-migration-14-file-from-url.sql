-- File a candidate from nothing but its URL.
--
-- WHY THIS EXISTS. The iPhone share sheet can hand a Shortcut a URL and the Shortcut can
-- POST it somewhere. What it cannot do is work out a post_key: that is a different regex
-- per platform, and writing it in the Shortcuts editor would be both miserable and a
-- second copy of a rule that already exists in socializer/index.html.
--
-- So the rule moves here, where anything can reach it. Hand soc_file a URL and it cleans
-- the tracking off, works out where the post came from, derives the dedupe key, and files
-- the row. The Shortcut becomes two actions and no page ever opens.
--
-- THE THREE FUNCTIONS
--   soc_clean(url)  strips the junk a share sheet bolts on. Pure, safe to call.
--   soc_key(url)    the dedupe key. Pure, safe to call - which is the point, because it
--                   can be tested against the page's JavaScript without writing anything.
--   soc_file(...)   cleans, derives, inserts. Returns 'added' or 'duplicate'.
--
-- soc_key MUST agree with postKey() in socializer/index.html. Two implementations of one
-- rule is how the same post ends up in the queue twice under different keys, which has
-- already happened once. Test them against each other before trusting this.
--
-- WHAT IT COSTS. Like soc_nominate, this is reachable with the publishable key, so
-- somebody who found that key could file rows. That is junk to skip, not a breach: they
-- still cannot read the queue, rule on anything, or delete. p_submitter defaults to the
-- owner rather than being proven, for the same reason - the phone has no session.
--
-- Run once in the Supabase SQL editor.

-- ── the junk a share sheet adds ──────────────────────────────────────────────
create or replace function public.soc_clean(u text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
    junk constant text :=
        '(utm_[^=&]*|fbclid|gclid|mc_cid|mc_eid|ncid|cmpid|smid|smtyp'
        '|igshid|igsh|mibextid|rdid|share_fbid|share_source'
        '|is_from_webapp|sender_device|web_id|_r|_t|checksum|xmt'
        '|si|feature|app|ref|ref_src|ref_url|share_app_id|share_link_id'
        '|_branch_match_id|spm)';
    out  text := btrim(u);
    host text;
begin
    out  := regexp_replace(out, '#.*$', '');
    host := regexp_replace(lower(coalesce(substring(out from '^[a-zA-Z]+://([^/?#]+)'), '')), '^www\.', '');

    out := regexp_replace(out, '([?&])' || junk || '=[^&]*', '\1', 'gi');

    -- s and t are share tags on X and a timestamp on YouTube, so they go by host.
    if host ~ '^(x|twitter)\.com$' then
        out := regexp_replace(out, '([?&])[st]=[^&]*', '\1', 'gi');
    end if;

    out := regexp_replace(out, '&&+', '&', 'g');
    out := regexp_replace(out, '\?&', '?', 'g');
    out := regexp_replace(out, '[?&]+$', '');
    return out;
end;
$$;

-- ── the dedupe key, mirroring postKey() in the page ──────────────────────────
create or replace function public.soc_key(u text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
    host text;
    path text;
    q    text;
    hit  text;
begin
    host := regexp_replace(lower(coalesce(substring(u from '^[a-zA-Z]+://([^/?#]+)'), '')), '^www\.', '');
    host := regexp_replace(host, ':[0-9]+$', '');
    path := coalesce(substring(u from '^[a-zA-Z]+://[^/?#]*([^?#]*)'), '');
    q    := coalesce(substring(u from '\?([^#]*)'), '');

    if host = '' then return 'url:' || u; end if;

    if host ~ '^(x|twitter)\.com$' then
        hit := substring(path from 'status(?:es)?/([0-9]+)');
        if hit is not null then return 'x:' || hit; end if;
    end if;

    if host = 'youtu.be' then
        return 'yt:' || substring(path from 2);
    end if;

    if host = 'youtube.com' then
        hit := substring(q from '(?:^|&)v=([^&]*)');
        if hit is not null and hit <> '' then return 'yt:' || hit; end if;
        hit := substring(path from '/(?:shorts|live)/([^/]+)');
        if hit is not null then return 'yt:' || hit; end if;
    end if;

    if host = 'instagram.com' then
        hit := substring(path from '/(?:p|reel)/([^/]+)');
        if hit is not null then return 'ig:' || hit; end if;
    end if;

    if host = 'tiktok.com' then
        hit := substring(path from '/video/([0-9]+)');
        if hit is not null then return 'tt:' || hit; end if;
    end if;

    if host = 'bsky.app' then
        hit := substring(path from '/post/([^/]+)');
        if hit is not null then return 'bs:' || hit; end if;
    end if;

    return 'url:' || host || regexp_replace(path, '/$', '');
end;
$$;

-- ── file it ──────────────────────────────────────────────────────────────────
create or replace function public.soc_file(
    p_post_url  text,
    p_why       text default '',
    p_headline  text default '',
    p_author    text default '',
    p_submitter text default 'kevinmkolb@gmail.com'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    clean text;
    host  text;
    src   text;
begin
    if p_post_url !~* '^https?://' then
        raise exception 'post_url must start with http:// or https://';
    end if;

    clean := public.soc_clean(p_post_url);
    host  := regexp_replace(lower(coalesce(substring(clean from '^[a-zA-Z]+://([^/?#]+)'), '')), '^www\.', '');

    src := case
        when host ~ '^(x|twitter)\.com$'              then 'X'
        when host = 'bsky.app'                        then 'Bluesky'
        when host ~ '^(instagram\.com|instagr\.am)$'  then 'Instagram'
        when host ~ '^threads\.(com|net)$'            then 'Threads'
        when host ~ '^(facebook\.com|fb\.(com|watch))$' then 'Facebook'
        when host ~ '^((vt|vm)\.)?tiktok\.com$'       then 'TikTok'
        when host ~ '^(youtube\.com|youtu\.be)$'      then 'YouTube'
        when host ~ '^(reddit\.com|redd\.it)$'        then 'Reddit'
        else 'Web'
    end;

    insert into public.socializer
        (post_key, post_url, source, headline, author, why, submitter, status)
    values
        (public.soc_key(clean), clean, src, p_headline, p_author, p_why, p_submitter, 'NEW');

    return 'added';
exception
    when unique_violation then
        return 'duplicate';
end;
$$;

revoke all on function public.soc_clean(text) from public;
revoke all on function public.soc_key(text) from public;
revoke all on function public.soc_file(text, text, text, text, text) from public;

grant execute on function public.soc_clean(text) to anon, authenticated;
grant execute on function public.soc_key(text) to anon, authenticated;
grant execute on function public.soc_file(text, text, text, text, text) to anon, authenticated;
