-- Remove a test row, and look at why it was not caught as a duplicate.
--
-- On 2026-09-17 a write-path check called soc_nominate with the post_key derived the way
-- socializer/index.html derives it - 'bs:' + the rkey from a bsky.app /post/ URL - for a
-- URL already in the queue. It was expected to come back "duplicate" and write nothing.
-- It came back "added", so the row below exists and the same post is now in the table
-- twice under two different keys.
--
-- Run the SELECT first. It answers whether the bot and the page agree on how a key is
-- built, which is the whole basis of deduping and is worth knowing either way.

select id, post_key, submitter, status, created_at, why
from public.socializer
where post_url = 'https://bsky.app/profile/thrifttales.bsky.social/post/3ltwozavfac2i'
order by created_at;

-- Then remove the test row. It is the only one that says this.
delete from public.socializer
where why = 'end-to-end write check';
