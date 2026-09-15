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
backstage/            Backstage: login, and the browser tools for editing site content
tools/                Local development helpers (not used by the deployed site)
archive/              Previous homepage and its alternate themes
```

## Content

Site content lives in `assets/data/*.xml` rather than in the HTML. Asset paths inside
those XML files are root-relative (`/assets/images/...`) so they resolve correctly from
any page, whatever folder it sits in.

Edit the XML by hand, or use the browser tools in `backstage/`, which generate an updated
file for you to download and commit.

## The Socializer

A routine that goes looking for funny posts once a day and writes what it finds onto the
**SOCIALS** page in Notion, under BACKSTAGE BIBLE. One line per candidate: the handle, a
sentence on why it is funny, the permalink, and `[has media]` where the source carries an
image or a video.

It nominates and nothing else. Nothing in the job speaks for the account and nothing it
writes reaches an audience — a person reads the page and posts by hand, wherever it suits.

Standing orders are [tools/socializer-bot.md](tools/socializer-bot.md), not the routine's
prompt: the prompt is one line and points at that file, so the orders can be changed by
committing. That file holds what qualifies, the **Popular sources** worth watching, and the
shape of a line on the page. Manage the routine at <https://claude.ai/code/routines>.

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

Then open <http://localhost:8080/backstage/addshows.html>.

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

## Logging in

`/backstage` sits behind Google sign-in through Supabase Auth. The session is shared
across the site by `assets/js/auth.js`, so signing in there also turns `/shop` editable in
place for the owner. Write access is granted in the database to one email address by
`tools/shop-migration-01-auth.sql`, not by holding a key, which is why the publishable key
can be committed and no service-role key exists anywhere in this repo.

First-time setup lives in the comments at the end of that migration: enable the Google
provider in Supabase, create a Google OAuth client, and register the redirect URLs.
