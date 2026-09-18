/* Saves a platform's publishing credential, on behalf of whoever typed it in.
 *
 * WHY THE PAGE DOES NOT WRITE IT DIRECTLY
 * A token in a table is only as safe as every policy that will ever be written against that
 * table. This seals it first - AES-256-GCM under SOC_SECRET_KEY, a function secret - so the
 * row holds ciphertext and the plaintext exists in exactly two places: the browser tab it was
 * typed into, and inside this function. Never in the database, never in a log, and never on
 * its way back out: nothing reads a credential except soc-publish.
 *
 * It also means no service-role key, which this project does not have and must not. See
 * ../_shared/secretbox.ts for why that follows.
 *
 * WHAT IT DOES BEFORE SAVING
 * Uses the credential. A token is not saved until the platform has confirmed it works and
 * said which account it belongs to, so "Connected" on the settings page means connected -
 * not "something was typed here once". A typo is caught while you are still looking at the
 * field rather than three days later when a post does not go out.
 *
 * DEPLOYING IT
 *   supabase secrets set SOC_SECRET_KEY=$(openssl rand -base64 32)
 *   supabase functions deploy soc-connect
 *
 * That key must be the same one soc-publish has, because it is what opens what this seals.
 * Set it once, on the project; both functions read the same project secrets.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { seal } from '../_shared/secretbox.ts';

const OWNER = 'kevinmkolb@gmail.com';
const GRAPH = 'v23.0';
const THREADS = 'https://graph.threads.net/v1.0';

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

/* What a check found out: which account the credential is for, what to call it on the page,
   and when it runs out if it ever does. */
type Checked = { account: string; says: string; expires: string | null };

/* --- proving a credential before trusting it ------------------------------------------ */

/* Threads hands out a user token tied to one account, and /me is the cheapest way to ask it
   who that is. The token arrives as the long-lived kind, good for 60 days; soc-publish
   renews it on use before it runs out, so this only records when that clock started. */
async function checkThreads(token: string): Promise<Checked> {
    const res = await fetch(`${THREADS}/me?fields=id,username&access_token=${encodeURIComponent(token)}`);
    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.id) {
        throw new Error(`Threads would not take that token. ${out?.error?.message ?? res.status}`);
    }

    /* 60 days, which is what a long-lived Threads token is worth. Recorded rather than
       measured: the API does not say how long is left on a token it is handed. */
    const expires = new Date(Date.now() + 60 * 864e5).toISOString();
    return { account: String(out.id), says: '@' + (out.username ?? out.id), expires };
}

async function checkBluesky(handle: string, appPassword: string): Promise<Checked> {
    const res = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: handle, password: appPassword }),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.did) {
        throw new Error(`Bluesky would not sign in. ${out?.message ?? res.status}`
            + ' Use an app password from Settings, not the account password.');
    }
    /* An app password does not expire. It is revoked, which is a different thing and one the
       page cannot see coming. */
    return { account: handle, says: '@' + handle, expires: null };
}

async function checkFacebook(pageId: string, token: string): Promise<Checked> {
    const url = `https://graph.facebook.com/${GRAPH}/${encodeURIComponent(pageId)}`
        + `?fields=name&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.id) {
        throw new Error(`Facebook would not take that. ${out?.error?.message ?? res.status}`);
    }
    /* A System User token does not expire. One from the Graph API Explorer dies in an hour,
       and this cannot tell them apart - which is why the README says which to get. */
    return { account: String(out.id), says: out.name ?? String(out.id), expires: null };
}

const CHECKS: Record<string, (account: string, token: string) => Promise<Checked>> = {
    Threads: (_account, token) => checkThreads(token),
    Bluesky: (account, token) => checkBluesky(account, token),
    Facebook: (account, token) => checkFacebook(account, token),
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

    const { data: who, error: whoErr } = await supabase.auth.getUser();
    const email = (who?.user?.email ?? '').toLowerCase();
    if (whoErr || email !== OWNER) return json({ error: 'That account cannot connect one.' }, 403);

    const body = await req.json().catch(() => null);
    const platform = String(body?.platform ?? '');
    const account = String(body?.account ?? '').trim();
    const token = String(body?.token ?? '').trim();
    const forget = body?.forget === true;

    if (!platform) return json({ error: 'Which platform?' }, 400);

    /* Disconnecting is a delete, not a flag. A token left in the table with something saying
       to ignore it is still a token that can post. */
    if (forget) {
        const { error } = await supabase.from('socializer_secret').delete().eq('platform', platform);
        if (error) return json({ error: `Could not remove it: ${error.message}` }, 500);
        return json({ ok: true, forgotten: true });
    }

    const check = CHECKS[platform];
    if (!check) return json({ error: `Nothing here knows what a ${platform} credential is.` }, 400);
    if (!token) return json({ error: 'The token is empty.' }, 400);

    let found: Checked;
    try {
        found = await check(account, token);
    } catch (e) {
        /* Not saved. The point of checking first is that a credential in the table is one that
           was working a moment ago. */
        return json({ error: (e as Error).message }, 422);
    }

    let sealed: string;
    try {
        sealed = await seal(token);
    } catch (e) {
        return json({ error: (e as Error).message }, 500);
    }

    const { error } = await supabase.from('socializer_secret').upsert({
        platform,
        secret: sealed,
        account: found.account,
        expires_at: found.expires,
        updated_at: new Date().toISOString(),
        set_by: email,
    }, { onConflict: 'platform' });

    if (error) {
        return json({
            error: `That credential works, but it did not save: ${error.message}`
                + ' Has tools/socializer-migration-19-credentials.sql been run?',
        }, 500);
    }

    return json({ ok: true, says: found.says, account: found.account, expires: found.expires });
});
