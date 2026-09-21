/* The run-end email: every unread candidate, each with a Skip and a Post button that work.
 *
 * WHY THE BUTTONS ARE LINKS BACK TO THE SOCIALIZER rather than links that do the thing.
 * An email client runs no JavaScript, so a button in an email is an anchor and nothing else. An
 * anchor that changes something the moment it is fetched gets fetched by things that are not you:
 * Outlook rewrites and follows links, scanners open them, clients prefetch. Candidates would rule
 * on themselves in the inbox overnight. So each button opens /socializer/?rule=<id>&to=POST, and
 * the page - signed in as the owner, with row-level security applying - makes the change. A
 * forwarded or leaked email can therefore do nothing at all, and the tap lands on the queue with
 * the next thing you want already on screen.
 *
 * Only POST and SKIPPED are ever offered. Neither publishes: one moves the card to the POST tab
 * and one archives it, and actually going out to a platform is still a press on a card. A link
 * that could publish is not a thing that should exist in an inbox.
 *
 * WHO MAY CALL IT
 * The bot, which holds the publishable key and cannot prove who it is - so this cannot require a
 * session. Two things make that safe rather than a mail cannon: the recipient is a constant and
 * is never read from the request, and soc_digest_claim in the database allows one send per
 * interval. The worst available to a stranger is a duplicate copy of the owner's own digest.
 *
 * DEPLOYING IT - Gmail, sending as the show's own address
 *   1. console.cloud.google.com -> new project (or the existing one).
 *   2. APIs and Services -> Library -> enable **Gmail API**.
 *   3. OAuth consent screen -> External, add soldoutcomedy@gmail.com as a Test user.
 *      A test-user app is fine forever here; its refresh tokens do not expire for test users
 *      of an app in testing UNLESS the app is left unpublished for a long time - if sending
 *      starts failing with invalid_grant, redo step 5.
 *   4. Credentials -> Create OAuth client ID -> **Desktop app**. Keep the id and secret.
 *   5. Get a refresh token once, signed in as soldoutcomedy@gmail.com:
 *      - Visit, on one line, with your client id:
 *        https://accounts.google.com/o/oauth2/v2/auth?client_id=<ID>
 *          &redirect_uri=http://localhost&response_type=code
 *          &scope=https://www.googleapis.com/auth/gmail.send
 *          &access_type=offline&prompt=consent
 *      - Approve. The browser lands on a dead localhost page; copy `code` out of its address bar.
 *      - Trade it for a refresh token:
 *        curl -s -X POST https://oauth2.googleapis.com/token \
 *          -d client_id=<ID> -d client_secret=<SECRET> -d code=<CODE> \
 *          -d grant_type=authorization_code -d redirect_uri=http://localhost
 *      - `refresh_token` in the reply is the durable one. access_token is good for an hour and
 *        this function fetches a fresh one on every send, so it is not worth keeping.
 *   6. supabase secrets set GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... GMAIL_REFRESH_TOKEN=...
 *      supabase functions deploy soc-digest --no-verify-jwt
 *
 *      --no-verify-jwt matters. By default the gateway wants a JWT in Authorization, and the bot
 *      has only the publishable key - which is not one. Nothing is given away by turning it off
 *      here, because this function never trusted the caller in the first place: the recipient is
 *      a constant and soc_digest_claim is the brake. The other functions keep JWT verification,
 *      because they act on the caller's behalf and check who it is.
 *
 * gmail.send is the only scope asked for. It cannot read a mailbox, and it is the narrowest
 * scope Gmail offers that can put a message in one.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

/* Where it goes, and the only place it can go. Never from the request. */
const TO = 'kevinmkolb@gmail.com';
const QUEUE = 'https://www.soldoutcomedy.com/socializer/';

/* Minutes between sends. A daily bot trips this once; a stranger with the function URL trips it
   once and then gets nothing. */
const GAP = 20;

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

const need = (name: string): string => {
    const v = Deno.env.get(name);
    if (!v) throw new Error(`${name} is not set on this function.`);
    return v;
};

type Row = {
    id: number;
    post_url: string;
    headline: string;
    why: string;
    author: string;
    source: string;
    media_url: string;
    filed: string;
};

/* --- the email ------------------------------------------------------------------------- */

/* Everything printed goes through this. The rows hold text somebody else wrote - a stranger's
   post title - and it is being put into HTML, so it is escaped on the way in rather than trusted.
   The quote form matters too: these end up inside attribute values. */
const esc = (v: unknown) =>
    String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

const ruleLink = (id: number, to: 'POST' | 'SKIPPED') =>
    `${QUEUE}?rule=${encodeURIComponent(String(id))}&to=${to}`;

/* Inline styles and no layout cleverness: an email client is a browser from 2004 with opinions.
   Tables for structure, a solid background on each button so it reads as pressable, and padding
   big enough for a thumb. */
function button(href: string, label: string, bg: string, fg: string) {
    return `<a href="${esc(href)}" style="display:inline-block;padding:11px 18px;`
        + `background:${bg};color:${fg};border:2px solid #000;font-weight:700;font-size:13px;`
        + `letter-spacing:.5px;text-transform:uppercase;text-decoration:none;margin:0 6px 6px 0"`
        + `>${esc(label)}</a>`;
}

function card(r: Row) {
    const shot = r.media_url
        ? `<tr><td style="padding:0 0 10px"><img src="${esc(r.media_url)}" alt=""`
          + ` width="240" style="display:block;max-width:100%;height:auto;border:2px solid #000"></td></tr>`
        : '';

    /* The post's own words, then ours. Our caption is the thing that goes out, so it is the one
       set apart - reading the two together is how you decide in one look. */
    const said = r.headline
        ? `<tr><td style="padding:0 0 8px;font-size:15px;line-height:1.4;color:#000">`
          + `${esc(r.headline)}</td></tr>`
        : '';
    const ours = r.why
        ? `<tr><td style="padding:0 0 10px;font-size:14px;line-height:1.45;color:#333">`
          + `<b style="display:block;font-size:10px;letter-spacing:.5px;text-transform:uppercase;`
          + `color:#999">Our line</b>${esc(r.why)}</td></tr>`
        : `<tr><td style="padding:0 0 10px;font-size:13px;color:#b3541e">No caption written.</td></tr>`;

    const who = [r.author, r.source].filter(Boolean).map(esc).join(' &middot; ');

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
      style="border:2px solid #000;background:#fff;margin:0 0 14px">
      <tr><td style="padding:14px 16px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${shot}
          <tr><td style="padding:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.5px;
            text-transform:uppercase;color:#666">${who || 'Unattributed'}</td></tr>
          ${said}
          ${ours}
          <tr><td style="padding:4px 0 0">
            ${button(ruleLink(r.id, 'POST'), 'Post it', '#5ce08a', '#000')}
            ${button(ruleLink(r.id, 'SKIPPED'), 'Skip', '#ff6b6b', '#000')}
            ${button(r.post_url, 'See it', '#fff', '#000')}
          </td></tr>
        </table>
      </td></tr>
    </table>`;
}

function digest(rows: Row[], added: number | null) {
    const count = rows.length;
    const head = count
        ? `${count} candidate${count === 1 ? '' : 's'} waiting`
        : 'Nothing waiting';

    const intro = count
        ? `<p style="margin:0 0 18px;font-size:14px;color:#444">Post it or Skip it from here - the
           button opens the queue and does it. Neither one posts anything anywhere; that is still a
           press on the card.</p>`
        : `<p style="margin:0 0 18px;font-size:14px;color:#444">The bot ran and the queue is
           empty. Nothing to read.</p>`;

    const note = added === null ? ''
        : `<p style="margin:0 0 18px;font-size:13px;color:#666">This run added
           ${added} new one${added === 1 ? '' : 's'}.</p>`;

    return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
        style="background:#f4f4f4">
        <tr><td align="center" style="padding:22px 12px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560"
            style="width:560px;max-width:100%;font-family:Inter,Helvetica,Arial,sans-serif">
            <tr><td style="padding:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-.2px">
              SOLD OUT! &mdash; the queue</td></tr>
            <tr><td style="padding:0 0 16px;font-size:14px;color:#666">${esc(head)}</td></tr>
            <tr><td>${intro}${note}</td></tr>
            <tr><td>${rows.map(card).join('')}</td></tr>
            <tr><td style="padding:6px 0 0">
              ${button(QUEUE, 'Open the Socializer', '#000', '#fff')}
            </td></tr>
            <tr><td style="padding:16px 0 0;font-size:11px;line-height:1.5;color:#999">
              Sent by the SOC SOCIALIZER BOT after every run, so silence means something broke
              rather than nothing happened.</td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;
}

/* --- Gmail ----------------------------------------------------------------------------- */

/* base64url, and it has to be done over BYTES. btoa works a character at a time, so a caption
   with an em dash or an emoji in it would throw or mangle without encoding to UTF-8 first. */
function b64url(bytes: Uint8Array): string {
    let raw = '';
    for (const b of bytes) raw += String.fromCharCode(b);
    return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

const b64 = (bytes: Uint8Array): string => {
    let raw = '';
    for (const b of bytes) raw += String.fromCharCode(b);
    return btoa(raw);
};

/* A subject line is headers, which are ASCII. Anything else has to be announced, and RFC 2047 is
   how: =?UTF-8?B?<base64>?=. Kept to what it is for - a count and a few words - but encoded
   rather than assumed. */
function subjectHeader(text: string): string {
    // deno-lint-ignore no-control-regex
    if (/^[\x20-\x7E]*$/.test(text)) return text;
    return `=?UTF-8?B?${b64(new TextEncoder().encode(text))}?=`;
}

async function accessToken(): Promise<string> {
    const body = new URLSearchParams({
        client_id: need('GMAIL_CLIENT_ID'),
        client_secret: need('GMAIL_CLIENT_SECRET'),
        refresh_token: need('GMAIL_REFRESH_TOKEN'),
        grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.access_token) {
        /* invalid_grant here means the refresh token is dead - revoked, or the consent screen was
           left in testing too long. Step 5 of the header comment is how to get another. */
        throw new Error(`Google would not issue a token: ${out?.error ?? res.status}`
            + ` ${out?.error_description ?? ''}`.trimEnd());
    }
    return String(out.access_token);
}

async function send(subject: string, html: string) {
    const from = Deno.env.get('GMAIL_SENDER');
    const lines = [
        `To: ${TO}`,
        ...(from ? [`From: ${from}`] : []),  /* omitted, Gmail fills in the authorised account */
        `Subject: ${subjectHeader(subject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        /* The body base64'd separately and wrapped, so eight-bit characters in a caption cannot
           break the message no matter what the client does with it. */
        (b64(new TextEncoder().encode(html)).match(/.{1,76}/g) ?? []).join('\r\n'),
    ];
    const raw = b64url(new TextEncoder().encode(lines.join('\r\n')));

    const token = await accessToken();
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.id) {
        throw new Error(`Gmail refused it (${res.status}). ${out?.error?.message ?? ''}`.trimEnd());
    }
    return String(out.id);
}

/* --- the request ----------------------------------------------------------------------- */

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const body = await req.json().catch(() => null);
    /* What the run added, for one line of the email. Cosmetic and therefore safe to take from the
       request: it is printed as a number and nothing branches on it. */
    const added = Number.isInteger(body?.added) ? Number(body.added) : null;

    /* The brake. Claimed before anything is built, so a refused call costs one statement. */
    const { data: may, error: claimErr } = await supabase.rpc('soc_digest_claim', {
        p_gap_minutes: GAP,
    });
    if (claimErr) {
        return json({
            error: `Could not check the send interval: ${claimErr.message}`
                + ' Has tools/socializer-migration-22-digest.sql been run?',
        }, 500);
    }
    if (may !== true) {
        return json({ ok: false, skipped: `A digest went out less than ${GAP} minutes ago.` }, 429);
    }

    const { data, error } = await supabase.rpc('soc_pending');
    if (error) return json({ error: `Could not read the queue: ${error.message}` }, 500);

    const rows = (data ?? []) as Row[];
    const subject = rows.length
        ? `SOLD OUT! - ${rows.length} candidate${rows.length === 1 ? '' : 's'} waiting`
        : 'SOLD OUT! - nothing waiting';

    try {
        const id = await send(subject, digest(rows, added));
        return json({ ok: true, sent: id, candidates: rows.length });
    } catch (e) {
        return json({ error: (e as Error).message }, 502);
    }
});
