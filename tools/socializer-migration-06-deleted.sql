-- A fourth status: DELETED.
--
-- Run this once in the Supabase SQL editor for the SOLD OUT! project, BEFORE the
-- Delete button on /socializer can work. Until it runs, pressing Delete fails with a
-- check constraint violation and the card stays where it is.
--
-- This is a soft delete on purpose, and it keeps the promise the schema already makes:
-- "There is deliberately no delete policy, so nothing can be destroyed from a browser."
-- Nothing is destroyed here either. The row stays, its post_key stays, and so the bot
-- still sees it on its dedupe pass and cannot nominate the same post again. Deleting
-- something is the strongest way of saying no to it, and that answer is worth keeping.
--
-- It is reversible from the page: a DELETED card still carries "Move back to TO POST".

alter table public.socializer
    drop constraint if exists socializer_status_check;

alter table public.socializer
    add constraint socializer_status_check
    check (status in ('NEW', 'SKIPPED', 'POSTED', 'DELETED'));
