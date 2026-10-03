#!/usr/bin/env python3
"""Find a photo for every PROP POOL candidate that has none.

The SOC PROP BOT never has a photo to save: eBay serves its /itm/ pages a 403 to
anything that is not a browser, and the bot is told not to invent one. So every
row in prop_candidates arrives with image_url empty, and PROP POOL shows blank
frames.

This runs in the daily build instead, from GitHub's own runners, which eBay does
serve - the same reason build-inventory.py can read the storefront. For each NEW
candidate with no image_url it reads the listing page's og:image - or, if eBay
refuses that page, the thumbnail from eBay's search results for that item number -
and writes the results to assets/data/pool-images.json, keyed by item_key. PROP POOL reads that
file and uses it wherever a row's own image_url is empty.

It writes nothing to Supabase. Updating prop_candidates is the owner's alone
under its row-level security, and a file built here needs no new permission.

Photos already found are carried over from the deployed copy of the file, so a
day's build only fetches the candidates that are new since yesterday. Never
fails the build: any error leaves whatever it managed to find.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SUPABASE_URL = "https://tjteeqofqozmncfoiofy.supabase.co"
SUPABASE_KEY = "sb_publishable_AHzqW00erP1wModfz3mzVA_dxM6RtPr"
LIVE = "https://www.soldoutcomedy.com/assets/data/pool-images.json"
OUT = Path(__file__).parent.parent / "assets" / "data" / "pool-images.json"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")


def get(url, headers=None, timeout=15):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def candidates():
    """NEW rows only - nothing else is ever shown in the pool."""
    url = (f"{SUPABASE_URL}/rest/v1/prop_candidates"
           "?status=eq.NEW&select=item_key,item_url,image_url")
    return json.loads(get(url, {"apikey": SUPABASE_KEY,
                                "Authorization": f"Bearer {SUPABASE_KEY}"}))


def previous():
    try:
        data = json.loads(get(LIVE, {"User-Agent": UA}))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


PAGE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}
EBAYIMG = r'https://i\.ebayimg\.com/images/g/[A-Za-z0-9_~-]+/s-l\d+\.(?:jpg|jpeg|png|webp)'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # A search for an exact item number can bounce straight to the listing page,
    # which is the one page eBay refuses - so the bounce is treated as a miss.
    def redirect_request(self, *args, **kwargs):
        return None


def sized(url):
    # The card is about 300px wide; the full-size asset is wasted bandwidth.
    return re.sub(r"/s-l\d+\.", "/s-l500.", url)


def from_listing(item_url):
    html = get(item_url, PAGE_HEADERS)
    m = (re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html)
         or re.search(f"({EBAYIMG})", html))
    return sized(m.group(1)) if m else ""


def from_search(item_id):
    """eBay serves its search results more freely than listing pages, and every
    result carries a thumbnail. Take the one from the result for this item."""
    req = urllib.request.Request(
        f"https://www.ebay.com/sch/i.html?_nkw={item_id}", headers=PAGE_HEADERS)
    with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as r:
        html = r.read().decode("utf-8", "replace")
    at = html.find(f"/itm/{item_id}")
    if at < 0:
        return ""
    # The thumbnail sits in the same result card as the link, a little before it.
    m = re.search(f"({EBAYIMG})", html[max(0, at - 4000):at + 4000])
    return sized(m.group(1)) if m else ""


def photo(item_url, item_id):
    """Listing page first, then search. Raises only if both were refused."""
    try:
        return from_listing(item_url)
    except urllib.error.HTTPError as e:
        first = e
    try:
        return from_search(item_id)
    except urllib.error.HTTPError:
        raise first


def main():
    print("Finding PROP POOL photos")
    try:
        rows = candidates()
    except Exception as e:
        print(f"  could not read prop_candidates ({e}); leaving the pool as it is")
        return
    known = previous()
    out, fetched, found, blocked = {}, 0, 0, 0

    for row in rows:
        key, url = row.get("item_key") or "", row.get("item_url") or ""
        if not key or row.get("image_url"):
            continue
        if known.get(key):
            out[key] = known[key]
            continue
        if not url.startswith("https://www.ebay.com/itm/"):
            continue
        # Three refusals in a row means eBay is turning this runner away; asking
        # for the rest would only be refused too.
        if blocked >= 3:
            break
        fetched += 1
        try:
            img = photo(url, url.rsplit("/", 1)[-1])
            blocked = 0
        except urllib.error.HTTPError as e:
            blocked = blocked + 1 if e.code in (403, 429) else 0
            print(f"  {key}: HTTP {e.code}")
            continue
        except Exception as e:
            print(f"  {key}: {e}")
            continue
        if img:
            out[key] = img
            found += 1
        time.sleep(0.5)

    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"  {len(rows)} NEW candidate(s); fetched {fetched} listing page(s), "
          f"found {found} new photo(s); {len(out)} photo(s) in {OUT.name}")
    if blocked >= 3:
        print("  stopped early: eBay refused three listing pages in a row")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"  pool images failed ({e})", file=sys.stderr)
