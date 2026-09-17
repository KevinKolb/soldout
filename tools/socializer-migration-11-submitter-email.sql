-- A person who files a candidate signs it.
--
-- submitter used to hold how a row arrived - 'Bot', 'Manual' or 'Bookmarklet'. Two of
-- those said the same thing in different words: a human put it there. Which human was
-- never recorded, and with the queue behind a sign-in there is no reason not to know.
--
-- From here: 'Bot' for the routine, and the signed-in email address for anybody else.
-- How they typed it in - the form or the funny button - stops being recorded, because
-- it never told anyone anything they wanted.
--
-- Run once in the Supabase SQL editor.
--
-- Old rows become the owner's address. Every one of them was filed by hand from a page
-- only kevinmkolb@gmail.com can reach, so this is a record of what happened rather than
-- a guess - but it is a rewrite of existing rows, so it is worth knowing it happened.

alter table public.socializer
    drop constraint if exists socializer_submitter_check;

update public.socializer
    set submitter = 'kevinmkolb@gmail.com'
    where submitter in ('Manual', 'Bookmarklet');

-- Either the routine, or something shaped like an address. Not a real check of a real
-- mailbox; enough that a value is one of the two kinds of thing this column now means.
alter table public.socializer
    add constraint socializer_submitter_check
    check (submitter = 'Bot' or submitter like '_%@_%._%');
