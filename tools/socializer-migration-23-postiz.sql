-- Postiz: one external API key that fans a post out to whatever accounts Kevin has connected
-- inside Postiz's own dashboard (platform.postiz.com, or a self-hosted one), rather than this
-- project holding a separate OAuth integration per platform the way it does for Bluesky,
-- Threads and Facebook.
--
-- THE KEY ITSELF needs no new table. It is one more row in socializer_secret, platform =
-- 'Postiz', exactly like any other credential: sealed by soc-connect, read and unsealed only
-- inside soc-publish. account holds the API base URL when it is not the hosted default, the
-- same way Bluesky's handle sits in that column today.
--
-- WHAT IS NEW is per platform: which of Kevin's Postiz-connected accounts answers for that
-- platform's tile. postiz_integration_id is Postiz's own id for that connection.
-- postiz_identifier is the short string Postiz uses internally for the platform ("x",
-- "instagram", ...) - copied verbatim from what GET /integrations said, never guessed at here,
-- because that exact string is what a post has to be labelled with (settings.__type) to go out
-- to the right place. postiz_label is what the tile shows, so two accounts on the same
-- platform are told apart.
--
-- A platform with postiz_integration_id set to null is unchanged: nothing here is used, and
-- method can still be INTENT, PASTE, or its own direct API as before. This column is additive
-- and does not alter what Bluesky, Threads or Facebook do today.
--
-- Run once in the Supabase SQL editor.

alter table public.socializer_channel
    add column if not exists postiz_integration_id text,
    add column if not exists postiz_identifier text,
    add column if not exists postiz_label text;

comment on column public.socializer_channel.postiz_integration_id is
    'Postiz''s id for the connected account this tile posts through. Null = not routed through Postiz.';
comment on column public.socializer_channel.postiz_identifier is
    'Postiz''s own platform string for that connection (e.g. "x", "instagram"), read from GET /integrations and never guessed.';
comment on column public.socializer_channel.postiz_label is
    'What the tile shows for the connected account, so two accounts on one platform are told apart.';
