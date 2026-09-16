-- Lock the Socializer queue to the owner.
--
-- The original policies (tools/socializer-schema.sql) granted select, insert and update
-- to `anon`. That was written when the page had no sign-in and the publishable key was
-- the only thing standing in front of it - which is to say, nothing at all, since that
-- key is committed and the page is served publicly. Anyone who viewed source could add
-- rows to our repost queue, or mark ours as posted.
--
-- The shop was fixed this way in shop-migration-01-auth.sql. This does the same for the
-- queue, with one difference: the shop is readable by anon on purpose, because the public
-- page renders it. Nothing public renders the queue, so reads are owner-only too.
--
-- Run once in the Supabase SQL editor.

create or replace function public.is_soc_owner()
returns boolean
language sql
stable
as $$
    select coalesce(auth.jwt() ->> 'email', '') = 'kevinmkolb@gmail.com';
$$;

-- The old world-writable policies, by the names the schema file gave them.
drop policy if exists "read the queue"    on public.socializer;
drop policy if exists "add to the queue"  on public.socializer;
drop policy if exists "rule on the queue" on public.socializer;

create policy "owner reads the queue"
    on public.socializer for select to authenticated
    using (public.is_soc_owner());

create policy "owner adds to the queue"
    on public.socializer for insert to authenticated
    with check (public.is_soc_owner());

create policy "owner rules on the queue"
    on public.socializer for update to authenticated
    using (public.is_soc_owner())
    with check (public.is_soc_owner());

-- Still no delete policy anywhere. Nothing can be destroyed from a browser, deliberately:
-- a candidate is ruled on by moving it to SKIPPED, never by removing the evidence.

-- `authenticated` and `anon` are different roles, and a policy naming one does not cover
-- the other. Granting select only to authenticated is the point here - signed out, the
-- queue does not exist.


-- The platform list is older than the accounts. It allowed X, Bluesky, Facebook,
-- Instagram, YouTube and Web, which was true when the only destination was X. Threads,
-- TikTok and Reddit are all real sources now, and squeezing them into 'Web' would cost
-- the repost button, since the page decides what "repost" means from this column.

alter table public.socializer drop constraint if exists socializer_platform_check;

alter table public.socializer add constraint socializer_platform_check
    check (platform in ('X', 'Bluesky', 'Facebook', 'Instagram', 'YouTube',
                        'Threads', 'TikTok', 'Reddit', 'Web'));

-- 'Bot' and 'Bookmarklet' and 'Manual' still cover how a row arrives, so `source` is
-- left alone.
