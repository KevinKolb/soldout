/* Starts a site build, on behalf of whoever pressed Save all.
 *
 * WHY THIS EXISTS AT ALL
 * Triggering a GitHub workflow needs a token with actions:write. Anything in a static
 * page is readable by every visitor, so the token cannot live in the shop. It lives
 * here as a function secret instead, and the page never sees it - it only gets to ask.
 *
 * WHO IS ALLOWED
 * The caller's Supabase session is verified against Supabase itself, not trusted from
 * the request, and the email on it has to be the owner's. A stranger with the
 * publishable key gets 403 and no build. That is the same rule the shop's row-level
 * security uses, kept in one shape.
 *
 * DEPLOYING IT
 *   1. Make a fine-grained GitHub token at github.com/settings/tokens?type=beta
 *      - Repository access: only KevinKolb/soldout
 *      - Repository permissions: Actions -> Read and write
 *      Nothing else. It cannot read code or write to the repo with that scope.
   2. Give it to the function, never to the repo:
 *        supabase secrets set GITHUB_TOKEN_SOC=github_pat_...
 *      or Dashboard -> Edge Functions -> Secrets.
 *   3. supabase functions deploy build-shop
 *
 * The workflow it starts is the ordinary deploy, which is what rebuilds
 * assets/data/inventory.xml - so this is how a prop listed on the storefront reaches
 * the shop now that nothing rebuilds on a schedule.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const OWNER = 'kevinmkolb@gmail.com';
const REPO = 'KevinKolb/soldout';
const WORKFLOW = 'deploy.yml';
const BRANCH = 'main';

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

    /* getUser goes back to Supabase to check the token rather than decoding whatever
       arrived, so a forged JWT does not get a build. */
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization } } },
    );

    const { data, error } = await supabase.auth.getUser();
    const email = (data?.user?.email ?? '').toLowerCase();
    if (error || email !== OWNER) {
        return json({ error: 'That account cannot start a build.' }, 403);
    }

    /* GITHUB_TOKEN_SOC is the name it goes by here - SOC for SOLD OUT, so it does not
       collide with the other projects' tokens in the same account. The plain name is
       accepted too, so renaming it either way cannot break the button. */
    const token = Deno.env.get('GITHUB_TOKEN_SOC') ?? Deno.env.get('GITHUB_TOKEN');
    if (!token) {
        return json({ error: 'GITHUB_TOKEN_SOC is not set on this function.' }, 500);
    }

    const res = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                'User-Agent': 'soldout-build-shop',
            },
            body: JSON.stringify({ ref: BRANCH }),
        },
    );

    /* GitHub answers a dispatch with 204 and no body. Anything else is worth passing
       back in full rather than reporting a build that never started. */
    if (res.status !== 204) {
        const detail = (await res.text()).slice(0, 300);
        return json({ error: `GitHub refused the build (${res.status}). ${detail}` }, 502);
    }

    return json({ ok: true, started: new Date().toISOString() });
});
