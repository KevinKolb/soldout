/* The picture for a post, worked out from its address.
 *
 * WHY THIS IS A FUNCTION AND NOT THE PAGE
 * A browser cannot read x.com or tiktok.com: neither sends the CORS header that would let a
 * page on soldoutcomedy.com look at their markup. A server can, and every platform that gives
 * a picture up at all gives it up to a plain fetch with the right User-Agent. So the page asks
 * here, gets back one image address, and shows it - and, where the address will keep, writes
 * it into the row's media_url so the question is asked once per post rather than once per
 * visit.
 *
 * WHAT IT RETURNS
 *   { image: "https://...", persist: true }   a picture, and whether it is safe to store
 *   { image: null, reason: "..." }             no picture to be had, and roughly why
 *
 * persist is false for hosts that sign their image addresses with an expiry (TikTok, the
 * Instagram and Threads CDN). Those are shown while they last and looked up again next time.
 *
 * WHAT IT WILL NOT DO
 * It never returns page content, only an image address it read out of a page - so it is not a
 * proxy for reading things. It refuses private and local addresses, follows at most five
 * redirects and checks each hop, reads at most 1.5 MB, and gives up after eight seconds. It
 * keeps the gateway's JWT check, so only the signed-in page can ask.
 *
 * WHO ANSWERS WHAT, tested from outside on 2026-09-21
 *   YouTube     always: the thumbnail address is derived from the video id, no fetch needed
 *   X           og:image, to a Twitterbot fetch. A text-only post gives the profile picture
 *               back, which is not a picture of the post, so those are refused
 *   TikTok      the oEmbed endpoint's thumbnail_url. Signed, expires: not persisted
 *   Bluesky     the public API, no login: the post's own image or video poster
 *   Reddit      the thread's .json: the post's image, or its preview
 *   Instagram   nothing without a login. Tried anyway, with the bot User-Agent, in case
 *   Threads     og:image is the Threads logo, which is refused. Tried anyway, as above
 *   Facebook    nothing without a login
 *   anywhere    og:image or twitter:image, the way the bookmarklet reads it
 *
 * DEPLOYING IT
 *   supabase functions deploy soc-thumb
 * No secrets. JWT verification stays on.
 */

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const UA = {
    twitter: 'Twitterbot/1.0',
    facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    plain: 'soldoutcomedy-socializer/1.0 (+https://www.soldoutcomedy.com/socializer/)',
};

const LIMIT = 1_500_000;
const TIMEOUT = 8000;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}

/* Anything that is not a public web host is refused, before and after every redirect. */
function isPrivateHost(host: string): boolean {
    const h = host.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
        const [a, b] = [Number(m[1]), Number(m[2])];
        return a === 10 || a === 127 || a === 0
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 169 && b === 254)
            || (a === 100 && b >= 64 && b <= 127);
    }
    return false;
}

function publicUrl(u: string): URL | null {
    let url: URL;
    try { url = new URL(u); } catch { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (isPrivateHost(url.hostname)) return null;
    return url;
}

/* A fetch that follows redirects by hand so every hop is checked, and reads at most LIMIT. */
async function fetchText(u: string, ua: string): Promise<{ body: string; url: string } | null> {
    let url = publicUrl(u);
    for (let hop = 0; url && hop < 6; hop++) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), TIMEOUT);
        let res: Response;
        try {
            res = await fetch(url.toString(), {
                headers: { 'User-Agent': ua, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-US,en;q=0.8' },
                redirect: 'manual',
                signal: ctl.signal,
            });
        } catch {
            clearTimeout(timer);
            return null;
        }
        if (res.status >= 300 && res.status < 400) {
            clearTimeout(timer);
            const to = res.headers.get('location');
            await res.body?.cancel();
            if (!to) return null;
            url = publicUrl(new URL(to, url).toString());
            continue;
        }
        if (!res.ok || !res.body) { clearTimeout(timer); await res.body?.cancel(); return null; }
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let got = 0;
        try {
            while (got < LIMIT) {
                const { value, done } = await reader.read();
                if (done) break;
                chunks.push(value);
                got += value.length;
            }
        } finally {
            clearTimeout(timer);
            reader.cancel().catch(() => {});
        }
        const all = new Uint8Array(got);
        let at = 0;
        for (const c of chunks) { all.set(c.subarray(0, Math.min(c.length, got - at)), at); at += c.length; if (at >= got) break; }
        return { body: new TextDecoder().decode(all), url: url.toString() };
    }
    return null;
}

function unescapeHtml(s: string): string {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/* og:image or twitter:image out of a page's head, whichever attribute order it was written in. */
function metaImage(html: string): string {
    const head = html.slice(0, 400_000);
    const names = ['og:image:secure_url', 'og:image', 'twitter:image:src', 'twitter:image'];
    for (const n of names) {
        const a = new RegExp('<meta[^>]+(?:property|name)=["\']' + n.replace(/[.:]/g, '\\$&') + '["\'][^>]*?content=["\']([^"\']+)', 'i').exec(head);
        if (a) return unescapeHtml(a[1]);
        const b = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*?(?:property|name)=["\']' + n.replace(/[.:]/g, '\\$&') + '["\']', 'i').exec(head);
        if (b) return unescapeHtml(b[1]);
    }
    return '';
}

/* A picture that is not a picture of the post: an avatar, a logo, a site's default card. */
function generic(img: string): boolean {
    return /profile_images|default_profile|rsrc\.php|\/images\/post\/|\/avatar|\/logo|placeholder/i.test(img);
}

function okImage(img: string): string {
    const u = publicUrl(img);
    if (!u || generic(img)) return '';
    return u.toString();
}

/* Hosts that sign their image addresses with an expiry. Shown, never stored. */
function expiring(img: string): boolean {
    return /tiktokcdn|cdninstagram\.com|fbcdn\.net|scontent/i.test(img);
}

type Found = { image: string; persist: boolean } | null;

async function viaMeta(u: string, uas: string[], persist: boolean): Promise<Found> {
    for (const ua of uas) {
        const page = await fetchText(u, ua);
        if (!page) continue;
        const img = okImage(metaImage(page.body));
        if (img) return { image: img, persist: persist && !expiring(img) };
    }
    return null;
}

function youtube(url: URL): Found {
    const h = url.hostname.replace(/^www\.|^m\./, '');
    let id = '';
    if (h === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2] || '';
    else id = url.searchParams.get('v') || '';
    if (!/^[\w-]{6,}$/.test(id)) return null;
    return { image: 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg', persist: true };
}

async function tiktok(url: URL): Promise<Found> {
    const page = await fetchText('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url.toString()), UA.plain);
    if (page) {
        try {
            const d = JSON.parse(page.body);
            const img = okImage(String(d.thumbnail_url || ''));
            if (img) return { image: img, persist: false };
        } catch { /* not json */ }
    }
    return viaMeta(url.toString(), [UA.twitter, UA.facebook], false);
}

async function bluesky(url: URL): Promise<Found> {
    const m = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)/);
    if (!m) return null;
    let actor = decodeURIComponent(m[1]);
    const rkey = m[2];
    if (!actor.startsWith('did:')) {
        const r = await fetchText('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=' + encodeURIComponent(actor), UA.plain);
        if (!r) return null;
        try { actor = JSON.parse(r.body).did || ''; } catch { return null; }
        if (!actor) return null;
    }
    const uri = 'at://' + actor + '/app.bsky.feed.post/' + rkey;
    const r = await fetchText('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=' + encodeURIComponent(uri), UA.plain);
    if (!r) return null;
    try {
        const post = (JSON.parse(r.body).posts || [])[0];
        const e = post?.embed || {};
        const img = e.images?.[0]?.thumb
            || e.thumbnail
            || e.media?.images?.[0]?.thumb
            || e.media?.thumbnail
            || e.external?.thumb
            || '';
        const ok = okImage(String(img));
        return ok ? { image: ok, persist: true } : null;
    } catch { return null; }
}

async function reddit(url: URL): Promise<Found> {
    const clean = 'https://www.reddit.com' + url.pathname.replace(/\/+$/, '') + '.json?raw_json=1';
    const r = await fetchText(clean, UA.plain);
    if (!r) return viaMeta(url.toString(), [UA.facebook, UA.browser], true);
    try {
        const listing = JSON.parse(r.body);
        const post = (Array.isArray(listing) ? listing[0] : listing)?.data?.children?.[0]?.data || {};
        const direct = String(post.url_overridden_by_dest || post.url || '');
        if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(direct)) { const ok = okImage(direct); if (ok) return { image: ok, persist: true }; }
        const preview = String(post.preview?.images?.[0]?.source?.url || '');
        if (preview) { const ok = okImage(preview); if (ok) return { image: ok, persist: true }; }
        const thumb = String(post.thumbnail || '');
        if (/^https?:\/\//.test(thumb)) { const ok = okImage(thumb); if (ok) return { image: ok, persist: true }; }
    } catch { /* not the shape we expected */ }
    return null;
}

async function resolve(u: string): Promise<Found> {
    const url = publicUrl(u);
    if (!url) return null;
    const h = url.hostname.toLowerCase().replace(/^www\.|^m\.|^mobile\./, '');
    if (/^(youtube\.com|youtu\.be)$/.test(h)) return youtube(url);
    if (/^(x\.com|twitter\.com)$/.test(h)) return viaMeta(u, [UA.twitter, UA.browser], true);
    if (/(^|\.)tiktok\.com$/.test(h)) return tiktok(url);
    if (h === 'bsky.app') return bluesky(url);
    if (/^(reddit\.com|redd\.it)$/.test(h)) return reddit(url);
    if (/^(instagram\.com|threads\.(com|net))$/.test(h)) return viaMeta(u, [UA.facebook, UA.twitter], false);
    if (/^(facebook\.com|fb\.com|fb\.watch)$/.test(h)) return viaMeta(u, [UA.facebook], false);
    return viaMeta(u, [UA.browser, UA.facebook], true);
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    let u = '';
    if (req.method === 'GET') {
        u = new URL(req.url).searchParams.get('u') || '';
    } else {
        try { u = String(((await req.json()) || {}).url || ''); } catch { return json({ error: 'Send JSON.' }, 400); }
    }
    u = u.trim();
    if (!publicUrl(u)) return json({ error: 'That is not a public web address.' }, 400);

    try {
        const found = await resolve(u);
        if (!found) return json({ image: null, reason: 'No picture to be had from that page.' });
        return json(found);
    } catch (e) {
        return json({ image: null, reason: String((e as Error).message || e) });
    }
});
