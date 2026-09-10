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

/* ---------- styles, injected so the public page never carries them ---------- */
function injectStyles() {
    const css = `
    .edit-bar {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
      background: var(--ink); color: var(--paper);
      border: var(--rule) solid var(--ink);
      padding: 10px 14px; margin-bottom: var(--gap);
      font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .edit-bar .spacer { flex: 1; }
    .edit-bar button {
      font-family: var(--mono); font-size: 0.6rem; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase;
      background: var(--acid); color: var(--ink);
      border: 2px solid var(--acid); padding: 6px 10px; cursor: pointer;
    }
    .edit-bar button.ghost { background: transparent; color: var(--paper); border-color: var(--paper); }
    .edit-bar .said { text-transform: none; letter-spacing: 0; font-family: var(--sans); }

    /* Backstage / public. A hard-edged switch rather than a rounded one, because
       nothing else on this page is rounded. */
    .view-toggle {
      display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
      font-family: var(--mono); font-size: 0.58rem; letter-spacing: 0.1em;
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

    /* The add tile borrows the grid's inverted card treatment, so it sits in the
       first cell as an action rather than looking bolted on. */
    .add-tile { cursor: pointer; text-align: left; }
    .add-tile .cta-line { text-transform: none; letter-spacing: 0; font-family: var(--sans); }

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
    .editbox .note { font-family: var(--sans); font-size: 0.62rem; color: #555; }
    .editbox .note.bad { color: var(--red); font-weight: 700; }

    /* Tags edit where they sit. The two classification chips only ever hold one of
       two values, so a click swaps them and saves - a dropdown for a binary is more
       ceremony than the choice deserves. The source is free text, so it opens a field. */
    .tag-edit { cursor: pointer; }
    .tag-edit:hover { background: var(--acid); }
    .item-badge.tag-edit:hover { background: var(--paper); }
    .tag-edit.saving { opacity: 0.45; }
    .tag-edit.failed { background: var(--red); color: var(--paper); }
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
    const { data, error } = await supabase.from(TABLE).update(patch).eq('id', row.id).select().single();
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

/* ---------- the bar across the top ---------- */
function buildBar() {
    const listings = document.getElementById('listings');
    if (document.getElementById('editBar')) return;

    const bar = document.createElement('div');
    bar.className = 'edit-bar';
    bar.id = 'editBar';

    const who = document.createElement('span');
    who.textContent = 'Editing as ' + user.email;

    const said = document.createElement('span');
    said.className = 'said';
    said.textContent = 'Saves reach the public page at the next build.';

    const spacer = document.createElement('span');
    spacer.className = 'spacer';

    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+ Add prop';

    const toggle = buildViewToggle(said);

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'ghost';
    out.textContent = 'Sign out';
    out.onclick = async () => { await signOut(); location.reload(); };

    bar.append(who, said, spacer, add, toggle, out);

    const panel = buildAddPanel();
    add.onclick = () => { panel.hidden = !panel.hidden; };

    const pending = document.createElement('div');
    pending.className = 'pending';
    pending.id = 'pendingNote';
    pending.hidden = true;

    listings.prepend(bar, panel, pending);
    showPending();
}

/* Flips the page between the editing view and what a visitor sees. The choice is
   remembered, because checking your own shop as a stranger sees it is something you
   do repeatedly, and having it reset on every load would make that tedious. */
const LS_VIEW = 'shop.view';

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
        back.classList.toggle('active', !publicView);
        pub.classList.toggle('active', publicView);
        said.textContent = publicView
            ? 'Previewing the public page. Nothing here is editable.'
            : 'Saves reach the public page at the next build.';
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
    const note = document.createElement('span');
    note.className = 'note';
    note.style.font = '0.72rem/1.5 Inter, system-ui, sans-serif';
    go.append(btn, note);

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

    const onPage = new Set([...document.querySelectorAll('.item-card')].map(c => keyOf(c.href)));
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

    const { data, error } = await supabase
        .from(TABLE).update({ [field]: value }).eq('id', row.id).select().single();

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
function textTag(el, row, field) {
    el.classList.add('tag-edit');
    el.title = 'Click to rename';

    el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (el.dataset.editing) return;
        el.dataset.editing = '1';

        const was = row[field] || el.textContent.trim();
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
            el.textContent = commit && value ? value : was;
            if (commit && value && value !== was) {
                if (!await saveTag(el, row, field, value)) el.textContent = was;
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

/* ---------- the editor on each card ---------- */
function decorate() {
    for (const card of document.querySelectorAll('.item-card')) {
        if (card.querySelector('.editbox')) continue;
        const row = rows.get(keyOf(card.href));
        if (!row) continue;

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

        const box = document.createElement('div');
        box.className = 'editbox';

        /* The card is a link to the listing. Anything typed inside it would otherwise
           navigate away on the first click. */
        box.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });

        const caption = document.createElement('textarea');
        caption.value = row.blurb || '';
        caption.rows = 3;
        caption.placeholder = "What we call it. Replaces eBay's title on the card.";

        const tab = document.createElement('input');
        tab.type = 'text';
        tab.value = row.tab_tag || '';
        tab.placeholder = 'Tab tag';
        tab.setAttribute('list', 'tabList');

        const status = document.createElement('select');
        for (const s of ['Active', 'Sold', 'Hidden']) {
            const o = document.createElement('option');
            o.value = o.textContent = s;
            if ((row.status || 'Active') === s) o.selected = true;
            status.appendChild(o);
        }

        const note = document.createElement('div');
        note.className = 'note';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Save';
        btn.onclick = async () => {
            btn.disabled = true;
            const saved = await save(row, {
                blurb: caption.value.trim(),
                tab_tag: tab.value.trim(),
                status: status.value
            }, note);
            btn.disabled = false;
            if (!saved) return;

            /* Show the change on the card straight away rather than waiting six hours
               to find out whether it took. */
            const title = card.querySelector('.item-title');
            if (title && saved.blurb) title.textContent = saved.blurb;
            card.classList.toggle('sold', saved.status === 'Sold');
            showPending();
        };

        const lab = t => { const l = document.createElement('label'); l.textContent = t; return l; };
        const row2 = document.createElement('div');
        row2.className = 'row';
        row2.append(tab, status);

        /* Whatever eBay called it. Once a caption is saved the headline shows the
           caption instead, so the pulled title is read here at decorate time and kept
           on the card - otherwise the second edit would have nothing to compare against. */
        const titleEl = card.querySelector('.item-title');
        const pulled = titleEl
            ? (card.getAttribute('title') || titleEl.dataset.pulled || titleEl.textContent)
            : '';
        if (titleEl) titleEl.dataset.pulled = pulled;

        const original = document.createElement('div');
        original.className = 'original';
        original.textContent = pulled;

        box.append(
            lab('Override name and caption'), caption,
            lab('Tab and status'), row2,
            lab('Original text'), original,
            btn, note
        );
        card.querySelector('.body').appendChild(box);
    }
}

/* ---------- wiring ---------- */
async function start(u) {
    user = u;
    if (!isOwner(user)) return;

    injectStyles();
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
