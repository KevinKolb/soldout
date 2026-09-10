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

/* The panel's one line of feedback, shared so anything can report into it. */
let saidEl = null;

function panelSay(text, ms = 5000) {
    if (!saidEl) return;
    saidEl.textContent = text;
    saidEl.hidden = !text;
    if (!text) return;
    setTimeout(() => {
        if (saidEl.textContent !== text) return;   // something newer has been said
        saidEl.textContent = '';
        saidEl.hidden = true;
    }, ms);
}

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
      width: 232px;
      display: flex; flex-direction: column; gap: 8px;
      background: var(--ink); color: var(--paper);
      border: var(--rule) solid var(--ink);
      box-shadow: 5px 5px 0 rgba(0, 0, 0, 0.25);
      padding: 10px;
      font-family: var(--mono); font-size: 0.78rem; letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .edit-panel button {
      width: 100%;
      font-family: var(--mono); font-size: 0.76rem; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase;
      background: var(--acid); color: var(--ink);
      border: 2px solid var(--acid); padding: 7px 10px; cursor: pointer;
    }
    .edit-panel button.ghost { background: transparent; color: var(--paper); border-color: var(--paper); }

    /* A link that has to sit in a row of buttons without looking like the odd one. */
    .edit-panel .linkbtn {
      display: block; width: 100%; box-sizing: border-box; text-align: center;
      font-family: var(--mono); font-size: 0.76rem; font-weight: 700;
      letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none;
      background: var(--acid); color: var(--ink);
      border: 2px solid var(--acid); padding: 7px 10px;
    }
    .edit-panel .linkbtn:hover { background: var(--paper); border-color: var(--paper); }

    /* Dashed, like the ghost tab: something to pick up and put somewhere, rather than
       something to press. */
    .edit-panel .bookmarklet {
      display: block; text-align: center; cursor: grab;
      font-family: var(--mono); font-size: 0.72rem; font-weight: 700;
      letter-spacing: 0.09em; text-transform: uppercase; text-decoration: none;
      color: var(--paper); border: 2px dashed var(--paper); padding: 7px 10px;
    }
    .edit-panel .bookmarklet:hover { background: var(--paper); color: var(--ink); }

    .edit-panel .said {
      text-transform: none; letter-spacing: 0; font-family: var(--sans);
      font-size: 0.82rem; line-height: 1.45;
    }
    .edit-panel .said[hidden] { display: none; }

    /* Last, and quiet: useful to confirm once, not worth the top of the panel. */
    .edit-panel .who {
      text-transform: none; letter-spacing: 0; font-family: var(--sans);
      font-size: 0.8rem; opacity: 0.6; word-break: break-all;
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
      font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.1em;
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
    body.viewing-public .editbox { display: none; }

    /* Nothing offers itself for editing in the preview either - a hover that lights up
       is a promise, and in that mode it would be a false one. */
    body.viewing-public .cap-edit,
    body.viewing-public .tag-edit { cursor: inherit; }
    body.viewing-public .cap-edit:hover,
    body.viewing-public .tag-edit:hover,
    body.viewing-public .item-badge.tag-edit:hover { background: inherit; box-shadow: none; }

    .add-modal {
      width: min(520px, calc(100vw - 2rem));
      border: var(--rule) solid var(--ink);
      background: var(--paper);
      color: var(--ink);
      box-shadow: 10px 10px 0 var(--ink);
      padding: 18px;
    }
    .add-modal::backdrop { background: rgba(17, 17, 17, 0.6); }
    .add-modal h3 {
      margin: 0 0 14px;
      font-family: var(--mono); font-size: 0.72rem; font-weight: 700;
      letter-spacing: 0.18em; text-transform: uppercase;
      border-bottom: 2px solid var(--ink); padding-bottom: 8px;
    }
    .add-fields {
      display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    }
    .add-modal label {
      font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.1em;
      text-transform: uppercase; display: block; margin-bottom: 4px;
    }
    .add-modal input, .add-modal select,
    .editbox input, .editbox select, .editbox textarea {
      width: 100%; padding: 7px 8px; border: 2px solid var(--ink);
      font-family: var(--sans); font-size: 0.8rem; background: var(--paper); color: var(--ink);
    }
    .editbox textarea { min-height: 4.5em; resize: vertical; line-height: 1.45; }
    .add-modal .go { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .add-modal button {
      font-family: var(--mono); font-size: 0.76rem; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; background: var(--ink); color: var(--paper);
      border: 2px solid var(--ink); padding: 8px 12px; cursor: pointer;
    }
    .add-modal button.ghost { background: var(--paper); color: var(--ink); }

    .editbox {
      border-top: 2px dashed var(--ink); margin-top: 0.6rem; padding-top: 0.6rem;
      display: grid; gap: 6px;
    }
    .editbox label {
      font-family: var(--mono); font-size: 0.68rem; letter-spacing: 0.09em;
      text-transform: uppercase; color: #555;
    }
    .editbox .row { display: flex; gap: 6px; }
    .editbox .row > * { flex: 1; min-width: 0; }
    .editbox button {
      font-family: var(--mono); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em;
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
    .editbox .note { font-family: var(--sans); font-size: 0.78rem; color: #555; }
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
    .price-link { cursor: pointer; }
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
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      cursor: pointer;
    }
    .tab-badge:hover { background: var(--acid); }
    .tab-badge.is-empty { color: #999; }
    .tab-badge.failed { background: var(--red); color: var(--paper); }
    body.viewing-public .tab-badge { display: none; }

    /* The select is the badge - no separate control, no second box to look at. */
    .tab-pick {
      font: inherit; letter-spacing: inherit; text-transform: inherit;
      color: inherit; background: transparent; border: 0; padding: 0;
      cursor: pointer; max-width: 100%;
    }
    .tab-pick:focus { outline: 2px solid var(--ink); outline-offset: 2px; }

    /* The source sticker, same treatment: the select is the badge. */
    .src-pick {
      font: inherit; letter-spacing: inherit; text-transform: inherit;
      color: inherit; background: transparent; border: 0; padding: 0;
      cursor: pointer; max-width: 100%;
    }
    .src-pick:focus, .chip-pick:focus { outline: 2px solid var(--ink); outline-offset: 2px; }

    /* The chips get the same treatment: the select is the chip, so a card does not
       sprout three boxes the moment you sign in. */
    .chip-pick {
      font: inherit; letter-spacing: inherit; text-transform: inherit;
      color: inherit; background: transparent; border: 0; padding: 0;
      cursor: pointer; max-width: 100%;
    }
    .tag.failed { background: var(--red); color: var(--paper); border-color: var(--red); }
    .item-badge.failed { background: var(--red); color: var(--paper); }

    /* Small, and hung off the tab's corner so it never crowds the label. */
    .tab { position: relative; }
    .tab[draggable="true"] { cursor: grab; }
    .tab[draggable="true"]:active { cursor: grabbing; }
    .tab.dragging { opacity: 0.4; }

    .item-card[draggable="true"] { cursor: grab; }
    .item-card.dragging { opacity: 0.4; }

    .tab-x {
      position: absolute;
      top: -7px;
      right: -7px;
      width: 15px;
      height: 15px;
      line-height: 11px;
      text-align: center;
      font-family: var(--sans);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      background: var(--paper);
      color: var(--ink);
      border: 2px solid var(--ink);
      cursor: pointer;
    }

    .tab-x:hover { background: var(--red); color: var(--paper); border-color: var(--red); }
    body.viewing-public .tab-x { display: none; }

    /* Dashed, so it reads as a slot rather than a tab with nothing in it. */
    .tab-new {
      border-style: dashed !important;
      background: transparent;
      opacity: 0.75;
    }
    .tab-new:hover { opacity: 1; }
    body.viewing-public .tab-new { display: none; }
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


    /* What eBay called it, kept visible while writing the replacement. Selectable so
       a phrase can be lifted out of it, but never editable: it is not ours to change. */
    .editbox .original {
      font-family: var(--sans); font-size: 0.7rem; line-height: 1.5; color: #555;
      user-select: text; -webkit-user-select: text;
    }

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

/* A listing sent here by the bookmarklet. The dialog opens with the URL already in
   it rather than filing the prop outright: a caption is worth writing while the listing
   is still in front of you, and a URL arriving from a bookmark is not the same as a
   decision to publish. The parameter is then wiped from the address bar, so a refresh
   does not open the dialog all over again. */
function openFromBookmarklet() {
    const asked = new URLSearchParams(location.search).get('add');
    if (!asked) return;

    const url = new URL(location.href);
    url.searchParams.delete('add');
    history.replaceState(null, '', url);

    const panel = document.getElementById('addPanel');
    if (!panel) return;

    const field = panel.querySelector('input');
    if (field) field.value = asked.split('?')[0];
    panel.showModal();

    /* The URL is already filled, so the useful thing to have under the cursor is the
       button that files it. */
    const go = panel.querySelector('button');
    if (go) go.focus();
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
    if (document.getElementById('editBar')) return;

    const bar = document.createElement('div');
    bar.className = 'edit-panel';
    bar.id = 'editBar';

    /* Empty in backstage mode - the per-card note already says what a save did, and
       edits are live now anyway. It still carries the public-preview message. */
    const said = document.createElement('span');
    said.className = 'said';
    said.hidden = true;
    saidEl = said;

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = user.email;

    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+ Add prop';

    /* A bookmarklet, so a listing can be sent here from eBay without copying its URL
       back and forth. It cannot write to Supabase itself: it runs on ebay.com, and the
       session that is allowed to write lives in this origin's storage, where a script
       on another domain cannot reach it - which is the point of it being there. So it
       carries the URL to this page and lets the page, already signed in, do the work.

       Dragged to the bookmarks bar, not clicked: pressed here it would file the shop. */
    const mark = document.createElement('a');
    mark.className = 'bookmarklet';
    /* This text becomes the bookmark's name once it is dragged, so it reads as the
       thing you are about to press on a listing rather than as an instruction that
       would then live in the bookmarks bar forever. */
    mark.textContent = 'FUNNY PRODUCT';
    mark.title = 'Drag to your bookmarks bar, then press it on any listing';
    mark.setAttribute('href',
        "javascript:(function(){location.href='" + location.origin
        + "/shop/?add='+encodeURIComponent(location.href)})()");
    mark.addEventListener('click', e => {
        e.preventDefault();
        panelSay('Drag it to your bookmarks bar. Then press it on any eBay listing.');
    });

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
    bar.append(buildViewToggle(said), add, mark, bot, saveAll, said, out, who);
    document.body.appendChild(bar);
    trackHeaderHeight();

    const panel = buildAddPanel();
    add.onclick = () => {
        panel.showModal();
        const first = panel.querySelector('input');
        if (first) first.focus();
    };

    document.body.appendChild(panel);
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
        publishExtraTabs();
        if (typeof buildTabs === 'function') buildTabs();
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

/* A real dialog rather than a panel above the grid. Inline, it pushed every prop
   down the moment it opened, and the form you were filling in and the grid you were
   filling it from were competing for the same screen. <dialog> also brings Escape,
   focus containment and a backdrop without any of it being written here. */
function buildAddPanel() {
    const panel = document.createElement('dialog');
    panel.className = 'add-modal';
    panel.id = 'addPanel';

    const head = document.createElement('h3');
    head.textContent = 'Add a prop';

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

    const go = document.createElement('div');
    go.className = 'go';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Add to the shop';
    const shut = document.createElement('button');
    shut.type = 'button';
    shut.className = 'ghost';
    shut.textContent = 'Close';
    shut.onclick = () => panel.close();

    const note = document.createElement('span');
    note.className = 'note';
    note.style.font = '0.72rem/1.5 Inter, system-ui, sans-serif';
    go.append(btn, shut, note);

    btn.onclick = async () => {
        const clean = url.value.trim().split('?')[0];
        if (!clean) { note.textContent = 'Paste the listing URL first.'; return; }
        note.textContent = 'Adding...';
        btn.disabled = true;

        /* No tab here. The prop has no card to file yet, and once it has one the
           picker in its corner is a better place to choose from than a text field
           that would let a typo become a second tab. */
        /* Hidden to begin with. A prop added here has no title, price or photo until
           a build reads them from the storefront, so publishing it straight away would
           put a blank card in front of a visitor. It arrives stamped HIDDEN in
           backstage, and you press ACTIVE when it looks right.

           No caption either: it is written on the card, where you can see the thing it
           is about. */
        const { error } = await supabase.from(TABLE).insert({
            item_url: clean,
            status: 'Hidden',
            position: (Math.max(0, ...[...rows.values()].map(r => r.position || 0)) + 10)
        });
        btn.disabled = false;

        if (error) {
            note.textContent = error.message.includes('duplicate')
                ? 'That listing is already in the shop.'
                : error.message;
            return;
        }
        url.value = '';
        note.textContent = 'Added, hidden. Build to pull its title and price from eBay, then press ACTIVE on the card.';
        await loadRows();
    };

    /* Clicking the backdrop is the other way people close these. The dialog element
       itself fills the viewport, so a click that lands on it rather than on the form
       inside is a click outside the form. */
    panel.addEventListener('click', e => { if (e.target === panel) panel.close(); });

    const form = document.createElement('div');
    form.className = 'add-fields';
    form.append(field('Listing URL', url), go);

    panel.append(head, form);
    return panel;
}

/* A tab exists only as a value on a row, so a name invented before any prop wears it
   would vanish the moment the page reloaded. These are kept in this browser until
   something is filed under them, which is what makes "+ NEW then pick it" work. */
const LS_TABS = 'shop.newTabs';
let extraTabs = [];

function loadExtraTabs() {
    try { extraTabs = JSON.parse(localStorage.getItem(LS_TABS) || '[]'); } catch { extraTabs = []; }
    if (!Array.isArray(extraTabs)) extraTabs = [];
}

function saveExtraTabs() {
    try { localStorage.setItem(LS_TABS, JSON.stringify(extraTabs)); } catch { /* private mode */ }
}

/* Hand the page the tabs that have nothing in them, so it draws them alongside the
   ones it found in the feed. Emptied in the public preview: a visitor's tab bar is
   only ever the tabs their props are actually in. */
function publishExtraTabs() {
    const used = new Set([...rows.values()].map(r => r.tab_tag).filter(Boolean));
    window.extraShopTabs = document.body.classList.contains('viewing-public')
        ? []
        : extraTabs.filter(t => !used.has(t));
}

/* Everything any prop actually carries in this field, plus the names we started with.
   The list grows on its own: the moment one prop is set to something new, every other
   prop's picker offers it. No list to maintain here as the shop expands past eBay and
   past commission. */
function valuesInUse(field, baseline) {
    const used = [...rows.values()].map(r => (r[field] || '').trim()).filter(Boolean);
    return [...new Set([...baseline, ...used])].sort((a, b) => a.localeCompare(b));
}

/* The three tags on a card are all the same problem: a small set of names that has to
   stay a small set. Typed by hand they drift - eBay and Ebay and ebay, Commission and
   commission - and each drift is a new value nothing else matches. So each one is a
   picker over what is already in use, with one way to add a name deliberately. */
function pickerTag(el, row, field, baseline, cls) {
    if (el.querySelector('select')) return;

    const sel = document.createElement('select');
    sel.className = cls;

    const current = (row[field] || baseline[0] || '').trim();
    for (const name of valuesInUse(field, baseline)) {
        const o = document.createElement('option');
        o.value = o.textContent = name;
        if (name === current) o.selected = true;
        sel.appendChild(o);
    }

    /* Without this the list could never gain an entry: a name only becomes an option
       once a prop already carries it. */
    const other = document.createElement('option');
    other.value = '__other';
    other.textContent = 'Something else...';
    sel.appendChild(other);

    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', async () => {
        let wanted = sel.value;
        if (wanted === '__other') {
            wanted = (prompt('What should this say?', '') || '').trim();
            if (!wanted) { sel.value = row[field] || baseline[0]; return; }
        }

        sel.disabled = true;
        const { error } = await commit(row, field, wanted);
        sel.disabled = false;

        if (error) {
            sel.value = row[field] || baseline[0];
            el.classList.add('failed');
            setTimeout(() => el.classList.remove('failed'), 2000);
            return;
        }
        /* A name just invented is now in use, so every other card should offer it. */
        if (typeof renderGrid === 'function') renderGrid();
    });

    el.textContent = '';
    el.appendChild(sel);
}

function knownTabs() {
    const used = [...rows.values()].map(r => r.tab_tag).filter(Boolean);
    return [...new Set([...used, ...extraTabs])];
}

/* ---------- tags, edited where they sit ---------- */

/* Writes one field and puts the chip back the way it was if the database says no.
   Shared by the cycling chips and the free-text source. */
async function commit(row, field, value) {
    const { data, error } = await persist(row, { [field]: value });
    if (error) return { error };
    rows.set(keyOf(data.item_url), data);
    Object.assign(row, data);
    return { data };
}

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
        const finish = async keep => {
            if (done) return;
            done = true;
            delete el.dataset.editing;
            const value = box.value.trim();

            if (!keep || value === was) {
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
    /* Nothing at all in the public preview. Guarding each editor individually left the
       classes and the tooltips on the card, which is most of what makes something look
       clickable - the preview is supposed to be a visitor's page, not a disabled copy
       of this one. */
    if (editingOff()) return;

    for (const card of document.querySelectorAll('.item-card')) {
        if (card.querySelector('.editbox')) continue;
        try {
            decorateCard(card);
        } catch (err) {
            /* One card that cannot be decorated used to take the rest of the grid with
               it - the loop stopped where it threw, so everything after the bad card
               stayed plain and it looked as though only the first prop was editable. */
            console.warn('[shop-edit] could not decorate a card:', cardUrl(card), err);
        }
    }
}

function decorateCard(card) {
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
        if (chips[0]) pickerTag(chips[0], row, 'tag_type', ['Commission', 'Owned'], 'chip-pick');
        if (chips[1]) pickerTag(chips[1], row, 'tag_location', ['External', 'First-party'], 'chip-pick');

        /* The source, on the photo. Left alone on a sold prop, where the sticker
           reads "Sold" rather than the marketplace - a picker there would write the
           word Sold into tag_source. */
        const badge = card.querySelector('.item-badge');
        if (badge && String(row.status || 'Active').toLowerCase() !== 'sold') {
            pickerTag(badge, row, 'tag_source', ['eBay'], 'src-pick');
        }

        /* The tab, in the opposite corner. Built here rather than in the page's own
           renderer, so it exists only while someone is signed in.

           A picker rather than a text field: tabs are a small shared set, and typing
           them by hand is how you end up with PUMPKIN SPICE and Pumpkin Spice as two
           different tabs. New names come from + NEW on the tab bar. */
        const shot = card.querySelector('.shot');
        if (shot && !shot.querySelector('.tab-badge')) {
            const tabBadge = document.createElement('span');
            tabBadge.className = 'tab-badge';
            if (!row.tab_tag) tabBadge.classList.add('is-empty');

            const pick = document.createElement('select');
            pick.className = 'tab-pick';

            /* Not "+ tab" - that read as an invitation to make one, when what it
               actually means is that this prop is in no tab and so turns up only under
               E'RYTHING. Naming the outcome beats naming the empty field. */
            const none = document.createElement('option');
            none.value = '';
            none.textContent = "E'RYTHING ONLY";
            pick.appendChild(none);

            for (const t of knownTabs()) {
                const o = document.createElement('option');
                o.value = o.textContent = t;
                if ((row.tab_tag || '') === t) o.selected = true;
                pick.appendChild(o);
            }

            pick.addEventListener('click', e => e.stopPropagation());
            pick.addEventListener('change', async () => {
                const wanted = pick.value;
                pick.disabled = true;
                const { error } = await commit(row, 'tab_tag', wanted);
                pick.disabled = false;
                if (error) {
                    pick.value = row.tab_tag || '';
                    tabBadge.classList.add('failed');
                    setTimeout(() => tabBadge.classList.remove('failed'), 2000);
                    return;
                }
                tabBadge.classList.toggle('is-empty', !wanted);
                /* The tab bar is built from the feed, not from the table, so writing
                   tab_tag to Supabase is not enough to make a tab appear up there.
                   applyLive re-reads the rows over the feed and rebuilds the bar. */
                if (typeof applyLive === 'function') applyLive();
            });

            tabBadge.appendChild(pick);
            shot.appendChild(tabBadge);
        }

        card._row = row;
        /* Not while previewing the public page: there the card should behave exactly
           as a visitor's does, link and all. */
        if (!document.body.classList.contains('viewing-public')) unlink(card);

        /* With the card unlinked there is nothing left to click through to the
           listing, so the price tag becomes the way there - it is the part of a card
           anyone would try anyway. Skipped in the preview, where the card is still a
           link and would open it the visitor's way. */
        const priceTag = card.querySelector('.price');
        if (priceTag && !editingOff() && !priceTag.dataset.linked) {
            priceTag.dataset.linked = '1';
            priceTag.classList.add('price-link');
            priceTag.title = 'Open the listing';
            priceTag.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                const url = cardUrl(card);
                if (url) window.open(url, '_blank', 'noopener');
            });
        }

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
            ? (card.dataset.pulled || titleEl.dataset.pulled || titleEl.textContent)
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
        box.append(original, states, note);
    card.querySelector('.body').appendChild(box);
}

/* ---------- wiring ---------- */
async function start(u) {
    user = u;
    if (!isOwner(user)) return;

    injectStyles();
    loadExtraTabs();
    publishExtraTabs();
    document.body.classList.add('show-hidden');
    if (!await loadRows()) return;
    /* Now the rows are known, drop any invented tab something is already filed under -
       the feed carries it from here. */
    publishExtraTabs();
    if (typeof buildTabs === 'function') buildTabs();
    buildBar();
    openFromBookmarklet();
    decorate();
    makeCardsDraggable();
    ghostTab();
    tabDeleters();
    makeTabsDraggable();
}

/* ---------- dragging props into order ----------
   The props on screen swap positions among themselves and nothing else moves. The slots
   are the positions those same props already occupy, sorted - so dragging inside one tab
   cannot disturb a prop in another, and the tab order, read off the same numbers, only
   changes if a prop actually crossed a tab boundary. */
let draggingCard = null;

async function persistPropOrder() {
    const grid = document.getElementById('itemGrid');
    if (!grid) return;

    const cards = [...grid.querySelectorAll('.item-card')].filter(c => c._row);
    if (cards.length < 2) return;

    const slots = cards.map(c => Number(c._row.position) || 0).sort((a, b) => a - b);
    /* A tab drag parks a whole tab on one number, so the slots can arrive equal.
       Spreading them stops the new order collapsing straight back into a tie. */
    for (let i = 1; i < slots.length; i++) {
        if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 5;
    }

    for (let i = 0; i < cards.length; i++) {
        const row = cards[i]._row;
        if (Number(row.position) === slots[i]) continue;
        const { error } = await commit(row, 'position', slots[i]);
        if (error) {
            panelSay('Could not save the order: ' + error.message);
            return;
        }
    }

    await loadRows();
    if (typeof applyLive === 'function') await applyLive();
    panelSay('Order saved.');
}

function makeCardsDraggable() {
    const grid = document.getElementById('itemGrid');
    if (!grid || document.body.classList.contains('viewing-public')) return;

    for (const card of grid.querySelectorAll('.item-card')) {
        if (card.dataset.drag) continue;
        card.dataset.drag = '1';
        card.draggable = true;

        card.addEventListener('dragstart', e => {
            /* A drag that starts in a field is the browser moving text, not the prop. */
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') {
                e.preventDefault();
                return;
            }
            draggingCard = card;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', cardUrl(card));
        });

        card.addEventListener('dragend', async () => {
            card.classList.remove('dragging');
            draggingCard = null;
            await persistPropOrder();
        });

        card.addEventListener('dragover', e => {
            if (!draggingCard || draggingCard === card) return;
            e.preventDefault();
            const box = card.getBoundingClientRect();
            /* A grid, so before means above, or left of on the same row. */
            const before = e.clientY < box.top + box.height / 2
                || (e.clientY < box.bottom && e.clientX < box.left + box.width / 2);
            grid.insertBefore(draggingCard, before ? card : card.nextSibling);
        });
    }
}

/* ---------- dragging tabs into order ----------
   The bar follows the feed, and the feed is ordered by each row's position - so tab
   order is already stored, in the props themselves. Dragging writes those positions
   rather than keeping a private list, which means the order a visitor sees is the
   order you arranged, not just the order in this browser.

   Props in the same tab end up sharing a position. Nothing is lost by that: the grid
   sorts by price, so position decides nothing except which tab comes first.

   A tab invented with + New has no props to carry its position, so its place is kept
   in this browser until something is filed under it. */
let draggingTab = null;
let justDragged = false;

function tabName(b) {
    return b.dataset.name !== undefined ? b.dataset.name : b.textContent.trim();
}

function orderedTabs(bar) {
    const allTab = typeof ALL_TAB === 'string' ? ALL_TAB : "E'RYTHING";
    return [...bar.querySelectorAll('.tab')]
        .filter(b => !b.classList.contains('tab-new') && tabName(b) !== allTab);
}

async function persistTabOrder() {
    const bar = document.getElementById('tabBar');
    if (!bar) return;

    const names = orderedTabs(bar).map(tabName);

    /* Invented tabs keep their place here, in the order they now appear. */
    extraTabs = names.filter(n => extraTabs.includes(n))
        .concat(extraTabs.filter(n => !names.includes(n)));
    saveExtraTabs();

    /* One block of numbers per tab, and the props inside keep the order they already
       had. Setting every prop in a tab to the same number would have moved the tab and
       thrown away the arrangement inside it. */
    let block = 1;
    for (const name of names) {
        const inTab = [...rows.values()].filter(r => (r.tab_tag || '') === name);
        if (!inTab.length) continue;
        inTab.sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));

        let n = 1;
        for (const row of inTab) {
            const want = block * 1000 + n * 10;
            n++;
            if (Number(row.position) === want) continue;
            const { error } = await commit(row, 'position', want);
            if (error) {
                panelSay('Could not save the tab order: ' + error.message);
                return;
            }
        }
        block++;
    }

    await loadRows();
    if (typeof applyLive === 'function') await applyLive();
    panelSay('Tab order saved.');
}

function makeTabsDraggable() {
    const bar = document.getElementById('tabBar');
    if (!bar || document.body.classList.contains('viewing-public')) return;

    for (const b of orderedTabs(bar)) {
        if (b.dataset.drag) continue;
        b.dataset.drag = '1';
        b.draggable = true;

        b.addEventListener('dragstart', e => {
            draggingTab = b;
            b.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            /* Firefox will not start a drag without something on the transfer. */
            e.dataTransfer.setData('text/plain', tabName(b));
        });

        b.addEventListener('dragend', async () => {
            b.classList.remove('dragging');
            draggingTab = null;
            /* The click that follows a drop would otherwise change the open tab. */
            justDragged = true;
            setTimeout(() => { justDragged = false; }, 0);
            await persistTabOrder();
        });

        b.addEventListener('dragover', e => {
            if (!draggingTab || draggingTab === b) return;
            e.preventDefault();
            const box = b.getBoundingClientRect();
            const before = e.clientX < box.left + box.width / 2;
            bar.insertBefore(draggingTab, before ? b : b.nextSibling);

            /* E'RYTHING stays first and + New stays last however far a tab is dragged. */
            const first = bar.firstElementChild;
            const allTab = typeof ALL_TAB === 'string' ? ALL_TAB : "E'RYTHING";
            if (first && tabName(first) !== allTab) {
                const home = [...bar.children].find(c => tabName(c) === allTab);
                if (home) bar.insertBefore(home, first);
            }
            const ghost = bar.querySelector('.tab-new');
            if (ghost) bar.appendChild(ghost);
        });

        b.addEventListener('click', e => {
            if (!justDragged) return;
            e.preventDefault();
            e.stopPropagation();
        }, true);
    }
}

/* Deleting a tab unfiles it. Every prop wearing it keeps its listing, its caption,
   its price and its place on the shop - it just stops being in that tab, which is the
   only thing the tab ever was. Nothing is hidden and nothing is removed.

   The x is a span rather than a button because it lives inside one, and a button
   inside a button is invalid HTML - the same trap the caption fell into inside the
   card's link. */
async function deleteTab(name) {
    const wearing = [...rows.values()].filter(r => (r.tab_tag || '') === name).length;
    const count = wearing === 1 ? '1 prop' : wearing + ' props';
    if (!confirm('Delete the tab ' + name + '?\n\n'
        + (wearing ? count + ' will stop being filed under it. Nothing is hidden or removed.'
                   : 'Nothing is filed under it.'))) return;

    if (wearing) {
        const { error } = await supabase.from(TABLE).update({ tab_tag: '' }).eq('tab_tag', name);
        if (error) {
            panelSay('Could not delete that tab: ' + error.message);
            return;
        }
    }

    extraTabs = extraTabs.filter(t => t !== name);
    saveExtraTabs();
    await loadRows();
    publishExtraTabs();

    if (typeof applyLive === 'function') await applyLive();
    if (typeof buildTabs === 'function') buildTabs();
    if (typeof renderGrid === 'function') renderGrid();

    panelSay(wearing
        ? name + ' deleted. Its ' + count + ' are still on the shop, just untagged.'
        : name + ' deleted.');
}

/* One x per real tab. Not on E'RYTHING, which is every prop rather than a tab, and not
   on + New, which is not one yet. */
function tabDeleters() {
    const bar = document.getElementById('tabBar');
    if (!bar) return;

    const allTab = typeof ALL_TAB === 'string' ? ALL_TAB : "E'RYTHING";

    for (const b of bar.querySelectorAll('.tab')) {
        if (b.classList.contains('tab-new')) continue;
        /* Read the name before the x is inside it, or the x becomes part of the name. */
        if (b.dataset.name === undefined) b.dataset.name = b.textContent.trim();
        const name = b.dataset.name;
        if (!name || name === allTab || b.querySelector('.tab-x')) continue;

        const x = document.createElement('span');
        x.className = 'tab-x';
        x.textContent = '\u00d7';
        x.title = 'Delete the tab ' + name;
        x.addEventListener('click', async e => {
            e.preventDefault();
            e.stopPropagation();
            await deleteTab(name);
        });
        b.appendChild(x);
    }
}

/* A tab that is not a tab yet. Clicking it names one, which then shows up in every
   card's picker - the only way to invent a tab, since a tab with nothing filed under
   it has nowhere else to live. It is not a filter: pressing it opens a prompt. */
function ghostTab() {
    const bar = document.getElementById('tabBar');
    if (!bar || bar.querySelector('.tab-new')) return;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab tab-new';
    b.textContent = '+ New';
    b.title = 'Name a new tab, then pick it on any prop';
    b.onclick = () => {
        const name = (prompt('Name the new tab') || '').trim();
        if (!name) return;
        const already = knownTabs().some(t => t.toLowerCase() === name.toLowerCase());
        if (!already) {
            extraTabs.push(name);
            saveExtraTabs();
        }

        /* Draw it straight away, empty. buildTabs redraws the bar from the feed plus
           whatever publishExtraTabs handed over; renderGrid rebuilds every card and
           every picker with it. */
        publishExtraTabs();
        if (typeof buildTabs === 'function') buildTabs();
        if (typeof renderGrid === 'function') renderGrid();

        panelSay(already
            ? name + ' already exists.'
            : name + ' added. Pick it on a prop to file something there.');
    };

    bar.appendChild(b);
}

/* The grid re-renders on every tab click, which throws the editors away with it. */
document.addEventListener('shop:rendered', () => {
    if (isOwner(user)) {
        decorate();
        makeCardsDraggable();
        ghostTab();
        tabDeleters();
        makeTabsDraggable();
    }
});

start(await currentUser());
