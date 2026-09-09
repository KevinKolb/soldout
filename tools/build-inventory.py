#!/usr/bin/env python3
"""
Regenerate assets/data/inventory.xml, which drives the item grid on shop/index.html.

Two sources, merged:

  1. The Ambassador table in Airtable. This is the curated list: a row per item,
     added by pasting an eBay URL into admin/crosslist.html. It decides WHICH
     items appear and in what order.
  2. The eBay influencer storefront. This supplies the facts we cannot get any
     other way - title, price, image, remaining quantity - because eBay serves
     individual /itm/ pages a 403 to anything that is not a real browser, while
     the storefront page still renders with a JSON payload of every card.

Airtable holds the intent, eBay holds the truth. A row whose item is also in the
storefront gets live title and price; anything typed into Airtable overrides it.

Runs without credentials: with no Airtable env vars it falls back to publishing
every storefront item, which is what a local `python tools/build-inventory.py` does.

Never empties inventory.xml on failure. A blocked request or a changed page
structure leaves the committed file in place, so the shop goes stale rather than
blank.

Env:
  AIRTABLE_API_KEY   personal access token, needs data.records:read
  AIRTABLE_BASE_ID   base holding the Ambassador table
  AIRTABLE_AMBASSADOR_TABLE  optional, defaults to "Ambassador"
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

STOREFRONT = "https://www.ebay.com/inf/soldoutcomedy"
OUT = Path(__file__).parent.parent / "assets" / "data" / "inventory.xml"
TABLE = os.environ.get("AIRTABLE_AMBASSADOR_TABLE", "Ambassador")

# eBay Partner Network attribution. Without these the link still works but the
# commission is not credited, so every generated link carries them.
EPN_PARAMS = {
    "mkcid": "1",
    "mkrid": "711-53200-19255-0",
    "siteid": "0",
    "campid": "5339205855",
    "toolid": "80008",
    "mkevt": "1",
}

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")


def item_id(url):
    """eBay item numbers are the 11-12 digit run after /itm/."""
    m = re.search(r"/itm/(?:[^/]+/)?(\d{9,15})", url or "")
    return m.group(1) if m else ""


def spans(node):
    if not isinstance(node, dict):
        return ""
    return "".join(s.get("text", "") for s in node.get("textSpans", [])
                   if isinstance(s, dict)).strip()


def get(url, headers, timeout=30):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def load_storefront():
    """Map of item id -> live facts, or {} if eBay will not serve us."""
    try:
        html = get(STOREFRONT, {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        })
    except Exception as e:
        print(f"  storefront unreachable ({e})")
        return {}

    found, seen = {}, set()
    decoder = json.JSONDecoder()
    for match in re.finditer(r'\{"_type":"CardContainer"', html):
        try:
            obj, _ = decoder.raw_decode(html[match.start():])
        except ValueError:
            continue
        for card in obj.get("cards", []):
            if not isinstance(card, dict):
                continue
            lid = card.get("listingId")
            if not lid or lid in seen:
                continue
            seen.add(lid)
            image = card.get("image") or {}
            price = (card.get("displayPrice") or {}).get("value") or {}
            found[lid] = {
                "title": spans(card.get("title")),
                # s-l300 is the thumbnail the storefront uses; the same asset at
                # s-l800 survives being rendered as a large square card.
                "image": (image.get("URL") or "").replace("/s-l300.", "/s-l800."),
                "price": f"{price['value']:.2f}" if isinstance(price.get("value"), (int, float)) else "",
                "condition": spans(card.get("quantity")),
            }
    print(f"  storefront: {len(found)} item(s)")
    return found


def load_airtable():
    """Curated rows, newest last. None means 'not configured', [] means 'empty'."""
    key = os.environ.get("AIRTABLE_API_KEY")
    base = os.environ.get("AIRTABLE_BASE_ID")
    if not key or not base:
        print("  Airtable not configured; using the whole storefront")
        return None

    rows, offset = [], None
    url = f"https://api.airtable.com/v0/{base}/{urllib.parse.quote(TABLE)}"
    try:
        while True:
            page = url + (f"?offset={offset}" if offset else "")
            body = json.loads(get(page, {"Authorization": f"Bearer {key}"}))
            rows.extend(body.get("records", []))
            offset = body.get("offset")
            if not offset:
                break
    except urllib.error.HTTPError as e:
        detail = "table not found" if e.code == 404 else f"HTTP {e.code}"
        print(f"  Airtable read failed ({detail}); using the whole storefront")
        return None
    except Exception as e:
        print(f"  Airtable read failed ({e}); using the whole storefront")
        return None

    print(f"  Airtable: {len(rows)} row(s) in {TABLE}")
    return rows


def build_items(store, rows):
    def link(iid, fallback):
        if not iid:
            return fallback
        return f"https://www.ebay.com/itm/{iid}?" + "&".join(
            f"{k}={v}" for k, v in EPN_PARAMS.items())

    # No curated list: publish everything on the storefront.
    if rows is None:
        return [{
            "title": v["title"] or f"eBay item {k}",
            "price": v["price"],
            "condition": v["condition"],
            "url": link(k, ""),
            "image": v["image"],
            "status": "active",
        } for k, v in store.items()]

    items = []
    for rec in rows:
        f = rec.get("fields", {})
        status = (f.get("Status") or "Active").strip().lower()
        if status == "hidden":
            continue
        src = f.get("Item URL") or ""
        iid = item_id(src)
        live = store.get(iid, {})
        title = (f.get("Title") or "").strip() or live.get("title") or (f"eBay item {iid}" if iid else "Untitled")
        price = (str(f.get("Price")) if f.get("Price") not in (None, "") else "") or live.get("price", "")
        image = (f.get("Image URL") or "").strip() or live.get("image", "")
        if not iid and not src:
            continue
        items.append({
            "title": title,
            "price": f"{float(price):.2f}" if _num(price) else "",
            "condition": (f.get("Condition") or "").strip() or live.get("condition", ""),
            "url": link(iid, src),
            "image": image,
            "status": "sold" if status == "sold" else "active",
        })
    return items


def _num(v):
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def render(items):
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           "<!--",
           "  GENERATED FILE - do not edit by hand; the next deploy overwrites it.",
           "  Built by tools/build-inventory.py from the Ambassador table in Airtable,",
           "  enriched with live title/price/image from the eBay influencer storefront.",
           "  To change what appears here, use the eBay Ambassador section of",
           "  admin/crosslist.html.",
           "-->",
           "<inventory>"]
    for it in items:
        out.append("  <item>")
        for key in ("title", "price", "condition", "url", "image", "status"):
            out.append(f"    <{key}>{escape(it[key])}</{key}>")
        out.append("    <platform>eBay</platform>")
        out.append("  </item>")
    out.append("</inventory>")
    return "\n".join(out) + "\n"


def main():
    print("Building shop inventory")
    store = load_storefront()
    rows = load_airtable()

    if not store and rows is None:
        print(f"nothing to build from; leaving {OUT.name} untouched")
        return 0

    items = build_items(store, rows)
    if not items:
        print(f"no publishable items; leaving {OUT.name} untouched")
        return 0

    OUT.write_text(render(items), encoding="utf-8")
    print(f"wrote {len(items)} item(s) to {OUT}")
    for it in items:
        print(f"  - [{it['status']}] {it['title'][:64]}  ${it['price'] or '?'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
