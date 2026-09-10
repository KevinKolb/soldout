# SOC SOCIALIZER BOT

The standing orders for the `SOC SOCIALIZER BOT` routine, a scheduled cloud agent that runs
once a day. The routine's prompt is one line long and points here, so these orders can be
edited like any other file — change this page, commit, and the next run follows the new
version.

Manage the routine itself at <https://claude.ai/code/routines>.

## What the job is

Fill the repost queue that a human works down by hand in
[backstage/socializer.html](../backstage/socializer.html).

You **nominate candidates**. You do not post. Nothing in this job touches X, and nothing in
this job speaks for the account. A human reads every candidate and presses Post themselves.

## What you may change

Rows in the `socializer` table in Supabase, and nothing else. You **insert** candidates.
You never update or delete a row — `status` belongs to the human, and overwriting it would
un-skip something they already threw out.

You make **no git commits**. Nothing in this job edits a file in the repo.

## Getting into Supabase

The project URL and the publishable key are committed in the `SUPABASE` block near the top
of the script in [backstage/socializer.html](../backstage/socializer.html). Read them out of that
file — do not ask for them and do not hardcode them here, so rotating the key stays a
one-file change.

Every call needs both headers:

```sh
curl -s "$SUPABASE_URL/rest/v1/socializer?select=post_key" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

## Step 1 — what qualifies

This list is the spec. It lives here and nowhere else, so this file is the one place to
change it.

1. It is **funny**. Not relatable, not interesting. Funny.
2. It is about **selling** something — a listing, a price, a haggle, a flip, a marketplace
   message, a thing somebody is trying to move.
3. Or it is a **found object** — the beautiful junk somebody photographed in the wild.
4. It stands on its own. No thread, no context, no inside joke required.
5. Reposting it would not embarrass us tomorrow.

More criteria to come. Add them here, commit, and the next run follows the new list.

## Step 2 — look at what already got posted

The criteria tell you the rule. The queue tells you the taste. Before you go looking, read
what has actually cleared the bar:

```sh
curl -s "$SUPABASE_URL/rest/v1/socializer?status=eq.POSTED&select=author,platform,body,why,repost_text,posted_to&order=handled_at.desc&limit=30" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

Those are the ones a human read and chose to put out under our name. Study them for the
things the criteria cannot say out loud: how long a post tends to be, how broad or how dry
the joke is, whether it leans more to selling or more to found objects, which platforms keep
earning their place, and what `repost_text` shows about the line we like to put on top.
`posted_to` tells you where each one went, which is worth noticing — something that made it
onto all three destinations cleared a higher bar than something that only went to X.

Then read the other side, which is just as instructive:

```sh
curl -s "$SUPABASE_URL/rest/v1/socializer?status=eq.SKIPPED&select=author,platform,body,why&order=handled_at.desc&limit=30" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

Every one of those is a candidate somebody looked at and threw out. If your nominations keep
resembling that pile, the problem is your judgement, not their patience.

Both lists start empty and stay thin for a while. That is fine — fall back on the criteria
and do not invent a pattern out of two rows. Once there are ten or more POSTED, treat them
as the sharper spec.

If either call fails, say so in your final message and carry on with the criteria alone.
A calibration you could not fetch is not a reason to skip the run.

## Step 3 — check the popular sources first

These are people who reliably make the kind of thing we want. Check them before you go
searching the open web, and take roughly half a run's candidates from here whenever they
have posted anything good.

A source can live on any platform. We repost to X, but what we repost does not have to have
started there.

### Blue Collar Corey

- Facebook — <https://www.facebook.com/p/Blue-collar-corey-61582770742725/>
- Instagram — <https://www.instagram.com/heidercorey>
- YouTube — <https://www.youtube.com/@bluecollarcorey>

Check all three; the same clip often goes up on more than one, so pick whichever permalink
you can actually confirm and nominate it once.

*(This list is the place to add sources. Add a heading and its links, commit, and the next
run picks it up.)*

## Step 4 — then search wide

Use WebSearch and WebFetch to find other public posts from roughly the last seven days.

Angles that tend to pay off: resale and marketplace humour, absurd listings, cursed thrift
and estate-sale finds, haggling screenshots, strange eBay or Facebook Marketplace listings,
roadside junk, "found this at Goodwill".

Social platforms serve very little to a crawler, so expect to come at them sideways: search
the open web, including sites that quote or aggregate posts, then follow through to the
original.

**A candidate is only real if you can confirm a working permalink to the post itself** — an
`x.com/<handle>/status/<digits>`, a YouTube watch or shorts URL, an Instagram `/p/` or
`/reel/` URL, a Facebook post URL, or any other direct link to the thing itself rather than
to a feed or a profile. No confirmed permalink, no candidate. Never invent a URL, a handle,
or post text, and never guess at an id.

## Step 5 — judge hard

Aim for **3 to 8** candidates a run. Returning one, or none, is a fine outcome and a much
better one than padding. A thin queue of things that are actually funny beats a fat queue of
things somebody has to skip.

Skip anything that is: an ad or brand marketing, engagement bait, cruel at somebody's
expense, political, sexual, or about a named private individual. Skip anything you would
have to explain.

## Step 6 — write the rows to Supabase

### The dedupe key

`post_key` is unique, and it has to be built exactly the way the page builds it or the same
post lands twice:

| Platform | `post_key` | From |
| --- | --- | --- |
| X | `x:<digits>` | the number after `/status/` |
| YouTube | `yt:<id>` | the `v=` param, or the id after `/shorts/` |
| Instagram | `ig:<code>` | the code after `/p/` or `/reel/` |
| Facebook | `fb:<digits>` | the longest run of 6+ digits in the URL |
| Bluesky | `bsky:<rkey>` | the id after `/post/` |
| anything else | `url:<host><path>` | lowercased, no scheme, no query, no trailing slash |

Strip `www.` from the host, and strip tracking params (`utm_*`, `fbclid`, `igshid`, `si`,
`ref`, …) from every URL you store.

Fetch the existing keys first and skip anything already there. That is not only about
duplicates: a key already in the table may have been **SKIPPED** by a human, and
re-nominating it would be arguing with them.

### The insert

```sh
curl -s -X POST "$SUPABASE_URL/rest/v1/socializer?on_conflict=post_key" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation,resolution=ignore-duplicates" \
  -d '[ ...rows... ]'
```

Send all of a run's candidates as one array. Each row:

| Column | What goes in it |
| --- | --- |
| `post_key` | as above |
| `post_url` | the confirmed permalink, cleaned of tracking params |
| `platform` | `X`, `Bluesky`, `Facebook`, `Instagram`, `YouTube` or `Web` |
| `author` | the handle as `@name` where there is one, else the creator's name |
| `body` | the post's own words. Could not read them? Empty string. |
| `posted_at` | the original post's timestamp if you have it, else empty string |
| `why` | one sentence: which criterion it hits, and why it is funny |
| `has_media` | `true` if the source carries an image or video, `false` if it plainly does not, omit if you could not tell |
| `source` | always `Bot` |
| `status` | always `NEW` |

`body` is the post's own words and nothing else. Do not paraphrase it, and do not put a
description of the post there — `why` is where your own words go.

`has_media` decides whether the Instagram button is available on the card. Instagram will
not take a text-only post, so an article whose source has no image or video cannot go there.
Set it honestly: guessing `true` puts a dead button in front of somebody.

Never write `posted_to`. That column records where an article actually went out, and only a
human ticking a box puts anything in it.

`ignore-duplicates` means a key that already exists is silently left alone, so a re-run
cannot overwrite a human's decision. Rely on it, but still check first.

## Step 7 — report

There is no commit and nothing to push, so the run's only output is your final message. Say:

- how many rows you inserted, and the handle behind each
- roughly how many candidates you threw out at Step 5, and for what
- anything that got in the way: searches that turned up nothing, permalinks you could not
  confirm, a Supabase call that failed and what it said

If you found nothing worth nominating, insert nothing and say so. An empty run is a normal
outcome, not a failure.

## What the human sees

Everything you insert shows up in The Socializer as a **NEW** article, newest first. From
there a human presses Skip, or sends it to a composer and ticks off the destinations it
went out on — X, Bluesky, Facebook or Instagram. Those are the only things that change `status` and
`posted_to`, and you never touch either.
