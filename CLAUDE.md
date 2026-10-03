# CLAUDE.md — SOLD OUT! Comedy

Read [README.md](README.md) first. It documents the site structure, the XML content model,
the SOC SOCIALIZER BOT, local development, and deployment secrets. This file adds what the README
doesn't cover: the show itself, its voice, and how the other tools fit together.

This file is shared. Claude Code reads it from this repo, and the claude.ai Project
"SOLD OUT! Comedy" reads it through the GitHub integration. When a decision changes,
update it here.

## The show

SOLD OUT! Comedy is "consignment theater": the stage as the world's first live theatrical
marketplace, where audience members' own items become improv props and are sold in real time.
Consignment reinvented through comedy.

**The thesis, in one line.** Like Seinfeld made fun of the J. Peterman catalog, we make fun of
online selling — while online selling.

That line is the whole position and it settles more arguments than anything else on this page.
It is why the show can sell sincerely and mock selling at the same time, and it is the brief the
SOC SOCIALIZER BOT is working to when it goes looking for posts.

**Why it exists.** Live online selling is projected at $68 billion next year, and almost none of
it is watchable: the worst of QVC crossed with the worst of influencer culture — boring hosts,
pushy tactics, no entertainment value. SOLD OUT! is the first live shopping experience that is
entertaining rather than excruciating.

- **Stage Edition:** live theater
- **Screen Edition:** streamed on Whatnot (portrait format, OBS, "SOLD!" / "NO SALE!" overlays)

### How it works

1. Audience members bring props they want to sell, in **mail-ready boxes** — the thing gets
   shipped to whoever buys it, so it arrives ready to go.
2. They pay admission, then meet the **appraiser**: Antiques Roadshow, played straight. The
   appraisal is, in effect, taking the item on consignment.
3. The Sell Outs turn the object into scenes. A forgotten bread maker becomes a time machine, an
   exercise ball becomes a crystal ball dispensing terrible life advice, an old juicer stars in
   a medical drama.
4. Live and online audiences bid while it happens.

### The experience

Phones stay **on**, deliberately — the opposite of the usual theater rule, and worth saying out
loud in copy because audiences expect the opposite. People chat with online viewers, bid in real
time, and can come up on stage to help sell their own things. The room and the stream are one
show with two audiences, not a performance and a recording of it.

### Terminology (use consistently)

- Performers: **"Sell Outs"**
- Audience members who bring items: **"Willing Prop Sellers"**
- The Antiques Roadshow figure who takes an item in: the **appraiser**
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
  `main`, on manual runs, and every morning at 6:15 Central. That daily run is what brings
  in a prop newly listed on the eBay storefront and eBay's current prices; captions, tabs
  and status don't wait for it, since the shop reads those from Supabase live. Cron only
  speaks UTC, so two times are scheduled and a gate job lets through whichever one is 6:15
  in Chicago that day.
- **Notion:** Backstage for people, and not read by Claude — see "Notion" below. Nothing the
  site runs on lives there.
- **Airtable:** prop check-in (the `live/` pages).
- **Supabase:** the `shop` table that curates the shop, `socializer` for the repost
  queue, `socializer_channel` for how each platform gets posted to, and `prop_candidates`
  for the prop bot. Edge Function `soc-publish` publishes a queued post to a platform
  outright. `build-shop`, which started a deploy for the old BUILD button, is no longer
  called by anything since the daily rebuild replaced that button (2026-10-03); it can be
  deleted from Supabase along with its `GITHUB_TOKEN_SOC` secret.

Never commit real credentials. See "Deployment secrets" in [README.md](README.md).

## Notion

**Do not read Notion.** It is Backstage for people — `/backstage` redirects there and the root
page (`d350ecaf50bc4f1893ba5ab53590ef3e`) holds OVERVIEW, EDITIONS, PROPS, SCRIPTS, SCENES,
SHOW TIME!, KREWE, SOCIALS, NOTES and the rest — but it is no longer a source Claude consults,
and the Notion MCP is not to be used for show material.

Why: the pages were thin or empty where it mattered, so a fetch cost a round trip and returned
less than this file already says. Nothing the site runs on was ever in there.

**So this file is the show's source of truth.** Anything above about the premise, the flow, the
terminology or the voice is the version to write from, and when it changes it changes here.
If something is genuinely missing, ask rather than going to look.

## Shop (`/shop`)

The goal is to sell through every available channel, starting with commission.

How it works now:

1. Anything on the eBay influencer storefront is published automatically with the
   default tags, but **hidden** — as is anything added through the shop page itself, and
   anything added any other way: `status` defaults to `Hidden` on the table
   ([tools/shop-migration-02-hidden-default.sql](tools/shop-migration-02-hidden-default.sql)).
   Nothing reaches a visitor until somebody presses ACTIVE on its card — the one exception
   is POST in PROP POOL (item 5), which is that decision made up front. Rows in the
   `shop` table in Supabase ([tools/shop-schema.sql](tools/shop-schema.sql)) say what we
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
5. **PROP POOL** is a fifth tab, visible only when signed in as the owner, showing what
   the SOC PROP BOT found in `prop_candidates` (`tools/prop-bot-schema.sql`) and nobody had
   reviewed — nothing anywhere rendered that table before this. It is not a `tab_tag`: the
   real tabs all filter the one shop grid by that column, and a candidate is not a shop row
   yet, so it gets its own pane instead. **Skip** marks it `SKIPPED` and it is gone from the
   pool. **POST** puts it straight on the shop: a `shop` row with status `Active`, carrying
   the bot's title, price and photo as the row's own overrides, so the card is complete
   even though the listing is not on the influencer storefront (the build adds our EPN
   tracking to any eBay item). The candidate is then marked `KEPT`. The card appears on
   the public page after the next rebuild; a listing already in the shop is just marked
   `KEPT`, never added twice. Not shown in Hide mode or to anyone signed out.

   **Photos.** eBay turns automated visitors away from listing pages and from its search
   (tried from GitHub's runners as well as here), so the bot can only save a photo when its
   search results happen to show one — `tools/prop-bot.md` tells it how, and never to guess.
   The rest come from the daily build: `tools/build-pool-images.py` asks eBay's Browse API
   for each NEW candidate with no `image_url` and writes `assets/data/pool-images.json`
   (generated, not committed), which the pool falls back to. That step needs the
   `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` repository secrets; until they exist it skips.

### Observed gaps (noted, nothing decided yet)

- `/shop` has no FTC affiliate disclosure.
- There is no admin page for adding a shop item, and no written roadmap for the other
  sales channels. Both lived in `backstage/crosslist.html` and `backstage/addprops.html`, deleted
  2026-09-10; `crosslist.html` is recoverable from git history.
- A `shop` row whose listing has dropped off the storefront still publishes, and its
  link is dead.
- `assets/storefronts.html` looks like an older copy of the shop page.

## Posting (the Socializer)

Each account tile on the SETTINGS tab holds that platform's **username**
(`socializer_channel.handle`). The profile address is computed from it by a template per
platform in `PUBLISH`, and never stored — the tile's View link and its copy box are both views
of the handle, so they cannot drift from it the way three hand-written copies had already begun
to. A pasted profile URL or an `@name` is reduced to the name.

Every platform also has a checkbox (`socializer_channel.enabled`). Unchecked, the POST tab
offers no button for it at all — that is what keeps a card down to the three places you
actually use. Checked, it leaves the queue one of three ways, picked with a radio in its own
box on the tile and stored in `socializer_channel.method`:

- **By hand (`INTENT`)** — the platform's composer opens with our words already in the URL,
  and a human presses their Post button. Needs no credentials and cannot half-work.
- **Paste (`PASTE`)** — our words go to the clipboard, the destination opens, you paste. The
  only manual route where a composer URL will not carry text, and the only route at all for
  a platform with no composer.
- **Automatic (`API`)** — [supabase/functions/soc-publish](supabase/functions/soc-publish/index.ts)
  publishes it. Live for Bluesky, Threads and the Facebook **Page** directly, and for
  Instagram, X, Reddit and TikTok through Postiz (below). Two presses on the card, because it
  puts words on the internet under the show's name with no undo.

### Postiz

One Postiz account reaches the platforms this project has not wired a direct publisher for —
up to 28 of them — so a platform's **API** method can mean either its own direct publisher or
Postiz, decided by whether its `socializer_channel` row carries a `postiz_integration_id`
(added by [tools/socializer-migration-23-postiz.sql](tools/socializer-migration-23-postiz.sql)).
Postiz is not itself a platform: its tile on SETTINGS holds one key, connected the same way
and sealed the same way as any other credential, and every platform routed through it borrows
that one key rather than holding a credential of its own.

`postiz_identifier` is never guessed at: it is copied verbatim from what Postiz's own
`GET /integrations` says about the account you pick, because that exact string is what a post
has to be labelled with (`settings.__type`) to go out to the right place. Media goes through
Postiz's own upload endpoint first, since it takes a file rather than a URL.

**Written against Postiz's publicly documented API, not tested against the live service** —
there was no key available to test it with. The client-side wiring (the credential tile, the
picker, what each state shows) has been exercised in a browser against a stand-in for that
API; the two edge functions type-check cleanly; the actual HTTP calls to Postiz have not run
once. Confirm the first real post through it lands where it should.

### Credentials

Entered on the SETTINGS tab under Automatic, not from a terminal. The page posts the token to
[soc-connect](supabase/functions/soc-connect/index.ts), which **proves it works with the
platform** before keeping it — so "Connected" means connected — then seals it with AES-256-GCM
under `SOC_SECRET_KEY` and writes the ciphertext to `socializer_secret`.

The sealing is what makes this safe without a service-role key, and that is the point. The
usual shape — tokens in a table, a function with a service key to read them — would bypass
row-level security for the whole project. Here `soc-publish` reads the row with the *caller's*
own session, RLS applies throughout, and only the function's key opens the value. **Still no
service-role key anywhere, and there must never be one.** See
[_shared/secretbox.ts](supabase/functions/_shared/secretbox.ts).

A token is never read back into the page: the credential field starts empty, and what is known
about a saved one is stated in words beneath it. Disconnect deletes the row rather than
flagging it — a token left behind with something saying to ignore it is still a token that can
post. Changing `SOC_SECRET_KEY` while credentials are stored strands them; they are re-entered
on the page, which is a nuisance rather than a catastrophe.

Threads tokens last 60 days and `soc-publish` renews one on use when it is within a week of
expiring, so posting once a month keeps it alive. The settings page shows the clock either way.

Which of the three a platform can carry out is declared in `PUBLISH` in
[socializer/index.html](socializer/index.html) — the table holds only the choice. A platform
lists `API` there when `soc-publish` can publish to it **today**, not when the platform would
allow it; a switch that turns on nothing is worse than no switch. A stored method the
platform no longer offers falls back to one it does, so nothing strands a card behind a dead
button.

Facts worth not rediscovering:

- **Nothing can post to a personal Facebook profile.** `publish_actions` was withdrawn in
  2018 and never replaced. Facebook publishes as a Page or not at all.
- **`sharer.php` ignores prefilled text.** The `quote` parameter is dead; Facebook reads what
  it shows from the shared URL's Open Graph tags, which belong to whoever we are reposting.
- **App Review is only for other people's accounts.** Publishing to a Page we administer
  works with the app in development mode. Review plus Business Verification is the gate on a
  multi-tenant product, and it is calendar time, not engineering time.
- Instagram will not take a text-only post, which is what `has_media` on the queue is for.

Pressing a destination records that it went there and nothing else. Only **DONE** archives a
card — a post can go to one platform today and another tomorrow.

The first button on every POST card is **Copy blurb + link**: the two cents, a line break,
then the post's link, onto the clipboard, for anywhere the card has no button for. It is not
a destination and records nothing.

Never put a publishing credential in a page. See "Edge Function secrets" in
[README.md](README.md).

## Backstage and login

`/backstage` is a bare redirect to the BACKSTAGE page in Notion and nothing else: no card
grid, no sign-in, no styling. `backstage.soldoutcomedy.com` forwards to `/backstage`, so
that page must never redirect to the subdomain or the two will loop — Notion is a different
origin, so the redirect it does carry is safe.

Nothing links to the **Socializer** ([socializer/](socializer/index.html)) or the browser
tools in [tools/](tools/) any more. They still work; reach them by URL. The card grid that
used to list them, along with Airtable and Supabase, is recoverable from git history.

Auth is Supabase, shared across the origin by [assets/js/auth.js](assets/js/auth.js), so
signing in on one page also unlocks editing on `/shop`. Only `kevinmkolb@gmail.com` can
write; the policies in [tools/shop-migration-01-auth.sql](tools/shop-migration-01-auth.sql)
and [tools/socializer-migration-04-auth.sql](tools/socializer-migration-04-auth.sql)
enforce that in the database, so a page's own checks are manners rather than security.

**Mission Control** is the sign-in door, not a page. A `MISSION CONTROL` button sits in the
footer's bottom bar on every page that carries one (the shared footer in
[assets/footer.html](assets/footer.html), plus `/` by hand, since that page opts out of the
shared footer entirely). It only pops a small box for signing in or out of the same shared
Supabase session — nothing on the page changes because of it. A page that wants an admin
control checks that session for itself and shows the control when it is signed in as the
owner, the way [assets/js/shop-edit.js](assets/js/shop-edit.js) already does on `/shop`.
**Proposed:** if Mission Control ever grows a page of its own, it holds utilities that have
no page of their own to live on — not a destination for the sign-in itself.

Two boxes carry the name, so keep them apart:

- **Mission Control sign in** is that footer popup: title, Sign in with Google, and once
  signed in your first name as the sign-out button. It does not drag.
- **Mission Control control panel** is the owner's toolbar on `/shop`, built by
  [assets/js/shop-edit.js](assets/js/shop-edit.js). Under its title, a Full / Hide switch:
  Hide shows the shop as a visitor sees it and shrinks the panel to just that switch, at
  half opacity. In Full it drags by its title; in Hide, which has no title, by any part of
  the box but the switch's track. Top to bottom in Full: ADD PROP MANUALLY, PROP BOT, FUNNY
  PRODUCT (the bookmarklet, explained on hover), BACKSTAGE, then your name, which asks SIGN
  OUT? YES / NO. PROP BOT and BACKSTAGE open in a new tab. The BACKSTAGE link lives only here
  now; nothing a visitor sees links to it.

Both `footer.css` and `shop-edit.js` are loaded with a `?v=` query string, because
Cloudflare caches them for four hours and a fix can otherwise sit behind a stale copy.
Bump the string on every page that loads the file whenever the file changes.

There is no service-role key in this repo and there must never be one. Any key in a static
page is readable by every visitor, and a service key bypasses row-level security entirely.
The committed publishable key is powerless until someone proves who they are.

## Working with Kevin

- He works iteratively with detailed feedback: propose before making large changes, then refine.
- Keep terminology and formatting consistent across all materials.
- Label anything undecided as **proposed**; don't present it as settled.
