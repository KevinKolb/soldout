#!/usr/bin/env python3
"""
Regenerate assets/data/inventory.xml, which drives the item grid on shop/index.html.

Two sources, merged:

  1. The shop table in Supabase. This is the curated list: a row per item, added
     by hand. It decides WHICH items appear and how they are tagged. See
     tools/shop-schema.sql.
  2. The eBay influencer storefront. This supplies the facts we cannot get any
     other way - title, price, image, remaining quantity - because eBay serves
     individual /itm/ pages a 403 to anything that is not a real browser, while
     the storefront page still renders with a JSON payload of every card.

Supabase holds the intent, eBay holds the truth. A row whose item is also in the
storefront gets live title and price; anything set on the row overrides it. Only
eBay can be enriched, so a row from anywhere else has to carry its own title,
price and image or its card publishes blank.

Every column on a row ships as an element of the same name:

  tag_source    the marketplace it came from, e.g. eBay
  tag_type      how we get paid: Commission, or Owned
  tag_location  whose stock it is: External, or First-party
  tab_tag       groups items into the shop's tabs; never printed on a card
  blurb         our own caption; replaces eBay's title on the card when set

The three tag_ columns default to eBay / Commission / External in the schema,
which is what every row is today, so a row that sets none of them still
publishes correctly.

Needs no secret. Reading the shop table is a public select policy and the
publishable key below is the same one committed in admin/socializer.html, so a
local run and the deploy run see exactly the same rows. SUPABASE_URL and
SUPABASE_KEY override it if the project ever moves.

Never empties inventory.xml on failure. A blocked request or a changed page
structure leaves the committed file in place, so the shop goes stale rather than
blank. If Supabase cannot be read at all it falls back to publishing every
storefront item, which is better than publishing none.

Env (all optional):
  SUPABASE_URL         defaults to the SOLD OUT! project
  SUPABASE_KEY         publishable key; the committed default is public by design
  SUPABASE_SHOP_TABLE  defaults to "shop"
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

# The publishable key is the public half of the pair and is already committed in
# admin/socializer.html. What it may do lives in the RLS policies in
# tools/shop-schema.sql, which for this table is select and nothing else.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://tjteeqofqozmncfoiofy.supabase.co").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_AHzqW00erP1wModfz3mzVA_dxM6RtPr")
TABLE = os.environ.get("SUPABASE_SHOP_TABLE", "shop")

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


def load_supabase():
    """Curated rows in publishing order. None means 'could not read at all'."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("  Supabase not configured; using the whole storefront")
        return None

    query = urllib.parse.urlencode({
        "select": "*",
        "order": "position.asc,created_at.asc",
    })
    url = f"{SUPABASE_URL}/rest/v1/{urllib.parse.quote(TABLE)}?{query}"
    try:
        rows = json.loads(get(url, {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Accept": "application/json",
        }))
    except urllib.error.HTTPError as e:
        detail = {
            401: "the key or the select policy is wrong",
            403: "the key or the select policy is wrong",
            404: f"no such table; run tools/shop-schema.sql to create {TABLE}",
        }.get(e.code, f"HTTP {e.code}")
        print(f"  Supabase read failed ({detail}); using the whole storefront")
        return None
    except Exception as e:
        print(f"  Supabase read failed ({e}); using the whole storefront")
        return None

    if not isinstance(rows, list):
        print("  Supabase returned something other than a list of rows")
        return None

    print(f"  Supabase: {len(rows)} row(s) in {TABLE}")
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
            "tag_source": "eBay",
            "tag_type": "Commission",
            "tag_location": "External",
            "tab_tag": "",
            "blurb": "",
        } for k, v in store.items()]

    items = []
    for f in rows:
        status = str(f.get("status") or "Active").strip().lower()
        if status == "hidden":
            continue
        src = f.get("item_url") or ""
        iid = item_id(src)
        live = store.get(iid, {})
        title = (f.get("title") or "").strip() or live.get("title") or (f"eBay item {iid}" if iid else "Untitled")
        # PostgREST returns numeric as a string, which _num already handles.
        price = (str(f.get("price")) if f.get("price") not in (None, "") else "") or live.get("price", "")
        image = (f.get("image_url") or "").strip() or live.get("image", "")
        if not iid and not src:
            continue
        items.append({
            "title": title,
            "price": f"{float(price):.2f}" if _num(price) else "",
            "condition": (f.get("condition") or "").strip() or live.get("condition", ""),
            "url": link(iid, src),
            "image": image,
            "status": "sold" if status == "sold" else "active",
            "tag_source": (f.get("tag_source") or "").strip() or "eBay",
            "tag_type": (f.get("tag_type") or "").strip() or "Commission",
            "tag_location": (f.get("tag_location") or "").strip() or "External",
            "tab_tag": (f.get("tab_tag") or "").strip(),
            "blurb": (f.get("blurb") or "").strip(),
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
           "  Built by tools/build-inventory.py from the shop table in Supabase,",
           "  enriched with live title/price/image from the eBay influencer storefront.",
           "  To change what appears here, edit the shop table in Supabase.",
           "-->",
           "<inventory>"]
    for it in items:
        out.append("  <item>")
        for key in ("title", "price", "condition", "url", "image", "status",
                    "tag_source", "tag_type", "tag_location", "tab_tag", "blurb"):
            out.append(f"    <{key}>{escape(it[key])}</{key}>")
        out.append("  </item>")
    out.append("</inventory>")
    return "\n".join(out) + "\n"


def main():
    print("Building shop inventory")
    store = load_storefront()
    rows = load_supabase()

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
        print(f"  - [{it['status']}] {it['tag_source']}: {it['title'][:56]}  ${it['price'] or '?'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
