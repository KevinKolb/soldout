/* Publishes a queued post to a platform outright, on behalf of whoever pressed the button.
 *
 * WHY THIS EXISTS AT ALL
 * The other way out of the queue is a composer URL: a tab opens with our words in it and a
 * human presses the platform's own Post button. That needs no credentials, which is why it
 * is still the default and still correct for the platforms that offer nothing better.
 *
 * Publishing outright needs a credential per platform, and every one of them is a secret
 * that must never reach a static page - a leaked Page token lets a stranger post as SOLD
 * OUT! Comedy. So the tokens live here as function secrets, exactly as the GitHub token
 * does in build-shop, and the page only gets to ask.
 *
 * WHO IS ALLOWED
 * The caller's Supabase session is verified against Supabase itself rather than trusted
 * from the request, and the email on it has to be the owner's. The row is then read with
 * that same session, so row-level security applies and this function needs no service-role
 * key - there is none in this project and there must never be one.
 *
 * WHAT IT WILL NOT DO
 * Post to a personal Facebook profile. Nothing can: the permission that allowed it
 * (publish_actions) was withdrawn in 2018 and never replaced. Facebook publishes as a
 * Page here, which is the right voice for a show anyway.
 *
 * DEPLOYING IT
 *   Bluesky - no review, no cost, works today:
 *     1. bsky.app -> Settings -> Privacy and security -> App passwords -> Add.
 *        An app password, NOT the account password. It can be revoked on its own.
 *     2. supabase secrets set BLUESKY_HANDLE=soldoutcomedy.bsky.social
 *        supabase secrets set BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
 *
 *   Facebook - needs a Meta app, which needs your login:
 *     1. developers.facebook.com -> create an app, type Business.
 *     2. Add the Facebook Login product. Request pages_manage_posts,
 *        pages_read_engagement and pages_show_list.
 *        While the app is in development mode these work for Pages you administer with no
 *        App Review. App Review and Business Verification are only needed to publish to
 *        OTHER people's Pages - that is the gate on a multi-tenant product, not on this.
 *     3. Get a Page token that does not expire: Business Settings -> Users -> System users
 *        -> add one, assign the Page, Generate token with the three permissions above.
 *        A token from the Graph API Explorer expires in an hour and will strand you.
 *     4. supabase secrets set FACEBOOK_PAGE_ID=1234567890
 *        supabase secrets set FACEBOOK_PAGE_TOKEN=EAA...
 *
 *   Then: supabase functions deploy soc-publish
 *
 * Which platforms go this way is not decided here. It is the `method` column in
 * public.socializer_channel, set per platform on the Socializer's SETTINGS tab, and this
 * function refuses a platform that is not set to API so that the switch means one thing.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const OWNER = 'kevinmkolb@gmail.com';

/* Pinned rather than floating. Meta supports a version for roughly two years from release
   and changes behaviour between them; a version that moves on its own is a page that stops
   working on a Tuesday for no reason anybody can see. Bump it deliberately. */
const GRAPH = 'v23.0';

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

/* What a platform hands back when it has published: something to put in posted_ref, and
   where a human can go and look at it. */
type Receipt = { ref: string; url: string };

const need = (name: string): string => {
    const v = Deno.env.get(name);
    if (!v) throw new Error(`${name} is not set on this function.`);
    return v;
};

/* --- Bluesky ---------------------------------------------------------------------------
   Two calls: trade the app password for a session, then write a post record into our own
   repo. No review, no approval, no cost - which is why this is the one to prove the route
   with before spending a fortnight on Meta. */

const BSKY = 'https://bsky.social/xrpc';

/* Bluesky counts a post's length in graphemes, not characters, and caps it at 300. The
   link has to survive whole or it stops being a repost, so the words give way first. */
function bskyText(why: string, url: string): string {
    const room = 300 - url.length - 1;
    const words = [...why.trim()];
    const kept = words.length > room ? words.slice(0, Math.max(0, room - 1)).join('') + '…' : why.trim();
    return kept ? `${kept} ${url}` : url;
}

/* Bluesky does not linkify anything by itself: a URL sitting in the text is text, and stays
   text in every client. A facet says "these bytes are a link", and the offsets are counted
   in UTF-8 bytes rather than characters - an emoji in the two cents shifts them, which is
   why this measures the encoded string instead of the string. */
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

async function toBluesky(why: string, url: string): Promise<Receipt> {
    const identifier = need('BLUESKY_HANDLE');
    const password = need('BLUESKY_APP_PASSWORD');

    const sres = await fetch(`${BSKY}/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
    });
    if (!sres.ok) {
        const detail = (await sres.text()).slice(0, 300);
        throw new Error(`Bluesky would not sign in (${sres.status}). ${detail}`);
    }
    const { accessJwt, did } = await sres.json();

    const text = bskyText(why, url);
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

    /* at://did/collection/rkey is the record's real name. The web address a person can open
       is built from the handle and the rkey, which is the last segment. */
    const { uri } = await pres.json();
    const rkey = String(uri || '').split('/').pop() ?? '';
    return { ref: uri, url: `https://bsky.app/profile/${identifier}/post/${rkey}` };
}

/* --- Facebook --------------------------------------------------------------------------
   One call, to the Page's own feed. `message` is our two cents - the thing sharer.php would
   not carry and the reason this function exists. `link` is the post being reposted; what
   Facebook renders beneath the message is read from that page's Open Graph tags, which are
   somebody else's and out of our hands either way. */

async function toFacebook(why: string, url: string): Promise<Receipt> {
    const page = need('FACEBOOK_PAGE_ID');
    const token = need('FACEBOOK_PAGE_TOKEN');

    const body = new URLSearchParams({ message: why, link: url, access_token: token });
    const res = await fetch(`https://graph.facebook.com/${GRAPH}/${page}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.id) {
        /* Meta's errors are the useful kind and worth passing back whole: an expired token,
           a missing permission and a Page you are not an admin of all look identical from
           out here otherwise. */
        const detail = out?.error?.message ?? (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Facebook refused the post (${res.status}). ${detail}`);
    }

    /* The id is pageid_postid. The second half is what a permalink wants. */
    const id = String(out.id);
    return { ref: id, url: `https://www.facebook.com/${id.replace('_', '/posts/')}` };
}

const PUBLISHERS: Record<string, (why: string, url: string) => Promise<Receipt>> = {
    Bluesky: toBluesky,
    Facebook: toFacebook,
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

    /* getUser goes back to Supabase rather than decoding whatever arrived, so a forged JWT
       does not get to post as us. */
    const { data: who, error: whoErr } = await supabase.auth.getUser();
    const email = (who?.user?.email ?? '').toLowerCase();
    if (whoErr || email !== OWNER) {
        return json({ error: 'That account cannot publish.' }, 403);
    }

    const body = await req.json().catch(() => null);
    const id = Number(body?.id);
    const platform = String(body?.platform ?? '');
    if (!id || !platform) return json({ error: 'Which row, and which platform?' }, 400);

    const publish = PUBLISHERS[platform];
    if (!publish) {
        return json({ error: `Nothing here knows how to publish to ${platform} yet.` }, 400);
    }

    /* The switch on the SETTINGS tab is the only thing that decides whether a platform goes
       out this way. Checking it here as well as in the page means the setting cannot be got
       round by a request that skips the page. */
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
        receipt = await publish(row.why ?? '', row.post_url);
    } catch (e) {
        return json({ error: (e as Error).message }, 502);
    }

    /* Published, so record it - and if this write fails the post is still out there, which
       is worth saying plainly rather than reporting a failure that would have you press the
       button again and post it twice. */
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
