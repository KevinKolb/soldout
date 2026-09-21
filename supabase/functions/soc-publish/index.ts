/* Publishes a queued post to a platform outright, on behalf of whoever pressed the button.
 *
 * WHY THIS EXISTS AT ALL
 * The other ways out of the queue are a composer URL and the clipboard: a tab opens and a
 * human presses the platform's own Post button. Those need no credentials, which is why they
 * are still the default and still correct for the platforms that offer nothing better.
 *
 * Publishing outright needs a credential per platform, and every one of them is a secret that
 * must never reach a static page - a leaked Page token lets a stranger post as SOLD OUT!
 * Comedy. So the credentials live where the page cannot read them, and the page only asks.
 *
 * WHERE A CREDENTIAL COMES FROM
 * Either place, stored first:
 *   1. public.socializer_secret, sealed under SOC_SECRET_KEY, entered on the SETTINGS tab and
 *      written by soc-connect. This is the one to use - it is self-service, it records which
 *      account the token is for, and it can be replaced without a deploy.
 *   2. This function's own env vars, which is how Bluesky and Facebook were set up first.
 *      Kept as a fallback so an existing setup does not stop working the day the table arrives.
 *
 * WHO IS ALLOWED
 * The caller's Supabase session is verified against Supabase itself rather than trusted from
 * the request, and the email on it has to be the owner's. Everything is then read and written
 * with that same session, so row-level security applies and this function needs no
 * service-role key - there is none in this project and there must never be one.
 *
 * WHAT IT WILL NOT DO
 * Post to a personal Facebook profile. Nothing can: the permission that allowed it
 * (publish_actions) was withdrawn in 2018 and never replaced. Facebook publishes as a Page
 * here, which is the right voice for a show anyway.
 *
 * DEPLOYING IT
 *   supabase secrets set SOC_SECRET_KEY=$(openssl rand -base64 32)   # same key as soc-connect
 *   supabase functions deploy soc-publish
 *
 * Per-platform credentials are entered on the SETTINGS tab. The click-path for getting each
 * one is in soc-connect's header and in the README.
 *
 * Which platforms go this way is not decided here. It is the `method` column in
 * public.socializer_channel, set per platform on the SETTINGS tab, and this function refuses a
 * platform that is not set to API so that the switch means one thing.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { seal, unseal } from '../_shared/secretbox.ts';

const OWNER = 'kevinmkolb@gmail.com';

/* Pinned rather than floating. Meta supports a version for roughly two years from release and
   changes behaviour between them; a version that moves on its own is a page that stops working
   on a Tuesday for no reason anybody can see. Bump it deliberately. */
const GRAPH = 'v23.0';
const THREADS = 'https://graph.threads.net';
const THREADS_V = `${THREADS}/v1.0`;

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });

/* What a platform hands back when it has published: something to put in posted_ref, and where
   a human can go and look at it. */
type Receipt = { ref: string; url: string };

/* The credential in use, plus what is needed to renew it in place. */
type Cred = {
    account: string;
    token: string;
    expires: string | null;
    /* True when it came out of the table, so a renewal has somewhere to be written back to. An
       env-var credential cannot be renewed by us and does not need to be. */
    stored: boolean;
};

const env = (name: string): string => Deno.env.get(name) ?? '';

/* Stored first, env second. The env names are the ones the first setup used, so a project that
   has never opened the settings page keeps working exactly as it did. */
async function credential(db: SupabaseClient, platform: string): Promise<Cred> {
    const { data } = await db
        .from('socializer_secret')
        .select('secret, account, expires_at')
        .eq('platform', platform)
        .maybeSingle();

    if (data?.secret) {
        return {
            account: data.account ?? '',
            token: await unseal(data.secret),
            expires: data.expires_at ?? null,
            stored: true,
        };
    }

    const fallback: Record<string, [string, string]> = {
        Bluesky: ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'],
        Facebook: ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_TOKEN'],
    };
    const pair = fallback[platform];
    const account = pair ? env(pair[0]) : '';
    const token = pair ? env(pair[1]) : '';
    if (!token) {
        throw new Error(`No ${platform} credential. Add one on the SETTINGS tab.`);
    }
    return { account, token, expires: null, stored: false };
}

/* --- Bluesky ---------------------------------------------------------------------------
   Two calls: trade the app password for a session, then write a post record into our own repo.
   No review, no approval, no cost. */

const BSKY = 'https://bsky.social/xrpc';

/* Bluesky counts a post's length in graphemes, not characters, and caps it at 300. The link has
   to survive whole or it stops being a repost, so the words give way first. */
function fit(why: string, url: string, cap: number): string {
    const room = cap - url.length - 1;
    const words = [...why.trim()];
    const kept = words.length > room
        ? words.slice(0, Math.max(0, room - 1)).join('') + '…'
        : why.trim();
    return kept ? `${kept} ${url}` : url;
}

/* Bluesky does not linkify anything by itself: a URL sitting in the text is text, and stays text
   in every client. A facet says "these bytes are a link", and the offsets are counted in UTF-8
   bytes rather than characters - an emoji in the two cents shifts them, which is why this
   measures the encoded string instead of the string. */
function bskyFacets(text: string, url: string) {
    const bytes = new TextEncoder().encode(text);
    const target = new TextEncoder().encode(url);
    let at = -1;
    for (let i = bytes.length - target.length; i >= 0; i--) {
        let hit = true;
        for (let j = 0; j < target.length; j++) {
            if (bytes[i + j] !== target[j]) { hit = false; break; }
        }
        if (hit) { at = i; break; }
    }
    if (at < 0) return [];
    return [{
        index: { byteStart: at, byteEnd: at + target.length },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    }];
}

async function toBluesky(cred: Cred, why: string, url: string): Promise<Receipt> {
    const sres = await fetch(`${BSKY}/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cred.account, password: cred.token }),
    });
    if (!sres.ok) {
        const detail = (await sres.text()).slice(0, 300);
        throw new Error(`Bluesky would not sign in (${sres.status}). ${detail}`);
    }
    const { accessJwt, did } = await sres.json();

    const text = fit(why, url, 300);
    const pres = await fetch(`${BSKY}/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessJwt}` },
        body: JSON.stringify({
            repo: did,
            collection: 'app.bsky.feed.post',
            record: {
                $type: 'app.bsky.feed.post',
                text,
                facets: bskyFacets(text, url),
                createdAt: new Date().toISOString(),
            },
        }),
    });
    if (!pres.ok) {
        const detail = (await pres.text()).slice(0, 300);
        throw new Error(`Bluesky refused the post (${pres.status}). ${detail}`);
    }

    /* at://did/collection/rkey is the record's real name. The web address a person can open is
       built from the handle and the rkey, which is the last segment. */
    const { uri } = await pres.json();
    const rkey = String(uri || '').split('/').pop() ?? '';
    return { ref: uri, url: `https://bsky.app/profile/${cred.account}/post/${rkey}` };
}

/* --- Facebook --------------------------------------------------------------------------
   One call, to the Page's own feed. `message` is our two cents - the thing sharer.php would not
   carry and the reason this function exists. `link` is the post being reposted; what Facebook
   renders beneath the message is read from that page's Open Graph tags, which are somebody
   else's and out of our hands either way. */

async function toFacebook(cred: Cred, why: string, url: string): Promise<Receipt> {
    const body = new URLSearchParams({ message: why, link: url, access_token: cred.token });
    const res = await fetch(`https://graph.facebook.com/${GRAPH}/${cred.account}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.id) {
        /* Meta's errors are the useful kind and worth passing back whole: an expired token, a
           missing permission and a Page you are not an admin of all look identical from out
           here otherwise. */
        const detail = out?.error?.message ?? (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Facebook refused the post (${res.status}). ${detail}`);
    }

    /* The id is pageid_postid. The second half is what a permalink wants. */
    const id = String(out.id);
    return { ref: id, url: `https://www.facebook.com/${id.replace('_', '/posts/')}` };
}

/* --- Threads ---------------------------------------------------------------------------
   Two calls, the way all of Meta's publishing APIs work: build a container describing the post,
   then publish that container. Splitting it is what lets a picture upload finish before the
   post appears; for text it is simply two calls.

   Threads linkifies a URL in the text by itself, so no facets and no link_attachment - passing
   both would give the post a preview card AND a link, for one link. */

async function toThreads(cred: Cred, why: string, url: string): Promise<Receipt> {
    const text = fit(why, url, 500);

    const make = await fetch(`${THREADS_V}/${cred.account}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ media_type: 'TEXT', text, access_token: cred.token }),
    });
    const container = await make.json().catch(() => null);
    if (!make.ok || !container?.id) {
        const detail = container?.error?.message ?? make.status;
        throw new Error(`Threads would not take the post (${make.status}). ${detail}`);
    }

    const out = await fetch(`${THREADS_V}/${cred.account}/threads_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: String(container.id), access_token: cred.token }),
    });
    const posted = await out.json().catch(() => null);
    if (!out.ok || !posted?.id) {
        /* The container exists at this point and nothing is visible. It expires on its own in
           24 hours, so there is nothing to clean up - but say what happened, because "it did
           not post" and "it half posted" want different next moves. */
        const detail = posted?.error?.message ?? out.status;
        throw new Error(`Threads built the post but would not publish it (${out.status}).`
            + ` ${detail} Nothing is visible; the draft expires by itself.`);
    }

    const id = String(posted.id);

    /* The permalink is a separate ask and not worth failing over: the id is the receipt, and a
       missing link costs a click, not a post. */
    let link = `https://www.threads.net/@${cred.account}/post/${id}`;
    try {
        const perm = await fetch(
            `${THREADS_V}/${id}?fields=permalink&access_token=${encodeURIComponent(cred.token)}`);
        const said = await perm.json();
        if (said?.permalink) link = String(said.permalink);
    } catch { /* keep the constructed one */ }

    return { ref: id, url: link };
}

/* A long-lived Threads token is good for 60 days, and the way it stays alive is being renewed
   before it dies. Doing that on use means the only way to lose one is not to post for two
   months - and if that happens the settings page has been showing how long was left the whole
   time. Renewing needs a token that is still valid, which is why this runs before publishing
   rather than after a failure. */
async function renewThreads(db: SupabaseClient, cred: Cred): Promise<Cred> {
    if (!cred.stored || !cred.expires) return cred;

    const left = new Date(cred.expires).getTime() - Date.now();
    if (!Number.isFinite(left) || left > 7 * 864e5) return cred;

    const res = await fetch(`${THREADS}/refresh_access_token`
        + `?grant_type=th_refresh_token&access_token=${encodeURIComponent(cred.token)}`);
    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.access_token) {
        /* Not fatal on its own: the token in hand may still have days left, and refusing to post
           because the renewal failed would turn a warning into an outage. The post goes out with
           what we have and the settings page keeps showing the clock. */
        return cred;
    }

    const seconds = Number(out.expires_in) || 60 * 86400;
    const expires = new Date(Date.now() + seconds * 1000).toISOString();

    await db.from('socializer_secret').update({
        secret: await seal(String(out.access_token)),
        expires_at: expires,
        updated_at: new Date().toISOString(),
    }).eq('platform', 'Threads');

    return { ...cred, token: String(out.access_token), expires };
}

const PUBLISHERS: Record<string, (c: Cred, why: string, url: string) => Promise<Receipt>> = {
    Bluesky: toBluesky,
    Facebook: toFacebook,
    Threads: toThreads,
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    const authorization = req.headers.get('Authorization') ?? '';
    if (!authorization) return json({ error: 'Not signed in.' }, 401);

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization } } },
    );

    /* getUser goes back to Supabase rather than decoding whatever arrived, so a forged JWT does
       not get to post as us. */
    const { data: who, error: whoErr } = await supabase.auth.getUser();
    const email = (who?.user?.email ?? '').toLowerCase();
    if (whoErr || email !== OWNER) return json({ error: 'That account cannot publish.' }, 403);

    const body = await req.json().catch(() => null);
    const id = Number(body?.id);
    const platform = String(body?.platform ?? '');
    if (!id || !platform) return json({ error: 'Which row, and which platform?' }, 400);

    const publish = PUBLISHERS[platform];
    if (!publish) {
        return json({ error: `Nothing here knows how to publish to ${platform} yet.` }, 400);
    }

    /* The switch on the SETTINGS tab is the only thing that decides whether a platform goes out
       this way. Checking it here as well as in the page means the setting cannot be got round by
       a request that skips the page. */
    const { data: channel } = await supabase
        .from('socializer_channel').select('method').eq('platform', platform).maybeSingle();
    if (channel?.method !== 'API') {
        return json({ error: `${platform} is set to post by hand. Change it on SETTINGS first.` }, 409);
    }

    /* Read with the caller's own session, so row-level security decides what is visible. */
    const { data: row, error: rowErr } = await supabase
        .from('socializer').select('id, post_url, why, posted_to, posted_ref').eq('id', id).single();
    if (rowErr || !row) return json({ error: 'That row is not there.' }, 404);
    if (!/^https?:\/\//i.test(row.post_url ?? '')) {
        return json({ error: 'That row has no usable link.' }, 422);
    }
    if ((row.posted_to ?? []).includes(platform)) {
        return json({ error: `That one has already gone to ${platform}.` }, 409);
    }

    let receipt: Receipt;
    try {
        let cred = await credential(supabase, platform);
        if (platform === 'Threads') cred = await renewThreads(supabase, cred);
        receipt = await publish(cred, row.why ?? '', row.post_url);
    } catch (e) {
        return json({ error: (e as Error).message }, 502);
    }

    /* Published, so record it - and if this write fails the post is still out there, which is
       worth saying plainly rather than reporting a failure that would have you press the button
       again and post it twice. */
    const { error: saveErr } = await supabase
        .from('socializer')
        .update({
            posted_to: [...(row.posted_to ?? []), platform],
            posted_ref: { ...(row.posted_ref ?? {}), [platform]: receipt.ref },
        })
        .eq('id', id);

    if (saveErr) {
        return json({
            ok: true,
            warning: `It went out, but the queue did not record it: ${saveErr.message}`
                + ' Do not press it again.',
            ...receipt,
        });
    }

    return json({ ok: true, ...receipt });
});
