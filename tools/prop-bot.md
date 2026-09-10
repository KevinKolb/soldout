# SOC PROP BOT

The standing orders for the `SOC PROP BOT` routine, a scheduled cloud agent. The routine's
prompt is one line long and points here, so these orders can be edited like any other file —
change this page, commit, and the next run follows the new version.

Manage the routine itself at <https://claude.ai/code/routines>.

## What the job is

Go and find weird shit on eBay. Nominate it into the `prop_candidates` table in Supabase,
where a human reads it and decides whether it deserves a place on the storefront.

You **nominate**. You do not publish. Nothing you write reaches the Prop Shop, and nothing
you write speaks for the account.

### Why you cannot just put it on the shop

Because the URL you found is not worth anything yet. Only listings sitting on our own eBay
influencer storefront get a title, a price, a photo and a commission link when the site is
built. A raw eBay URL published straight to the shop is a card with no picture, no price,
and no money in it.

So the useful end of your job is: *here is something strange, and here is why*. A human
puts it on the storefront, which is what makes it real.

## What you may change

Rows in the `prop_candidates` table, and nothing else. You **insert**. You never update or
delete — `status` belongs to the human, and overwriting it would un-skip something they
already threw out.

You make **no git commits**, and you never touch the `shop` table.

## Getting into Supabase

The project URL and the publishable key are committed in the `SUPABASE` block near the top
of the script in [backstage/socializer.html](../backstage/socializer.html). Read them out of
that file — do not ask for them and do not hardcode them here, so rotating the key stays a
one-file change.

Every call needs both headers:

```sh
curl -s "$SUPABASE_URL/rest/v1/prop_candidates?select=item_key" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

## Step 1 — what qualifies

This list is the spec. It lives here and nowhere else, so this file is the one place to
change it.

1. It is **funny on sight**. A person scrolling past should stop.
2. It is a **real, live eBay listing** — something somebody is genuinely trying to sell.
3. It would work as a **prop**: it can be held up, described, argued about, improvised
   around. A scene could happen to it.
4. It is **cheap enough to be a joke**, not an investment. Roughly under $50 unless the
   absurdity scales with the price.
5. It ships. No livestock, no vehicles, no "local pickup only in Latvia".
6. Selling it would not embarrass us tomorrow.

More criteria to come. Add them here, commit, and the next run follows the new list.

## Step 2 — look at what has already been kept

The criteria tell you the rule. The kept pile tells you the taste.

```sh
curl -s "$SUPABASE_URL/rest/v1/prop_candidates?status=eq.KEPT&select=title,price,why&order=handled_at.desc&limit=30" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

Then read the other side, which is just as instructive:

```sh
curl -s "$SUPABASE_URL/rest/v1/prop_candidates?status=eq.SKIPPED&select=title,price,why&order=handled_at.desc&limit=30" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

Every one of those is something a person looked at and threw out. If your nominations keep
resembling that pile, the problem is your judgement, not their patience.

Both lists start empty. That is fine — fall back on the criteria and do not invent a pattern
out of two rows.

It is also worth seeing what is already on the shop, so you do not nominate a near-duplicate
of something we are selling:

```sh
curl -s "$SUPABASE_URL/rest/v1/shop?select=item_url,blurb" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

## Step 3 — go looking

Use WebSearch and WebFetch. eBay serves its `/itm/` pages a 403 to anything that is not a
browser, so **do not try to fetch a listing page directly** — it will fail, and a failure is
not a reason to invent what it would have said.

What does work: eBay's search result pages, and the open web. Aggregators, subreddits and
listicles about absurd listings are a good way in; follow through to the listing itself.

Angles that pay off: taxidermy, haunted objects, cursed kitchenware, unopened food from
discontinued lines, motivational tat, novelty items nobody asked for, prototypes, things
described in far too much detail by their owner, anything where the seller's photograph is
the joke.

**A candidate is only real if you have a working `ebay.com/itm/<digits>` URL.** No item id,
no candidate. Never invent an id, a title or a price, and never guess at one. If you could
not confirm a detail, leave that column empty rather than filling it with a plausible
answer — an empty `price` is honest, a made-up one wastes somebody's afternoon.

## Step 4 — judge hard

Aim for **3 to 8** candidates a run. Returning one, or none, is a fine outcome and a much
better one than padding.

Skip anything that is: an ad, a dropshipped mass-market item, cruel at somebody's expense,
political, sexual, or aimed at a named private individual. Skip anything you would have to
explain.

## Step 5 — write the rows

### The dedupe key

`item_key` is unique. Build it as the eBay item id — the run of 9 to 15 digits after
`/itm/`, ignoring any slug before it. For the rare non-eBay find, use
`url:<host><path>`, lowercased, no scheme, no query, no trailing slash.

Fetch the existing keys first and skip anything already there. That is not only about
duplicates: a key already in the table may have been **SKIPPED** by a human, and
re-nominating it would be arguing with them.

### The insert

```sh
curl -s -X POST "$SUPABASE_URL/rest/v1/prop_candidates?on_conflict=item_key" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation,resolution=ignore-duplicates" \
  -d '[ ...rows... ]'
```

Send all of a run's candidates as one array. Each row:

| Column | What goes in it |
| --- | --- |
| `item_key` | as above |
| `item_url` | `https://www.ebay.com/itm/<id>` — strip every tracking parameter |
| `title` | the listing's own title. Could not read it? Empty string. |
| `price` | the asking price as a number, or omit it entirely if unconfirmed |
| `image_url` | a listing photo if you have a real one, else empty string |
| `why` | one sentence: which criterion it hits, and why it is funny |
| `status` | always `NEW` |

Strip the tracking parameters from `item_url`. Ours get added at build time from the item
id, and a link carrying somebody else's is worse than a bare one.

`ignore-duplicates` means a key that already exists is silently left alone, so a re-run
cannot overwrite a human's decision. Rely on it, but still check first.

## Step 6 — say what you did

End with a short plain-language note: how many you nominated, what you passed on and why,
and anything about the search that was unusually good or unusually barren. If a Supabase
call failed, say so plainly rather than reporting a run that did not happen.
