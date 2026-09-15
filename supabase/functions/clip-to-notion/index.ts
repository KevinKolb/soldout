/* Appends one captured post to the SOCIALS page in Notion, on behalf of the owner.
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
 * The same two lines the SOC SOCIALIZER BOT appends, so a capture and a bot find read
 * identically on the page:
 *
 *     ---------------------------------------------
 *     **@handle** - why it is funny, in one sentence
 *     https://permalink  [has media]
 *
 * It appends and does nothing else. It cannot edit or delete a block, so it cannot
 * damage the account logins at the top of that page.
 *
 * DEPLOYING IT
 *   1. Make an internal integration at notion.so/profile/integrations
 *      - Capabilities: Insert content. Nothing else: it does not need to read or update.
 *      Copy the Internal Integration Secret (starts ntn_).
 *   2. Share the SOCIALS page with it: open the page, ... menu -> Connections ->
 *      add the integration. Without this it gets 404 on a page that plainly exists,
 *      which is Notion's way of saying "not shared with you".
 *   3. supabase secrets set NOTION_TOKEN_SOC=ntn_...
 *      or Dashboard -> Edge Functions -> Secrets.
 *   4. supabase functions deploy clip-to-notion
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const OWNER = 'kevinmkolb@gmail.com';

/* SOCIALS, under BACKSTAGE BIBLE. The same page the bot appends to. */
const PAGE = '9755d3fa-6f18-48aa-9831-ba93f501ae7b';
const NOTION_VERSION = '2022-06-28';

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

/* Notion takes rich text as spans, so the bold handle and the plain sentence are two
   pieces of one paragraph rather than markdown in a string. */
function span(content: string, bold = false, link: string | null = null) {
    return {
        type: 'text',
        text: { content, link: link ? { url: link } : null },
        annotations: { bold },
    };
}

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
    const media = body.media === true;

    const first: unknown[] = [];
    if (handle) {
        first.push(span(handle, true));
        if (why) first.push(span(' — ' + why));
    } else if (why) {
        first.push(span(why));
    } else {
        first.push(span('Captured by hand'));
    }

    const second: unknown[] = [span(url, false, url)];
    if (media) second.push(span('  [has media]'));

    const para = (rich: unknown[]) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: rich },
    });

    const res = await fetch(`https://api.notion.com/v1/blocks/${PAGE}/children`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
        },
        /* A divider first, so each entry is fenced off from whatever came before it -
           including, for the very first one, the account links the page is really for.
           children appends to the end: there is no call here that could reorder or
           remove what is already on the page. */
        body: JSON.stringify({
            children: [
                { object: 'block', type: 'divider', divider: {} },
                para(first),
                para(second),
            ],
        }),
    });

    if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        const hint = res.status === 404
            ? ' The page is probably not shared with the integration: open SOCIALS, ... menu, Connections, add it.'
            : '';
        return json({ error: `Notion refused it (${res.status}).${hint} ${detail}` }, 502);
    }

    return json({ ok: true, appended: new Date().toISOString() });
});
