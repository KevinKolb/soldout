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
- The shop's running joke: "Nothing on this page is Sold Out! We know. It's confusing."

## Systems

- **Site:** this repo, deployed to GitHub Pages by
  [.github/workflows/deploy.yml](.github/workflows/deploy.yml). It deploys on every push to
  `main`, every 6 hours on a schedule, and on manual runs.
- **Notion:** show materials and the backstage workspace (backstage.soldoutcomedy.com
  redirects there). Connected to Claude Code through the Notion MCP.
- **Airtable:** prop check-in (the `live/` pages) and the Ambassador table that curates the shop.
- **Supabase:** the Socializer queue.

Never commit real credentials. See "Deployment secrets" in [README.md](README.md).

## Shop (`/shop`)

The goal is to sell through every available channel, starting with commission.

How it works now:

1. Items are curated in the Airtable Ambassador table, using the eBay Ambassador section of
   [admin/crosslist.html](admin/crosslist.html).
2. [tools/build-inventory.py](tools/build-inventory.py) merges those Airtable rows with live
   data from the storefront at <https://www.ebay.com/inf/soldoutcomedy>, adds the EPN
   tracking parameters, and writes `assets/data/inventory.xml`. That file is generated, so
   never edit it by hand.
3. [shop/index.html](shop/index.html) renders `inventory.xml` and ends the grid with a tile
   linking to the storefront.

The roadmap for all channels lives in [admin/crosslist.html](admin/crosslist.html). The
`PLATFORMS` list classifies each channel by mode (`api`, `gated`, `manual`, `affiliate`,
`internal`), and its "Not built yet" section covers unlist-from-everywhere, own inventory,
and real posting.

### Observed gaps (noted, nothing decided yet)

- `/shop` has no FTC affiliate disclosure.
- `build-inventory.py` hardcodes `<platform>` to eBay. It will need to come from the data
  once other channels feed the shop.
- An Airtable row whose listing has dropped off the storefront still publishes, and its
  link is dead.
- `assets/storefronts.html` looks like an older copy of the shop page.

## Working with Kevin

- He works iteratively with detailed feedback: propose before making large changes, then refine.
- Keep terminology and formatting consistent across all materials.
- Label anything undecided as **proposed**; don't present it as settled.
