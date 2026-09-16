-- The candidates that were in the Notion database, carried back into Supabase.
--
-- POST CANDIDATES lived in Notion for about a day. This is everything that was in it at
-- the point it moved back, mapped onto the columns the queue already had:
--
--     Witticism -> why          Link   -> post_url     Handle -> author
--     Platform  -> platform     Media  -> has_media    Status -> status
--
-- Notion's statuses were New / Posted / Passed. The queue calls the last one SKIPPED,
-- which is the same idea in the older vocabulary, so no data is lost in the translation.
-- Notion's 'Other' platform becomes 'Web', which is what this table has always called it.
--
-- Run once, after socializer-migration-04-auth.sql.
--
-- on conflict does nothing: post_key is unique, so running this twice is harmless and
-- re-running it will not overwrite a row somebody has since ruled on.

insert into public.socializer
    (post_key, post_url, platform, author, why, source, status, has_media)
values
    ('yt:ukZnbLNM8O4',
     'https://www.youtube.com/shorts/ukZnbLNM8O4',
     'YouTube',
     '@iamwolfgang',
     'A marketplace-finds short reading out real absurd Facebook Marketplace listings',
     'Bot', 'NEW', true),

    ('bs:3ltwozavfac2i',
     'https://bsky.app/profile/thrifttales.bsky.social/post/3ltwozavfac2i',
     'Bluesky',
     '@thrifttales.bsky.social',
     'A Bob Ross mug paired with a Bob Ross coloring book on a thrift shelf, arranged like a little memorial',
     'Bot', 'SKIPPED', true),

    -- The bookmarklet test from the day the clipper was built. Kept because deleting
    -- somebody's data to tidy up is a bad habit, and marked SKIPPED so it stays out of
    -- the working view.
    ('url:cnn.com',
     'https://www.cnn.com/',
     'Web',
     'CNN',
     'Bookmarklet test clip, not a real candidate',
     'Bookmarklet', 'SKIPPED', true)

on conflict (post_key) do nothing;
