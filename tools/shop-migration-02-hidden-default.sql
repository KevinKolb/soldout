-- Migration 02: a new prop is hidden until somebody says otherwise.
--
-- Run this once in the Supabase SQL editor. Safe to run twice.
--
-- The rule already held in the two places props actually arrive - the Add dialog sets
-- Hidden, and the build adopts a storefront listing as hidden - but it was a habit of
-- the code rather than a rule of the table. A row inserted anywhere else defaulted to
-- Active and went straight in front of an audience: a row added in the dashboard, a row
-- from some future tool, a row from a bot nobody has written yet.
--
-- A prop is worth seeing before it is public. It has no title, price or photo until a
-- build reads them from the storefront, so publishing on arrival shows a visitor a
-- hollow card, and there is no moment at which anyone has looked at it.
--
-- Existing rows are left exactly as they are. This changes what happens next, not what
-- has already been decided.

alter table public.shop
    alter column status set default 'Hidden';

comment on column public.shop.status is
    'Active, Sold or Hidden. New rows default to Hidden: nothing reaches a visitor until somebody presses ACTIVE.';
