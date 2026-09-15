/* Who is at the door.
 *
 * One Supabase session shared by every staff page on the site. The session lives in
 * this origin's localStorage, so signing in once at /backstage also signs you in on
 * /shop, and it survives a refresh and a closed tab.
 *
 * The key below is the publishable one, the same key committed in
 * tools/build-inventory.py, and the copy the bots are told to read it out of. It is
 * public by design and grants nothing on its own: every write policy on the shop table
 * checks the signed-in email against OWNER, so a stranger holding this key can read the
 * shop and nothing more. That is why there is no service-role key anywhere in this repo
 * and must never be one - a service key bypasses row-level security entirely, and any key
 * in a static page is readable by every visitor.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const OWNER = 'kevinmkolb@gmail.com';

export const supabase = createClient(
    'https://tjteeqofqozmncfoiofy.supabase.co',
    'sb_publishable_AHzqW00erP1wModfz3mzVA_dxM6RtPr',
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

/* The signed-in user, or null. Resolves after Supabase has had a chance to read a
   session out of the URL, which is how a Google redirect hands one back. */
export async function currentUser() {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
        console.warn('[auth] session read failed:', error.message);
        return null;
    }
    return data.session ? data.session.user : null;
}

/* Signed in is not the same as allowed. Anyone with a Google account can complete the
   OAuth round trip; only OWNER can change anything, and the database enforces that
   independently of this check. This one is so the pages can say so politely. */
export function isOwner(user) {
    return !!user && String(user.email || '').toLowerCase() === OWNER;
}

/* Always ask which Google account. Never hint, never assume.
 *
 * Google OAuth reads the browser profile's own Google session. This profile is signed
 * into Chrome as soldoutcomedy@gmail.com on purpose - it is what makes the social
 * passwords autofill - so without prompt=select_account Google silently reuses that
 * account and there is no moment at which a different one can be picked. The page then
 * says "that is not the owner" about a choice nobody was offered.
 *
 * login_hint was tried here and does not fix it: a hint only suggests an account, and
 * an existing session outranks it. Sending both is worse still - Google honours
 * neither and goes straight back to the session it already had.
 *
 * The cost is one extra click on every sign-in. The sessions persist, so that click is
 * rare, and it is the only thing standing between you and being permanently logged in
 * as the wrong person. */
export async function signIn(redirectTo) {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: redirectTo || location.href.split('#')[0],
            queryParams: { prompt: 'select_account' }
        }
    });
    if (error) throw new Error(error.message);
}

export async function signOut() {
    await supabase.auth.signOut();
}

/* Fires on sign-in, sign-out and token refresh, in this tab and in any other tab of
   the same site, so a page can turn editable the moment the door opens. */
export function onAuthChange(fn) {
    supabase.auth.onAuthStateChange((_event, session) => fn(session ? session.user : null));
}
