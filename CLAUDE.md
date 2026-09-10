# CLAUDE.md — SOLD OUT! Comedy

Read [README.md](README.md) first. It documents the site structure, the XML content model,
the Socializer, local development, and deployment secrets. This file adds what the README
doesn't cover: the show itself, its voice, and how the other tools fit together.

This file is shared. Claude Code reads it from this repo, and the claude.ai Project
"SOLD OUT! Comedy" reads it through the GitHub integration. When a decision changes,
update it here.

## The show

SOLD OUT! Comedy is "consignment theater": live improv where audience members bring items
to sell. The items become props in improvised scenes while live and online audiences bid
on them.

- **Stage Edition:** live theater
- **Screen Edition:** streamed on Whatnot (portrait format, OBS, "SOLD!" / "NO SALE!" overlays)

### Terminology (use consistently)

- Performers: **"Sell Outs"**
- Audience members who bring items: **"Willing Prop Sellers"**
- Named scenarios: The Bridal Shower, Law & Order, The Dating Game, Emergency Room X-Rays

### Voice and style

- Copy is punchy and funny, but instructions and calls to action stay clear.
- Visuals are clean and deliberate, never elaborate. The shop uses a brutalist treatment:
  flat colour, hard rules and hard shadows, and only three typefaces (Bangers, Inter,
  Space Mono).
- The shop is the **Prop Shop**, under a "SOLD OUT! Comedy presents our" line. Its running joke
  sits under the name: "Nothing on this page is sold out! We know. It's confusing."

## Systems

- **Site:** this repo, deployed to GitHub Pages by
  [.github/workflows/deploy.yml](.github/workflows/deploy.yml). It deploys on every push to
  `main`, every 6 hours on a schedule, and on manual runs.
- **Notion:** show materials and the backstage workspace. Connected to Claude Code
  through the Notion MCP. Reached from the Notion card in the Booth: the
  backstage.soldoutcomedy.com subdomain now forwards to `/backstage` instead.
- **Airtable:** prop check-in (the `live/` pages).
- **Supabase:** the Socializer queue, and the `shop` table that curates the shop.

Never commit real credentials. See "Deployment secrets" in [README.md](README.md).

## Notion

The backstage workspace is the source of truth for show material. Its root page, "SOLD OUT!
Comedy BACKSTAGE" (`d350ecaf50bc4f1893ba5ab53590ef3e`), holds OVERVIEW, WEBSITE, EDITIONS,
EMAIL, PROPS, SCRIPTS, SCENES, BITS/EFFECTS & GAGS, SHOW TIME!, KREWE, SOCIALS, TECH,
PLAYLISTS, NOTES, and SHOP.

Read the relevant page before:

- writing or editing show copy, or changing terminology
- touching `/shop`
- answering questions about scenes, props, or the prop check-in flow

Re-fetch rather than trusting an earlier read in the same session — NOTES and SHOP change
often. Skip Notion for pure code work with no show-material component.

## Shop (`/shop`)

The goal is to sell through every available channel, starting with commission.

How it works now:

1. Anything on the eBay influencer storefront is published automatically with the
   default tags, so listing it there is enough to put it on the shop. Rows in the `shop`
   table in Supabase ([tools/shop-schema.sql](tools/shop-schema.sql)) then say what we
   want to add: a row carries the listing URL, three classification fields, and optional
   title/price/image overrides:
   `tag_source` (the marketplace, e.g. `eBay`), `tag_type` (how we get paid: `Commission`
   or `Owned`) and `tag_location` (whose stock it is: `External` or `First-party`). They
   default to `eBay` / `Commission` / `External`, which is what every row is today. On the
   card `tag_source` is the sticker on the photo and the other two are chips beneath it.
   Two further fields have no default: `tab_tag` groups items into the tabs across the top
   of the shop and is never printed on a card, and `blurb` is our own caption, which
   replaces the marketplace's own title on the card when it is set. A row with status
   `Hidden` takes a storefront listing back down. Rows are edited on `/shop` itself when
   signed in, or in the Supabase dashboard. Anon can only read the table, so a stranger
   who finds the publishable key cannot put a link on the shop.
2. [tools/build-inventory.py](tools/build-inventory.py) merges those rows with live
   data from the storefront at <https://www.ebay.com/inf/soldoutcomedy>, adds the EPN
   tracking parameters, and writes `assets/data/inventory.xml`. That file is generated, so
   never edit it by hand.
3. [shop/index.html](shop/index.html) renders `inventory.xml` and ends the grid with a tile
   linking to the storefront.
4. Signed in as the owner, that same page becomes editable in place:
   [assets/js/shop-edit.js](assets/js/shop-edit.js) attaches a caption/tab/status editor to
   each card and an Add prop panel, writing straight to Supabase. It edits the published
   card rather than re-rendering from the table, because the title, price, photo and
   remaining count only exist in the built XML. A save is live in the table at once and on
   the public page at the next build.

### Observed gaps (noted, nothing decided yet)

- `/shop` has no FTC affiliate disclosure.
- There is no admin page for adding a shop item, and no written roadmap for the other
  sales channels. Both lived in `backstage/crosslist.html` and `backstage/addprops.html`, deleted
  2026-09-10; `crosslist.html` is recoverable from git history.
- A `shop` row whose listing has dropped off the storefront still publishes, and its
  link is dead.
- `assets/storefronts.html` looks like an older copy of the shop page.

## Backstage and login

`/backstage` is the Booth: the browser tools, behind a Google sign-in. Auth is Supabase,
shared across the site by [assets/js/auth.js](assets/js/auth.js), so signing in there also
unlocks editing on `/shop`. Only `kevinmkolb@gmail.com` can write; the policies in
[tools/shop-migration-01-auth.sql](tools/shop-migration-01-auth.sql) enforce that in the
database, so the page's own checks are manners rather than security.

There is no service-role key in this repo and there must never be one. Any key in a static
page is readable by every visitor, and a service key bypasses row-level security entirely.
The committed publishable key is powerless until someone proves who they are.

`backstage.soldoutcomedy.com` forwards to `/backstage`. Notion is reached from the Notion
card in the Booth.

## Working with Kevin

- He works iteratively with detailed feedback: propose before making large changes, then refine.
- Keep terminology and formatting consistent across all materials.
- Label anything undecided as **proposed**; don't present it as settled.
