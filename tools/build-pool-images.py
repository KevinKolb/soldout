#!/usr/bin/env python3
"""Find a photo for every PROP POOL candidate that has none.

The SOC PROP BOT can rarely save a photo itself: eBay turns automated visitors away
from its listing pages, and the bot is told not to guess. So most rows in
prop_candidates arrive with image_url empty, and PROP POOL would show blank frames.

This runs in the daily build and asks eBay's official Browse API instead, which
answers a registered app rather than turning it away. (Scraping the listing page or
eBay's search results was tried first, from GitHub's runners; eBay refused both.)
For each NEW candidate with no image_url it writes the listing's main photo to
assets/data/pool-images.json, keyed by item_key. PROP POOL reads that file and uses
it wherever a row's own image_url is empty.

Needs two repository secrets, from a free eBay developer account's production
keyset: EBAY_CLIENT_ID (the App ID) and EBAY_CLIENT_SECRET (the Cert ID). Without
them it skips, carrying over whatever photos the deployed file already had.

It writes nothing to Supabase - updating prop_candidates is the owner's alone under
its row-level security, and a file built here needs no new permission. Photos
already found are carried over from the deployed copy of the file, so a day's build
only asks about candidates that are new since yesterday. Never fails the build.
"""

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SUPABASE_URL = "https://tjteeqofqozmncfoiofy.supabase.co"
SUPABASE_KEY = "sb_publishable_AHzqW00erP1wModfz3mzVA_dxM6RtPr"
LIVE = "https://www.soldoutcomedy.com/assets/data/pool-images.json"
OUT = Path(__file__).parent.parent / "assets" / "data" / "pool-images.json"

EBAY_TOKEN = "https://api.ebay.com/identity/v1/oauth2/token"
EBAY_BROWSE = "https://api.ebay.com/buy/browse/v1/item"


def request(url, headers=None, data=None, timeout=20):
    req = urllib.request.Request(url, headers=headers or {}, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def candidates():
    """NEW rows only - nothing else is ever shown in the pool."""
    return request(
        f"{SUPABASE_URL}/rest/v1/prop_candidates?status=eq.NEW&select=item_key,item_url,image_url",
        {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})


def previous():
    try:
        data = request(LIVE, {"User-Agent": "soldout-build"})
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def app_token(client_id, secret):
    """An application token: it can read public listings and nothing else."""
    basic = base64.b64encode(f"{client_id}:{secret}".encode()).decode()
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "scope": "https://api.ebay.com/oauth/api_scope",
    }).encode()
    return request(EBAY_TOKEN, {
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/x-www-form-urlencoded",
    }, body)["access_token"]


def sized(url):
    # The card is about 300px wide; the full-size asset is wasted bandwidth.
    return re.sub(r"/s-l\d+\.", "/s-l500.", url or "")


def photo(token, item_id):
    """The listing's main photo, or '' if eBay has none to give (ended, removed)."""
    headers = {"Authorization": f"Bearer {token}", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"}
    try:
        item = request(f"{EBAY_BROWSE}/get_item_by_legacy_id?legacy_item_id={item_id}", headers)
        return sized((item.get("image") or {}).get("imageUrl"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return ""
        if e.code != 400:
            raise
    # A 400 here is almost always a listing with variations (sizes, colours), which
    # this endpoint will not answer for by its plain item number. The same number is
    # its item group id, and every variation in the group carries the listing photo.
    try:
        group = request(f"{EBAY_BROWSE}/get_items_by_item_group?item_group_id={item_id}", headers)
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return ""
        raise
    for item in group.get("items") or []:
        url = (item.get("image") or {}).get("imageUrl")
        if url:
            return sized(url)
    return ""


def main():
    print("Finding PROP POOL photos")
    known = previous()
    try:
        rows = candidates()
    except Exception as e:
        print(f"  could not read prop_candidates ({e}); leaving the pool as it is")
        return

    client_id = os.environ.get("EBAY_CLIENT_ID", "").strip()
    secret = os.environ.get("EBAY_CLIENT_SECRET", "").strip()
    token = None
    if client_id and secret:
        try:
            token = app_token(client_id, secret)
        except Exception as e:
            print(f"  eBay would not issue a token ({e}); check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET")
    else:
        print("  EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set; carrying over known photos only")

    out, asked, found, missing = {}, 0, 0, 0
    for row in rows:
        key = row.get("item_key") or ""
        if not key or row.get("image_url"):
            continue
        if known.get(key):
            out[key] = known[key]
            continue
        if not token or not key.isdigit():
            continue
        asked += 1
        try:
            img = photo(token, key)
        except Exception as e:
            print(f"  {key}: {e}")
            continue
        if img:
            out[key] = img
            found += 1
        else:
            missing += 1

    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"  {len(rows)} NEW candidate(s); asked eBay about {asked}, found {found} photo(s), "
          f"{missing} with none (ended or removed); {len(out)} photo(s) in {OUT.name}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"  pool images failed ({e})", file=sys.stderr)
