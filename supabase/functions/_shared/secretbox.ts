/* Sealing a platform credential so the database can hold it without being trusted with it.
 *
 * WHY NOT JUST ROW-LEVEL SECURITY
 * RLS would keep a stranger out of socializer_secret, and it does. But a publishing token is
 * worth more than a row of the queue: it posts as SOLD OUT! Comedy. Encrypting it means the
 * table holds something useless on its own, so a mistaken policy, a stray backup, a Supabase
 * dashboard left open on a laptop or a future read-only role are all no longer enough.
 *
 * WHY NOT A SERVICE-ROLE KEY
 * The usual shape for this is: tokens in a table, and a function with the service-role key to
 * read them. That key bypasses row-level security for the whole project, and this repo does
 * not have one and must not (see CLAUDE.md). It does not need one either. The page posts a
 * token to a function, the function seals it and writes the ciphertext with the caller's own
 * session, and RLS applies the whole way. Only SOC_SECRET_KEY opens it, and that lives here
 * as a function secret - the same trust level as the tokens it protects, which is the point.
 *
 * AES-256-GCM, so a tampered ciphertext fails to open rather than decrypting to nonsense. The
 * nonce goes in front of the ciphertext; it need not be secret, only unique per message, and
 * getRandomValues gives that.
 *
 *   supabase secrets set SOC_SECRET_KEY=$(openssl rand -base64 32)
 *
 * Losing that key loses every stored token - they are re-entered on the settings page, which
 * is a nuisance and not a catastrophe. CHANGING it while tokens are stored strands them: they
 * stop opening and every platform reports a bad credential until each is entered again.
 */

const B64 = {
    to: (b: Uint8Array) => btoa(String.fromCharCode(...b)),
    from: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function key(): Promise<CryptoKey> {
    const raw = Deno.env.get('SOC_SECRET_KEY');
    if (!raw) throw new Error('SOC_SECRET_KEY is not set on this function.');

    const bytes = B64.from(raw.trim());
    if (bytes.length !== 32) {
        throw new Error('SOC_SECRET_KEY must be 32 bytes, base64 encoded'
            + ` - openssl rand -base64 32 gives one. This one is ${bytes.length}.`);
    }
    return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false,
        ['encrypt', 'decrypt']);
}

export async function seal(plain: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(plain)));

    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv);
    out.set(ct, iv.length);
    return B64.to(out);
}

export async function unseal(sealed: string): Promise<string> {
    const all = B64.from(sealed);
    try {
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: all.slice(0, 12) }, await key(), all.slice(12));
        return new TextDecoder().decode(plain);
    } catch {
        /* GCM refuses rather than returning rubbish, so this is the one place that can say
           the difference between a token the platform rejected and a token we cannot read. */
        throw new Error('The stored credential will not open. SOC_SECRET_KEY has changed'
            + ' since it was saved - enter it again on the SETTINGS tab.');
    }
}
