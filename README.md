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
backstage/            Redirect to Backstage in Notion
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

A routine that goes looking for funny posts once a day and files what it finds in the
`socializer` table in Supabase. One row per candidate: why it is funny, the handle, the
permalink, where it was found, and a Media tick where the post carries an image or a
video. It aims for at least one repost from every platform on its list, plus two or three
**Originals**: our own lines riding whatever is trending that day, written from the show's
angle and filed with the story as their link. It files through `soc_nominate` rather than
writing to the table, because the table itself is readable only by the owner's signed-in
browser.

The **Socializer** at [socializer](socializer/index.html) is where
that queue is worked, and its bookmarklet is the same job done by hand: press it on any
post and the page opens with the link, the author and the source already filled in.

Rows arrive as `NEW` and nothing changes that but a person. Each card offers the native
repost on the platform the post already lives on - which keeps the author's credit and
inherits the engagement, where a fresh post carrying a link does neither - and a composer
for every other platform. Pressing any of them is what marks the candidate posted.

For a day this queue lived in a Notion database. It came back because Notion's API refuses
cross-origin browser requests, so every write needed an edge function holding a token, and
its formulas have no URL encoder, so every link it built had to be hand-sanitised.
Supabase talks to the browser directly and enforces who may write in the database rather
than in the page. The round trip was not wasted: Notion is where the queue learned it
needs `status`, which the original never had.

Standing orders are [tools/socializer-bot.md](tools/socializer-bot.md), not the routine's
prompt: the prompt is one line and points at that file, so the orders can be changed by
committing. That file holds what qualifies, the **Popular sources** worth watching, and the
fields of a row. Manage the routine at <https://claude.ai/code/routines/trig_01TwjWSP2bjnhptQgtg7DcQa>.

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

### Edge Function secrets

These are not GitHub secrets and never reach the repo or a page. They are set on the
Supabase project (`supabase secrets set NAME=value`, or Dashboard -> Edge Functions ->
Secrets), and only the function that needs one can read it.

| Secret | Used by | For |
| --- | --- | --- |
| `GITHUB_TOKEN_SOC` | `build-shop` | Starting a deploy so a shop edit goes live |
| `SOC_SECRET_KEY` | `soc-connect`, `soc-publish` | Sealing and opening the stored platform credentials. `openssl rand -base64 32` |
| `THREADS_APP_SECRET` | `soc-connect` | Exchanging a short-lived Threads token for a 60-day one. Without it a pasted token is stored as-is and its lifetime is reported as unknown |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | `soc-digest` | Sending the bot's run-end email as soldoutcomedy@gmail.com. Scope `gmail.send` only — it cannot read a mailbox |
| `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | `soc-publish` | Optional fallback, from before credentials were enterable on the page |
| `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN` | `soc-publish` | Optional fallback, as above |

`SOC_SECRET_KEY` is the only one of these you need now. Per-platform credentials are entered
on the Socializer's SETTINGS tab and stored sealed in `socializer_secret`; the two fallback
pairs are read only when no stored credential exists, so an older setup keeps working.

`soc-digest` is the one function deployed with `--no-verify-jwt`, because the bot calls it
holding only the publishable key, which is not a JWT. It never trusted its caller anyway: the
recipient address is a constant in the code and `soc_digest_claim` allows one send per twenty
minutes, so the worst a stranger with the URL can do is a duplicate copy of your own digest.
Everything else keeps JWT verification, because everything else acts on the caller's behalf.

A publishing token is worth more than the publishable key by a wide margin: it can post as
the show. That is the whole reason these functions exist rather than the page calling the
platforms itself. Where to get each credential:

- **Bluesky** — bsky.app -> Settings -> Privacy and security -> App passwords. An app
  password, never the account password; it can be revoked on its own.
- **Facebook Page** — a System User token from Business Settings -> Users -> System users,
  with `pages_manage_posts`, `pages_read_engagement` and `pages_show_list`. A token from the
  Graph API Explorer expires in an hour and will strand you.
- **Threads** — a Meta app with the Threads API product and the `threads_basic` and
  `threads_content_publish` scopes. Generate a token in the Graph API Explorer with **User or
  Page** set to `threads.net`. That token is **short-lived — one or two hours** — so set
  `THREADS_APP_SECRET` (App settings -> Basic -> App secret) and `soc-connect` will exchange it
  for the 60-day kind on the way in. `soc-publish` then renews it on use. Without the app
  secret the token is kept as pasted and the settings page says its lifetime is unknown, which
  is the honest answer: nothing can tell the two apart by looking.

App Review and Business Verification are only needed to publish to **other people's**
accounts. Publishing to accounts you administer works with the app in development mode.

## Backstage

`/backstage` redirects to the BACKSTAGE page in Notion and does nothing else: a meta
refresh and a `location.replace`, with no card grid, no sign-in and no styling. Notion
decides who gets in.

`backstage.soldoutcomedy.com` forwards to `/backstage`. That page must never redirect back
to the subdomain: Cloudflare points the subdomain here, so the two would loop. It did,
once. Notion is a different origin, so the redirect there now is safe.

Notion is Backstage for people and is not read by Claude; the show's own material lives in
[CLAUDE.md](CLAUDE.md) and the account handles live in the `socializer_channel` table. Nothing
the site depends on is in Notion.

The Socializer is at `/socializer/` and the browser tools live in `tools/`. Nothing links
to them now — reach them by URL.

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
