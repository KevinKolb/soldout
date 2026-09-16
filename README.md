# SOLD OUT! Comedy

The website for SOLD OUT! Comedy: live comedy meets live shopping.

Static site hosted on GitHub Pages at [www.soldoutcomedy.com](https://www.soldoutcomedy.com),
deployed automatically from `main` by [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

## Structure

```
index.html            Homepage (currently the "coming soon" placeholder)
CNAME                 Custom domain for GitHub Pages

assets/               All static assets
  css/style.css       Site stylesheet
  images/             Logos, photos, social icons, clip videos
  videos/             Background video clips
  data/               Site content as XML (shows, taglines, videos, musicvids)

live/                 Show-day pages: prop check-in form, prop display, QR codes
backstage/            Backstage: the card grid, and the Socializer
tools/                The browser tools, the build scripts and the bots' orders
archive/              Previous homepage and its alternate themes
```

## Content

Site content lives in `assets/data/*.xml` rather than in the HTML. Asset paths inside
those XML files are root-relative (`/assets/images/...`) so they resolve correctly from
any page, whatever folder it sits in.

Edit the XML by hand, or use the browser tools in `tools/`, which generate an updated
file for you to download and commit.

## SOC SOCIALIZER BOT

A routine that goes looking for funny posts once a day and adds what it finds to the
**POST CANDIDATES** database in Notion, under SOCIALS. One row per candidate: why it is
funny, the handle, the permalink, the platform, and a Media tick where the source carries
an image or a video.

The **Socializer** at [backstage/socializer](backstage/socializer/index.html) is where
that queue is worked, and its bookmarklet is the same job done by hand: press it on any
post and the page opens with the link, the author and the platform already filled in.

Rows arrive as `NEW` and nothing changes that but a person. Each card offers the native
repost on the platform the post already lives on - which keeps the author's credit and
inherits the engagement, where a fresh post carrying a link does neither - and composers
for everywhere else, minus the platform it came from.

For a day this queue lived in a Notion database. It came back because Notion's API refuses
cross-origin browser requests, so every write needed an edge function holding a token, and
its formulas have no URL encoder, so every link it built had to be hand-sanitised.
Supabase talks to the browser directly and enforces who may write in the database rather
than in the page. The round trip was not wasted: Notion is where the queue learned it
needs `status`, which the original never had.

Standing orders are [tools/socializer-bot.md](tools/socializer-bot.md), not the routine's
prompt: the prompt is one line and points at that file, so the orders can be changed by
committing. That file holds what qualifies, the **Popular sources** worth watching, and the
fields of a row. Manage the routine at <https://claude.ai/code/routines>.

### What this replaced

There was a repost desk at `backstage/socializer.html` and a queue behind it in Supabase:
a card per candidate, prefilled composers for X, Facebook, Bluesky, Threads and Instagram,
a media thumbnail, and per-destination ticks. A bookmarklet captured posts into it from any
page.

It is gone, deliberately — everything lives in Notion now. The `socializer` table still
exists with what it collected, and [tools/socializer-schema.sql](tools/socializer-schema.sql)
and its migrations still describe it, but nothing reads or writes it any more.

## Local development

The pages fetch XML over HTTP, so `file://` will not work. Serve the folder instead:

```sh
python -m http.server 8080
```

Then open <http://localhost:8080>.

To use the admin tools with save-to-disk support, run the helper server instead:

```sh
python tools/dev-server.py
```

Then open <http://localhost:8080/tools/addshows.html>.

## Deployment secrets

`live/input.html` and `live/prop.html` ship with `{{PLACEHOLDER}}` tokens in place of their
Airtable and EmailJS credentials. The deploy workflow substitutes them from GitHub repository
secrets, so the real keys are never committed. The build fails if a secret is missing or a
placeholder survives substitution.

Never replace a placeholder with a real value in a committed file. These pages are served
as plain static HTML, so anything hardcoded there is readable by every visitor.

Required secrets:

`AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME`,
`EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`

These are for prop check-in (`live/`) only. The shop build needs no secret: it reads the
`shop` table in Supabase through a public select policy, with the publishable key
committed in `tools/build-inventory.py`.

## Backstage

`/backstage` is the card grid, behind a Google sign-in, and `backstage.soldoutcomedy.com`
forwards to it. It must never redirect back to that subdomain: Cloudflare points the
subdomain here, so the two would loop. It did, once.

Notion is reached from the Bible and Socials cards. It holds show material and the social
account list, and nothing the site depends on.

The browser tools live in `tools/`, linked from the grid.

## Logging in

The tools that write anything sit behind Google sign-in through Supabase Auth. The session
is shared across the origin by `assets/js/auth.js`, so signing in on one also turns `/shop`
editable in place for the owner. Write access is granted in the database to one email
address by `tools/shop-migration-01-auth.sql`, not by holding a key, which is why the
publishable key can be committed and no service-role key exists anywhere in this repo.

Moving a signed-in page to a new path means adding that path to the redirect allow-list in
Supabase (Auth, URL Configuration). A path that is not on the list fails at the Google
round trip, not at the button.

First-time setup lives in the comments at the end of that migration: enable the Google
provider in Supabase, create a Google OAuth client, and register the redirect URLs.
