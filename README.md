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
admin/                Browser tools for editing the XML content in assets/data
backstage/            Redirect to the Notion backstage workspace
tools/                Local development helpers (not used by the deployed site)
archive/              Previous homepage and its alternate themes
```

## Content

Site content lives in `assets/data/*.xml` rather than in the HTML. Asset paths inside
those XML files are root-relative (`/assets/images/...`) so they resolve correctly from
any page, whatever folder it sits in.

Edit the XML by hand, or use the browser tools in `admin/`, which generate an updated
file for you to download and commit.

## The Socializer

`admin/socializer.html` is the repost desk. It holds a queue of other people's posts that
are funny and either selling-related or a found object, and you work the queue down one
article at a time: **Skip** marks it SKIPPED and it never comes back, **Copy & open X**
puts the words on your clipboard and opens the composer.

Posting is deliberately manual. Nothing on the page talks to any platform: it holds the
words, you press Post. Where a post *came from* and where it *goes* are separate questions —
an article can start life on any link on the planet, and go out to any of three destinations.

| Destination | How it works |
| --- | --- |
| **X** | Paste into the composer; the link unfurls into the original post |
| **Bluesky** | The only one with a real compose intent, so the post arrives already written &mdash; no clipboard |
| **Facebook** | Same, into the Page composer. No prefill exists — its old sharer link lands text locked and uneditable |
| **Instagram** | The odd one out: needs an image or video, has no composer to open, and a caption URL is not clickable. The button copies a caption and credits the author; you bring the screenshot. It greys out when the source has no media at all |

`posted_to` records which destinations actually have it, so `POSTED` never has to mean
"posted… somewhere". `has_media` is set at capture time from the source's `og:image` /
`og:video`, and is what greys the Instagram button out.

Three things fill the queue, and all three write to the same Supabase table:

| Source | How |
| --- | --- |
| The **That's Funny!** bookmarklet, dragged to your bookmarks bar | Works on any page. On X it reads the post itself; elsewhere it takes the page's own metadata, or your selection |
| Typing a link into *Add one by hand* | Straight into the table |
| The **SOC SOCIALIZER BOT** routine | Inserts rows directly, so it makes no commits and triggers no deploys |

### Storage

The queue lives in Supabase, in the table created by
[tools/socializer-schema.sql](tools/socializer-schema.sql). The project URL and publishable
key go in the `SUPABASE` block at the top of the page's script.

That publishable key is committed on purpose — that is what it is for. (Supabase renamed the
old `anon` key to the publishable key; both still work and both map to the `anon` role the
policies name.) What it may do is fixed by the row-level security policies in that SQL file:
read the queue, add to the queue, change a row's status. It cannot delete anything and it cannot reach any other table.
The page is on a public site, so treat those three abilities as available to anyone who finds
it; for a repost queue that is the price of nobody having to set anything up. To tighten it,
put a Supabase login in front of the page and narrow the policies from `anon` to
`authenticated`.

Every row is keyed by `post_key`, derived from the URL (`x:<digits>`, `yt:<id>`, `ig:<code>`,
`fb:<digits>`, or `url:<host><path>`). The column is unique and every insert uses
`resolution=ignore-duplicates`, so catching the same thing twice is a no-op and a re-capture
can never resurrect something already marked SKIPPED.

### The bot

Standing orders are [tools/socializer-bot.md](tools/socializer-bot.md), not the routine's
prompt — the prompt is one line and points at that file, so the orders can be edited by
committing. That file holds all of it: what qualifies, the **Popular sources** worth
watching, and how to write a row. Manage the routine itself at
<https://claude.ai/code/routines>.

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

Then open <http://localhost:8080/admin/addshows.html>.

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
