/* The Prop Shop, editable in place.
 *
 * Loaded by every visitor but inert for all of them: nothing below runs until Supabase
 * says the person looking at the page is the owner, and even then the database decides
 * what a save is allowed to do. Signed out, the page is exactly the static grid it has
 * always been.
 *
 * WHY THIS EDITS THE PAGE RATHER THAN REPLACING IT
 * The card you see is built from assets/data/inventory.xml, and that file is the only
 * place the enriched facts live - title, price, photo and remaining count are scraped
 * from the eBay storefront at deploy time, because eBay serves its item pages a 403 to
 * anything that is not a browser. A browser cannot reproduce any of that. So edit mode
 * keeps the published card as the thing on screen and attaches an editor to it, rather
 * than re-rendering from the table and losing everything eBay knows.
 *
 * The consequence, which the bar says out loud: a save lands in Supabase immediately
 * and reaches the public page at the next build, within six hours.
 */

import { currentUser, isOwner, signOut, supabase, OWNER } from '/assets/js/auth.js';

const TABLE = 'shop';

/* Cards carry the full tracking URL and rows carry the clean one, so neither matches
   the other as a string. The eBay item id is the part that is actually the same. */
function keyOf(url) {
    const m = String(url || '').match(/\/itm\/(?:[^/?]+\/)?(\d{9,15})/);
    return m ? m[1] : String(url || '').split('?')[0].replace(/\/+$/, '');
}

let rows = new Map();     // key -> the row in Supabase
let user = null;

/* The card is an <a>. In edit mode its href is taken off and kept here, because a
   textarea or an input inside an anchor is invalid HTML and browsers do what they
   like with it - clicking into the caption was activating the link and opening the
   listing. Nothing nested inside a link can be typed into reliably, so in edit mode
   the card stops being a link and the editor carries an explicit way out to eBay. */
/* The in-place editors live on elements a visitor also sees - the headline, the two
   chips, the source sticker - so hiding the edit box is not enough to make the public
   preview honest. Every one of them asks this first. */
function editingOff() {
    return document.body.classList.contains('viewing-public');
}

function cardUrl(card) {
    return card.dataset.href || card.getAttribute('href') || '';
}

function unlink(card) {
    if (card.dataset.href) return;
    const href = card.getAttribute('href');
    if (!href) return;
    card.dataset.href = href;
    card.removeAttribute('href');
}

/* ---------- styles, injected so the public page never carries them ---------- */
function injectStyles() {
    const css = `
    .edit-panel {
      position: fixed;
      top: calc(var(--topbar-h, 40px) + 10px);
      right: 12px;
      z-index: 30;
      width: 212px;
      display: flex; flex-direction: column; gap: 8px;
      background: var(--ink); color: var(--paper);
      border: var(--rule) solid var(--ink);
      box-shadow: 5px 5px 0 rgba(0, 0, 0, 0.25);
      padding: 10px;
      font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .edit-panel button {
      width: 100%;
      font-family: var(--mono); font-size: 0.6rem; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase;
      background: var(--acid); color: var(--ink);
      border: 2px solid var(--acid); padding: 7px 10px; cursor: pointer;
    }
    .edit-panel button.ghost { background: transparent; color: var(--paper); border-color: var(--paper); }

    /* A link that has to sit in a row of buttons without looking like the odd one. */
    .edit-panel .linkbtn {
      display: block; width: 100%; box-sizing: border-box; text-align: center;
      font-family: var(--mono); font-size: 0.6rem; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none;
      background: var(--acid); color: var(--ink);
      border: 2px solid var(--acid); padding: 7px 10px;
    }
    .edit-panel .linkbtn:hover { background: var(--paper); border-color: var(--paper); }

    .edit-panel .said {
      text-transform: none; letter-spacing: 0; font-family: var(--sans);
      font-size: 0.72rem; line-height: 1.4;
    }
    .edit-panel .said[hidden] { display: none; }

    /* Last, and quiet: useful to confirm once, not worth the top of the panel. */
    .edit-panel .who {
      text-transform: none; letter-spacing: 0; font-family: var(--sans);
      font-size: 0.66rem; opacity: 0.6; word-break: break-all;
      border-top: 2px solid rgba(255, 255, 255, 0.25); padding-top: 7px;
    }

    /* In the public preview everything but the switch goes: the rest acts on a page
       you are not currently looking at, and hanging a slab of controls over a
       visitor's-eye view defeats the point of the preview.

       The width does not change with it. Shrinking to fit the switch made the panel
       jump sideways on every flip, and the switch is the one thing that has to stay
       under the cursor - you flip it twice in a row more often than once. */
    body.viewing-public .edit-panel > *:not(.view-toggle) { display: none; }

    /* Too narrow for a column beside the grid, so it lies down under the header. */
    @media (max-width: 900px) {
      .edit-panel {
        left: 8px; right: 8px; width: auto;
        flex-direction: row; flex-wrap: wrap; align-items: center;
      }
      .edit-panel button, .edit-panel .linkbtn { width: auto; flex: 1 1 auto; }
      .edit-panel .who { border-top: 0; padding-top: 0; width: 100%; }
    }

    /* Backstage / public, the first item in the panel. Hard-edged, because nothing
       else on this page is rounded. */
    .view-toggle {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      cursor: pointer;
      border: 2px solid var(--paper); padding: 7px 9px;
      font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.1em;
      text-transform: uppercase; user-select: none;
    }
    .view-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
    .view-toggle .track {
      width: 40px; height: 20px; flex: none; position: relative;
      border: 2px solid var(--paper); background: transparent;
    }
    .view-toggle .knob {
      position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
      background: var(--acid); transition: transform 0.12s;
    }
    .view-toggle input:checked + .track .knob { transform: translateX(20px); }
    .view-toggle input:focus-visible + .track { outline: 2px solid var(--acid); outline-offset: 3px; }
    .view-toggle .lbl { opacity: 0.45; }
    .view-toggle .lbl.active { opacity: 1; }

    /* Previewing the public page. The editors are hidden rather than torn down, so
       flipping back does not have to rebuild anything. */
    body.viewing-public .editbox,
    body.viewing-public .pending,
    body.viewing-public .add-tile,
    body.viewing-public .add-panel { display: none; }

    /* Nothing offers itself for editing in the preview either - a hover that lights up
       is a promise, and in that mode it would be a false one. */
    body.viewing-public .cap-edit,
    body.viewing-public .tag-edit { cursor: inherit; }
    body.viewing-public .cap-edit:hover,
    body.viewing-public .tag-edit:hover,
    body.viewing-public .item-badge.tag-edit:hover { background: inherit; box-shadow: none; }

    /* The add tile keeps the grid's inverted treatment but spans the full width, so
       it always lands on a row of its own however many props there are - as a bar under
       them rather than a card pretending to be a prop. */
    .add-tile {
      grid-column: 1 / -1;
      flex-direction: row;
      align-items: center;
      gap: 0.9rem;
      min-height: 0;
      padding: 0.9rem 1.1rem;
      cursor: pointer;
      text-align: left;
    }
    .add-tile .cta-line { flex: 1; text-transform: none; letter-spacing: 0; font-family: var(--sans); }
    .add-tile .cta-arrow { font-size: 1.9rem; }

    .add-panel {
      border: var(--rule) solid var(--ink); background: var(--paper);
      padding: 14px; margin-bottom: var(--gap);
      display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    }
    .add-panel[hidden] { display: none; }
    .add-panel label {
      font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.14em;
      text-transform: uppercase; display: block; margin-bottom: 4px;
    }
    .add-panel input, .add-panel select,
    .editbox input, .editbox select, .editbox textarea {
      width: 100%; padding: 7px 8px; border: 2px solid var(--ink);
      font-family: var(--sans); font-size: 0.8rem; background: var(--paper); color: var(--ink);
    }
    .editbox textarea { min-height: 4.5em; resize: vertical; line-height: 1.45; }
    .add-panel .go { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; }
    .add-panel button {
      font-family: var(--mono); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; background: var(--ink); color: var(--paper);
      border: 2px solid var(--ink); padding: 8px 12px; cursor: pointer;
    }
    .add-panel button.ghost { background: var(--paper); color: var(--ink); }

    .editbox {
      border-top: 2px dashed var(--ink); margin-top: 0.6rem; padding-top: 0.6rem;
      display: grid; gap: 6px;
    }
    .editbox label {
      font-family: var(--mono); font-size: 0.5rem; letter-spacing: 0.12em;
      text-transform: uppercase; color: #555;
    }
    .editbox .row { display: flex; gap: 6px; }
    .editbox .row > * { flex: 1; min-width: 0; }
    .editbox button {
      font-family: var(--mono); font-size: 0.55rem; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; background: var(--ink); color: var(--paper);
      border: 2px solid var(--ink); padding: 6px 8px; cursor: pointer;
    }
    /* The same dashed rule the box opens with, so the original text sits bracketed
       between the two and the buttons read as their own business. */
    .editbox .states {
      display: flex;
      gap: 4px;
      border-top: 2px dashed var(--ink);
      padding-top: 0.6rem;
      margin-top: 0.2rem;
    }
    .editbox .states .state { flex: 1; background: var(--paper); color: var(--ink); }
    .editbox .states .state:hover:not(:disabled) { background: var(--acid); }
    .editbox .states .state[aria-pressed="true"] { background: var(--ink); color: var(--paper); }
    .editbox .states .state.danger { color: var(--red); border-color: var(--red); }
    .editbox .states .state.danger[aria-pressed="true"] { background: var(--red); color: var(--paper); }
    .editbox .visit {
      font-family: var(--mono); font-size: 0.55rem; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--ink); text-decoration: none; border-bottom: 2px solid var(--ink);
      align-self: flex-start; padding-bottom: 1px;
    }
    .editbox .visit:hover { background: var(--acid); }

    .editbox .note { font-family: var(--sans); font-size: 0.62rem; color: #555; }
    .editbox .note.bad { color: var(--red); font-weight: 700; }

    /* Tags edit where they sit. The two classification chips only ever hold one of
       two values, so a click swaps them and saves - a dropdown for a binary is more
       ceremony than the choice deserves. The source is free text, so it opens a field. */
    .tag-edit { cursor: pointer; }
    .tag-edit:hover { background: var(--acid); }
    .item-badge.tag-edit:hover { background: var(--paper); }

    /* No href in edit mode, so it should stop offering a pointer and stop lifting as
       though a click went somewhere. */
    .item-card:not([href]) { cursor: default; }
    .item-card:not([href]):hover { transform: none; box-shadow: none; }

    /* The tab, opposite the source sticker. Paper rather than acid so the two corners
       read as different kinds of label, and admin-only: this element is built here, so
       a visitor is never sent one. */
    .tab-badge {
      position: absolute;
      top: 0;
      right: 0;
      max-width: 70%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      background: var(--paper);
      color: var(--ink);
      border-left: var(--rule) solid var(--ink);
      border-bottom: var(--rule) solid var(--ink);
      padding: 4px 9px;
      font-family: var(--mono);
      font-size: 0.58rem;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      cursor: pointer;
    }
    .tab-badge:hover { background: var(--acid); }
    .tab-badge.is-empty { color: #999; }
    body.viewing-public .tab-badge { display: none; }
    .tag-edit.saving { opacity: 0.45; }
    .tag-edit.failed { background: var(--red); color: var(--paper); }
    .item-title.cap-edit { cursor: text; }
    .item-title.cap-edit:hover { background: var(--acid); }
    .title-input {
      width: 100%; font: inherit; font-weight: 700; line-height: 1.3;
      border: 0; outline: 2px solid var(--ink); padding: 2px 4px;
      background: var(--paper); color: var(--ink);
      resize: vertical; min-height: 3.4em;
    }

    .tag-input {
      font: inherit; letter-spacing: inherit; text-transform: inherit;
      width: 7em; padding: 0 2px; border: 0; outline: 2px solid var(--ink);
      background: var(--paper); color: var(--ink);
    }

    /* What eBay called it, kept visible while writing the replacement. Selectable so
       a phrase can be lifted out of it, but never editable: it is not ours to change. */
    .editbox .original {
      font-family: var(--sans); font-size: 0.7rem; line-height: 1.5; color: #555;
      user-select: text; -webkit-user-select: text;
    }

    .pending {
      border: var(--rule) dashed var(--ink); padding: 12px 14px; margin-bottom: var(--gap);
      font-family: var(--sans); font-size: 0.78rem; line-height: 1.6;
    }
    .pending[hidden] { display: none; }
    .pending b { font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.1em; text-transform: uppercase; }
    `;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
}

/* ---------- data ---------- */

/* A prop adopted straight off the storefront has no row yet - the build publishes it
   from eBay alone. The first edit is what creates one, so everything below can treat a
   row and a not-yet-row the same way. */
async function persist(row, patch) {
    if (row.id) {
        return supabase.from(TABLE).update(patch).eq('id', row.id).select().single();
    }
    return supabase.from(TABLE)
        .insert({ item_url: row.item_url, ...patch })
        .select().single();
}
async function loadRows() {
    const { data, error } = await supabase.from(TABLE).select('*').order('position', { ascending: true });
    if (error) {
        console.warn('[shop-edit] could not read the table:', error.message);
        return false;
    }
    rows = new Map(data.map(r => [keyOf(r.item_url), r]));
    return true;
}

async function save(row, patch, note) {
    note.textContent = 'Saving...';
    note.classList.remove('bad');
    const { data, error } = await persist(row, patch);
    if (error) {
        note.textContent = error.message.includes('row-level security')
            ? 'The database refused that. Signed in as the wrong account?'
            : error.message;
        note.classList.add('bad');
        return null;
    }
    rows.set(keyOf(data.item_url), data);
    note.textContent = 'Saved. Live on the public page at the next build.';
    return data;
}

/* ---------- the panel down the right ---------- */
/* It was a bar across the top of the listings, which put page-wide controls inside the
   grid's own header and scrolled them away as soon as you looked at anything. As a
   fixed panel it stays put, and the switch that changes what the whole page is sits at
   the top of it where it reads as the first decision rather than one more button.

   It hangs off the body, not the listings: position:fixed measures against the
   viewport, and an ancestor with a transform would quietly make it measure against
   that instead. */
function buildBar() {
    const listings = document.getElementById('listings');
    if (document.getElementById('editBar')) return;

    const bar = document.createElement('div');
    bar.className = 'edit-panel';
    bar.id = 'editBar';

    /* Empty in backstage mode - the per-card note already says what a save did, and
       edits are live now anyway. It still carries the public-preview message. */
    const said = document.createElement('span');
    said.className = 'said';
    said.hidden = true;

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = user.email;

    /* Straight out to the routine, where its runs, its logs and its schedule are.
       Its orders live in tools/prop-bot.md; this is where you watch it work. */
    const bot = document.createElement('a');
    bot.className = 'linkbtn';
    bot.href = 'https://claude.ai/code/routines/trig_01HzNErWquYbDdYY7eqRKXS2';
    bot.target = '_blank';
    bot.rel = 'noopener';
    bot.textContent = 'SOC PROP BOT';

    const saveAll = buildSaveAll(said);

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'ghost';
    out.textContent = 'Sign out';
    out.onclick = async () => { await signOut(); location.reload(); };

    /* The switch first: it decides which of the two pages you are looking at, and
       everything below it only makes sense in one of them. The message sits directly
       under Build, because that is the only thing that writes to it - a report belongs
       against the button that caused it, not at the top of the panel. */
    bar.append(buildViewToggle(said), bot, saveAll, said, out, who);
    document.body.appendChild(bar);
    trackHeaderHeight();

    const panel = buildAddPanel();

    const pending = document.createElement('div');
    pending.className = 'pending';
    pending.id = 'pendingNote';
    pending.hidden = true;

    listings.prepend(panel, pending);
    showPending();
}

/* Build. There is nothing left to save all of - every control on a card commits the
   moment it is used - so what this does is the half that actually matters. Nothing
   rebuilds on a schedule any more, and a prop listed on the eBay storefront does not
   reach the shop until a build reads the storefront, so this is the button that puts
   it there.

   The build is started by a Supabase Edge Function, not from here: it needs a GitHub
   token with actions:write, and a token in a static page is readable by everyone who
   loads the page. See supabase/functions/build-shop/index.ts. */
function buildSaveAll(said) {
    /* The message hides itself when empty, so writing to it has to say so - otherwise
       the build reports into an element nobody can see. */
    const say = text => { said.textContent = text; said.hidden = !text; };

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Build';

    btn.onclick = async () => {
        /* An editor still focused has not committed yet; blurring it does that first,
           so a half-typed caption is not left behind by the build. */
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();


        btn.disabled = true;
        const note = '';

        say('Starting a build...');
        const { data: built, error: buildError } = await supabase.functions.invoke('build-shop');

        btn.disabled = false;
        if (buildError || (built && built.error)) {
            const why = (built && built.error) || buildError.message || 'it did not say why';
            say(note + 'Build did not start: ' + why);
            setTimeout(() => say(''), 8000);
            return;
        }

        say(note + 'Build started. New props appear in a couple of minutes.');
        setTimeout(() => say(''), 8000);
    };

    return btn;
}

/* Flips the page between the editing view and what a visitor sees. The choice is
   remembered, because checking your own shop as a stranger sees it is something you
   do repeatedly, and having it reset on every load would make that tedious. */
const LS_VIEW = 'shop.view';

/* The header is sticky and its height changes when it wraps, so the panel is told
   where the bottom of it actually is rather than guessing at a number. */
function trackHeaderHeight() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const set = () => document.documentElement.style
        .setProperty('--topbar-h', bar.offsetHeight + 'px');
    set();
    addEventListener('resize', set);
}

function buildViewToggle(said) {
    const wrap = document.createElement('label');
    wrap.className = 'view-toggle';

    const back = document.createElement('span');
    back.className = 'lbl';
    back.textContent = 'Backstage';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'viewPublic';
    cb.setAttribute('aria-label', 'Preview the shop as the public sees it');

    const track = document.createElement('span');
    track.className = 'track';
    const knob = document.createElement('span');
    knob.className = 'knob';
    track.appendChild(knob);

    const pub = document.createElement('span');
    pub.className = 'lbl';
    pub.textContent = 'Public';

    const apply = () => {
        const publicView = cb.checked;
        document.body.classList.toggle('viewing-public', publicView);
        /* Previewing the public page means seeing what they see, hidden props
           included - which is to say, not included. */
        document.body.classList.toggle('show-hidden', !publicView);
        if (typeof renderGrid === 'function') renderGrid();
        back.classList.toggle('active', !publicView);
        pub.classList.toggle('active', publicView);
        /* Nothing to say in the preview - the lit half of the switch says which page
           this is, and the panel has collapsed to that switch anyway. */
        said.textContent = '';
        said.hidden = true;
        try { localStorage.setItem(LS_VIEW, publicView ? 'public' : 'backstage'); } catch { /* private mode */ }
    };

    cb.addEventListener('change', apply);
    try { cb.checked = localStorage.getItem(LS_VIEW) === 'public'; } catch { /* private mode */ }

    wrap.append(back, cb, track, pub);
    apply();
    return wrap;
}

function buildAddPanel() {
    const panel = document.createElement('div');
    panel.className = 'add-panel';
    panel.id = 'addPanel';
    panel.hidden = true;

    const field = (labelText, el) => {
        const wrap = document.createElement('div');
        const l = document.createElement('label');
        l.textContent = labelText;
        wrap.append(l, el);
        return wrap;
    };

    const url = document.createElement('input');
    url.type = 'text';
    url.placeholder = 'https://www.ebay.com/itm/...';

    const tab = document.createElement('input');
    tab.type = 'text';
    tab.placeholder = 'PUMPKIN SPICE';
    tab.setAttribute('list', 'tabList');

    const list = document.createElement('datalist');
    list.id = 'tabList';

    const caption = document.createElement('input');
    caption.type = 'text';
    caption.placeholder = 'Our own line about it';

    const go = document.createElement('div');
    go.className = 'go';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Add to the shop';
    const shut = document.createElement('button');
    shut.type = 'button';
    shut.className = 'ghost';
    shut.textContent = 'Close';
    shut.onclick = () => { panel.hidden = true; };

    const note = document.createElement('span');
    note.className = 'note';
    note.style.font = '0.72rem/1.5 Inter, system-ui, sans-serif';
    go.append(btn, shut, note);

    btn.onclick = async () => {
        const clean = url.value.trim().split('?')[0];
        if (!clean) { note.textContent = 'Paste the listing URL first.'; return; }
        note.textContent = 'Adding...';
        btn.disabled = true;

        const { error } = await supabase.from(TABLE).insert({
            item_url: clean,
            tab_tag: tab.value.trim(),
            blurb: caption.value.trim(),
            position: (Math.max(0, ...[...rows.values()].map(r => r.position || 0)) + 10)
        });
        btn.disabled = false;

        if (error) {
            note.textContent = error.message.includes('duplicate')
                ? 'That listing is already in the shop.'
                : error.message;
            return;
        }
        url.value = caption.value = '';
        note.textContent = 'Added. It appears on the page after the next build picks up its title and price from eBay.';
        await loadRows();
        showPending();
    };

    panel.append(field('Listing URL', url), field('Tab tag', tab), field('Caption', caption), list, go);
    return panel;
}

/* Rows added since the last build have no card to attach to, so they are named here
   rather than silently missing. */
function showPending() {
    const el = document.getElementById('pendingNote');
    if (!el) return;

    const onPage = new Set([...document.querySelectorAll('.item-card')].map(c => keyOf(cardUrl(c))));
    const waiting = [...rows.values()].filter(r => !onPage.has(keyOf(r.item_url)));

    const tabs = [...new Set([...rows.values()].map(r => r.tab_tag).filter(Boolean))];
    const list = document.getElementById('tabList');
    if (list) list.innerHTML = tabs.map(t => `<option value="${t}"></option>`).join('');

    if (!waiting.length) { el.hidden = true; return; }
    el.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = waiting.length + ' waiting for the next build';
    const p = document.createElement('div');
    p.textContent = waiting.map(r => r.item_url).join(', ')
        + ' - in the table but not on the page yet, because the title, price and photo '
        + 'are read from the eBay storefront at build time.';
    el.append(b, p);
    el.hidden = false;
}

/* ---------- tags, edited where they sit ---------- */

/* Writes one field and puts the chip back the way it was if the database says no.
   Shared by the cycling chips and the free-text source. */
async function saveTag(el, row, field, value) {
    const was = el.textContent;
    el.classList.remove('failed');
    el.classList.add('saving');

    const { data, error } = await persist(row, { [field]: value });

    el.classList.remove('saving');
    if (error) {
        el.textContent = was;
        el.classList.add('failed');
        el.title = error.message;
        setTimeout(() => el.classList.remove('failed'), 2000);
        return false;
    }
    rows.set(keyOf(data.item_url), data);
    Object.assign(row, data);
    return true;
}

/* Two values, so the chip is the switch. The tooltip names what a click will do,
   which is the whole of the affordance. */
function cyclingTag(el, row, field, values) {
    el.classList.add('tag-edit');

    const paint = () => {
        const current = row[field] || values[0];
        el.textContent = current;
        const next = values[(values.indexOf(current) + 1) % values.length];
        el.title = 'Click to make this ' + next;
    };

    el.addEventListener('click', async e => {
        if (editingOff()) return;
        e.preventDefault();
        e.stopPropagation();
        const current = row[field] || values[0];
        const i = values.indexOf(current);
        const next = values[(i + 1) % values.length];
        el.textContent = next;
        if (await saveTag(el, row, field, next)) paint();
    });

    paint();
}

/* The marketplace can be anything, so this one opens a field. Enter or clicking
   away commits, Escape abandons. */
function textTag(el, row, field, placeholder) {
    el.classList.add('tag-edit');
    el.title = placeholder ? 'Click to set' : 'Click to rename';

    const show = value => {
        el.textContent = value || placeholder || '';
        if (placeholder) el.classList.toggle('is-empty', !value);
    };

    el.addEventListener('click', e => {
        if (editingOff()) return;
        e.preventDefault();
        e.stopPropagation();
        if (el.dataset.editing) return;
        el.dataset.editing = '1';

        const was = row[field] || '';
        const input = document.createElement('input');
        input.className = 'tag-input';
        input.value = was;
        el.textContent = '';
        el.appendChild(input);
        input.focus();
        input.select();

        let done = false;
        const finish = async commit => {
            if (done) return;
            done = true;
            delete el.dataset.editing;
            const value = input.value.trim();
            const next = commit ? value : was;
            show(next);
            if (commit && value !== was) {
                if (!await saveTag(el, row, field, value)) show(was);
            }
        };

        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
        });
        input.addEventListener('click', ev => ev.stopPropagation());
    });
}

/* The headline is the caption when there is one, so it is also where the caption is
   written. Clicking it opens a box in the card rather than sending the eye to a field
   below the fold of the tile. Clearing it and saving hands the headline back to the
   marketplace's own title. */
function inlineCaption(el, row, pulled) {
    el.classList.add('cap-edit');
    el.title = 'Click to write what we call it';

    el.addEventListener('click', e => {
        if (editingOff()) return;
        e.preventDefault();
        e.stopPropagation();
        if (el.dataset.editing) return;
        el.dataset.editing = '1';

        const was = row.blurb || '';
        const box = document.createElement('textarea');
        box.className = 'title-input';
        box.value = was;
        box.placeholder = pulled;
        el.textContent = '';
        el.appendChild(box);
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);

        let done = false;
        const finish = async commit => {
            if (done) return;
            done = true;
            delete el.dataset.editing;
            const value = box.value.trim();

            if (!commit || value === was) {
                el.textContent = was || pulled;
                return;
            }
            el.textContent = value || pulled;
            if (!await saveTag(el, row, 'blurb', value)) el.textContent = was || pulled;
        };

        box.addEventListener('blur', () => finish(true));
        box.addEventListener('keydown', ev => {
            /* Enter commits, shift+Enter breaks the line - the caption is short enough
               that committing is the far commoner intent. */
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); box.blur(); }
            if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
        });
        box.addEventListener('click', ev => ev.stopPropagation());
    });
}

/* ---------- the editor on each card ---------- */
function decorate() {
    for (const card of document.querySelectorAll('.item-card')) {
        if (card.querySelector('.editbox')) continue;
        /* An adopted prop has no row. Rather than leaving it uneditable - which would
           make the commonest way of adding a prop the one you cannot touch - it gets a
           stub that the first save turns into a real row. */
        const key = keyOf(cardUrl(card));
        let row = rows.get(key);
        if (!row) {
            row = { id: null, item_url: cardUrl(card).split('?')[0], status: 'Active' };
            rows.set(key, row);
        }

        /* The chips and the sticker become their own controls. The sticker is left
           alone on a sold prop, where it reads "Sold" rather than the marketplace -
           editing it there would write the word Sold into tag_source. */
        const chips = card.querySelectorAll('.tag');
        if (chips[0]) cyclingTag(chips[0], row, 'tag_type', ['Commission', 'Owned']);
        if (chips[1]) cyclingTag(chips[1], row, 'tag_location', ['External', 'First-party']);

        const badge = card.querySelector('.item-badge');
        if (badge && String(row.status || 'Active').toLowerCase() !== 'sold') {
            textTag(badge, row, 'tag_source');
        }

        /* The tab, in the opposite corner. Built here rather than in the page's own
           renderer, so it exists only while someone is signed in. */
        const shot = card.querySelector('.shot');
        if (shot && !shot.querySelector('.tab-badge')) {
            const tabBadge = document.createElement('span');
            tabBadge.className = 'tab-badge';
            tabBadge.textContent = row.tab_tag || '+ tab';
            if (!row.tab_tag) tabBadge.classList.add('is-empty');
            textTag(tabBadge, row, 'tab_tag', '+ tab');
            shot.appendChild(tabBadge);
        }

        card._row = row;
        /* Not while previewing the public page: there the card should behave exactly
           as a visitor's does, link and all. */
        if (!document.body.classList.contains('viewing-public')) unlink(card);

        const box = document.createElement('div');
        box.className = 'editbox';

        /* The card is a link to the listing. Anything typed inside it would otherwise
           navigate away on the first click. */
        box.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });

        const note = document.createElement('div');
        note.className = 'note';

        /* Three states, three buttons, each one press. A dropdown plus a Save was two
           actions and a decision about which of them had actually taken; a lit button
           says what the prop is now. */
        const states = document.createElement('div');
        states.className = 'states';
        const buttons = {};

        const paint = current => {
            for (const [name, b] of Object.entries(buttons)) {
                b.setAttribute('aria-pressed', String(name === current));
            }
            card.classList.toggle('sold', current === 'Sold');
            card.classList.toggle('is-hidden', current === 'Hidden');
        };

        for (const state of ['Active', 'Sold', 'Hidden']) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'state' + (state === 'Hidden' ? ' danger' : '');
            b.textContent = state;
            b.onclick = async () => {
                const was = row.status || 'Active';
                if (state === was) return;
                paint(state);
                for (const x of Object.values(buttons)) x.disabled = true;
                const saved = await save(row, { status: state }, note);
                for (const x of Object.values(buttons)) x.disabled = false;
                paint(saved ? saved.status : was);
                if (saved) showPending();
            };
            buttons[state] = b;
            states.appendChild(b);
        }
        paint(row.status || 'Active');

        /* Whatever eBay called it. Once a caption is saved the headline shows the
           caption instead, so the pulled title is read here at decorate time and kept
           on the card - otherwise the second edit would have nothing to compare against. */
        const titleEl = card.querySelector('.item-title');
        let pulled = titleEl
            ? (card.getAttribute('title') || titleEl.dataset.pulled || titleEl.textContent)
            : '';

        /* The headline shows the caption once there is one, so reading it back off the
           card would eventually record our own words as the marketplace's. If they match,
           the headline is the caption and the original is not there to be read. */
        if (pulled.trim() && pulled.trim() === String(row.blurb || '').trim()) {
            pulled = titleEl && titleEl.dataset.pulled ? titleEl.dataset.pulled : '';
        }
        if (titleEl) {
            titleEl.dataset.pulled = pulled;
            inlineCaption(titleEl, row, pulled);
        }

        /* Always rendered, caption or no caption: it is the one thing on the card
           that is not ours, and knowing what the marketplace calls something is useful
           whether or not it has been overridden. */
        const original = document.createElement('div');
        original.className = 'original';
        original.textContent = pulled || 'Nothing came from the marketplace for this one.';

        /* Hidden is a state here, not a delete. The build republishes anything on the
           storefront that no row mentions, so removing the row would put the prop back
           at the next build - a Hidden row is what keeps it down, and it holds while
           the listing is still live on eBay. Which is also why the prop stays on screen
           stamped rather than vanishing: that is how you find it again to put it back. */
        /* The three buttons go last and unlabelled: ACTIVE, SOLD and HIDDEN say what
           they are, and a heading over them only repeated it. */
        const out = document.createElement('a');
        out.className = 'visit';
        out.href = cardUrl(card);
        out.target = '_blank';
        out.rel = 'noopener';
        out.textContent = 'Open the listing';

        box.append(original, out, states, note);
        card.querySelector('.body').appendChild(box);
    }
}

/* ---------- wiring ---------- */
async function start(u) {
    user = u;
    if (!isOwner(user)) return;

    injectStyles();
    document.body.classList.add('show-hidden');
    if (!await loadRows()) return;
    buildBar();
    decorate();
    addTile();
}

/* The last cell of the grid, in edit mode only. It was the storefront tile on the
   public page; a visitor gets no tile at all now, and the owner gets the one action
   worth having in reach of the props themselves - after them, where the grid ends
   and the eye already is. */
function addTile() {
    const grid = document.getElementById('itemGrid');
    const panel = document.getElementById('addPanel');
    if (!grid || !panel || grid.querySelector('.add-tile')) return;

    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'cta-card add-tile';

    const kicker = document.createElement('span');
    kicker.className = 'cta-kicker';
    kicker.textContent = 'Not enough junk?';

    const line = document.createElement('span');
    line.className = 'cta-line';
    line.textContent = 'Add a prop to the shop';

    const plus = document.createElement('span');
    plus.className = 'cta-arrow';
    plus.textContent = '+';

    tile.append(kicker, line, plus);
    tile.onclick = () => {
        panel.hidden = false;
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const first = panel.querySelector('input');
        if (first) first.focus();
    };

    grid.appendChild(tile);
}

/* The grid re-renders on every tab click, which throws the editors away with it. */
document.addEventListener('shop:rendered', () => {
    if (isOwner(user)) { decorate(); addTile(); showPending(); }
});

start(await currentUser());
