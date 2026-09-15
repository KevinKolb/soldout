/* Adds one captured post to the POST CANDIDATES database in Notion, on behalf of the owner.
 *
 * WHY THIS EXISTS AT ALL
 * A browser cannot call Notion's API. It refuses cross-origin requests, so a page on
 * soldoutcomedy.com gets nowhere near it - and the integration token would have to live
 * in that page to try, where every visitor could read it. The token lives here as a
 * function secret instead, and the page only gets to ask.
 *
 * WHO IS ALLOWED
 * The caller's Supabase session is verified against Supabase itself rather than trusted
 * from the request, and the email on it has to be the owner's. Same rule as build-shop,
 * kept in one shape.
 *
 * WHAT IT WRITES
 * One row, with the same fields the SOC SOCIALIZER BOT fills, so a hand capture and a
 * bot find are the same kind of thing and sort together:
 *
 *     Why it's funny | Handle | Link | Platform | Media | Status
 *
 * A row from here and a row from the routine are indistinguishable, which is the point:
 * what matters is whether a candidate is funny, not who noticed it. Status starts at New -
 * nothing in this function ever decides that something has been posted.
 *
 * It creates rows and does nothing else. It cannot edit or delete one, so it cannot
 * touch a candidate somebody has already ruled on.
 *
 * DEPLOYING IT
 *   1. Make an internal integration at notion.so/profile/integrations
 *      - Capabilities: Insert content. Nothing else: it does not need to read or update.
 *      Copy the Internal Integration Secret (starts ntn_).
 *   2. Share the POST CANDIDATES database with it: open it, ... menu -> Connections ->
 *      add the integration. A child normally inherits its parent's connections, so
 *      sharing SOCIALS covers it. Without this, Notion answers 404 on a database that
 *      plainly exists, which is its way of saying "not shared with you".
 *   3. supabase secrets set NOTION_TOKEN_SOC=ntn_...
 *      or Dashboard -> Edge Functions -> Secrets.
 *   4. supabase functions deploy clip-to-notion
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const OWNER = 'kevinmkolb@gmail.com';

/* The POST CANDIDATES database, under SOCIALS, under BACKSTAGE. This replaced the
   page of the same name in September 2026: a page could only be appended to, so nothing
   recorded whether a candidate had been posted, passed on, or never read. */
const DATABASE = '4870f03c-f2f2-4bd8-a51e-1d4c9e89b0ca';
const NOTION_VERSION = '2022-06-28';

/* Which platform a permalink belongs to. Worked out from the URL rather than asked for
   on the form, because the URL already knows and a dropdown is one more thing to get
   wrong. Anything unrecognised lands on Other and can be corrected in Notion in a click. */
const PLATFORMS: [RegExp, string][] = [
    [/(^|\.)x\.com$|(^|\.)twitter\.com$/, 'X'],
    [/(^|\.)bsky\.app$/, 'Bluesky'],
    [/(^|\.)instagram\.com$/, 'Instagram'],
    [/(^|\.)threads\.(com|net)$/, 'Threads'],
    [/(^|\.)facebook\.com$|(^|\.)fb\.(com|watch)$/, 'Facebook'],
    [/(^|\.)tiktok\.com$/, 'TikTok'],
    [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'],
    [/(^|\.)reddit\.com$|(^|\.)redd\.it$/, 'Reddit'],
];

function platformOf(url: string): string {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return 'Other';
    }
    for (const [pattern, name] of PLATFORMS) {
        if (pattern.test(host)) return name;
    }
    return 'Other';
}

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

    const { data, error } = await supabase.auth.getUser();
    const email = (data?.user?.email ?? '').toLowerCase();
    if (error || email !== OWNER) {
        return json({ error: 'That account cannot write to Notion.' }, 403);
    }

    const token = Deno.env.get('NOTION_TOKEN_SOC') ?? Deno.env.get('NOTION_TOKEN');
    if (!token) return json({ error: 'NOTION_TOKEN_SOC is not set on this function.' }, 500);

    let body: { url?: string; handle?: string; why?: string; media?: boolean };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Send JSON.' }, 400);
    }

    const url = String(body.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return json({ error: 'That is not a link.' }, 400);

    const handle = String(body.handle ?? '').trim();
    const why = String(body.why ?? '').trim();
    const platform = platformOf(url);

    /* The title carries the sentence, because that is the column you read down the page.
       An entry saved without one would be a blank row, so it says where it came from
       instead until somebody writes the real line. */
    const title = why || (handle ? 'Captured from ' + handle : 'Captured by hand');

    const properties: Record<string, unknown> = {
        "Why it's funny": { title: [{ text: { content: title.slice(0, 2000) } }] },
        Link: { url },
        Platform: { select: { name: platform } },
        Media: { checkbox: body.media === true },
        Status: { select: { name: 'New' } },
    };
    if (handle) properties.Handle = { rich_text: [{ text: { content: handle.slice(0, 2000) } }] };

    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parent: { database_id: DATABASE }, properties }),
    });

    if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        const hint = res.status === 404
            ? ' The database is probably not shared with the integration: open POST CANDIDATES, ... menu, Connections, add it.'
            : '';
        return json({ error: `Notion refused it (${res.status}).${hint} ${detail}` }, 502);
    }

    return json({ ok: true, platform, added: new Date().toISOString() });
});
