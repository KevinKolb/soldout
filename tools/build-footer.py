#!/usr/bin/env python3
"""
Inline the shared footer into every page that asks for one.

assets/footer.html stays the single source. This copies it into each page
between the footer:start / footer:end markers, so the committed HTML is
self-contained: no runtime fetch, nothing to cache incorrectly, and it works
over file:// as well as http.

An earlier version of this fetched the footer in the browser instead. That
looked tidier but made every HTTP cache a failure mode - a truncated response
cached against an unchanged ETag kept being served back on revalidation, and
the loader script itself could go stale independently of the markup it drove.
Generating the duplication is the better trade: the duplication is real, but it
is never hand-maintained and never out of sync after a build.

A page opts in by containing:

    <div id="site-footer">
    <!-- footer:start -->
    <!-- footer:end -->
    </div>

Pick a variant with data-footer on that div:

    full       everything - burst graphic, tagline, socials, store menu, bar
    no-stores  as above without the SHOP OUR STORES menu
    minimal    just the social icons above the white bottom bar

Variants are composed from the same source blocks, so a social link added to
footer.html reaches every page whatever variant it uses.

Run after editing assets/footer.html:  python tools/build-footer.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
SOURCE = ROOT / "assets" / "footer.html"
START = "<!-- footer:start -->"
END = "<!-- footer:end -->"

# Pages are found by scanning for the markers, so adding a footer to a new page
# needs no change here.
SEARCH_GLOBS = ("*.html", "*/*.html", "*/*/*.html")
SKIP_DIRS = {".git", "node_modules"}


def extract_div(html, opening):
    """Return the whole <div ...>...</div> starting at `opening`, brace-matched.

    Regex cannot do this reliably once the blocks nest, and the footer nests
    several deep, so count the tags instead.
    """
    i = html.index(opening)
    depth, j = 0, i
    while True:
        nxt_open = html.find("<div", j)
        nxt_close = html.find("</div>", j)
        if nxt_close == -1:
            raise ValueError(f"unbalanced markup after {opening!r}")
        if nxt_open != -1 and nxt_open < nxt_close:
            depth += 1
            j = nxt_open + 4
        else:
            depth -= 1
            j = nxt_close + 6
            if depth == 0:
                return html[i:j]


def variant_markup(footer, variant):
    """full = everything; no-stores = drop the shop menu; minimal = icons + bar."""
    if variant == "full":
        return footer

    if variant == "no-stores":
        menu = extract_div(footer, '<div class="shop-menu">')
        return footer.replace(menu, "").rstrip()

    if variant == "minimal":
        # Composed from the same source blocks rather than written out again, so
        # a social link added upstream still reaches the minimal pages.
        socials = extract_div(footer, '<div class="social-links">')
        bottom = extract_div(footer, '<div class="footer-bottom">')
        script = footer[footer.index("<script>"):] if "<script>" in footer else ""

        parts = [
            '<footer id="contact" class="footer-minimal">',
            indent(socials, 2),
            "</footer>",
            "",
            bottom,
        ]
        if script:
            parts += ["", script.strip()]
        return "\n".join(parts)

    raise ValueError(f"unknown footer variant {variant!r}")


def indent(block, spaces):
    pad = " " * spaces
    return "\n".join(pad + line if line.strip() else line for line in block.splitlines())


def mount_opts(html, index):
    """Read attributes off the enclosing #site-footer div."""
    before = html[:index]
    open_tag = before.rfind("<div id=\"site-footer\"")
    if open_tag == -1:
        return {}
    tag = html[open_tag:html.index(">", open_tag) + 1]
    return dict(re.findall(r'([a-z-]+)="([^"]*)"', tag))


def main():
    if not SOURCE.exists():
        print(f"missing {SOURCE}", file=sys.stderr)
        return 1

    footer = SOURCE.read_text(encoding="utf-8")
    # The source file's own explanatory header is not wanted in every page.
    footer = re.sub(r"^<!--.*?-->\s*", "", footer, count=1, flags=re.S).strip()

    seen = set()
    pages = []
    for pattern in SEARCH_GLOBS:
        for p in ROOT.glob(pattern):
            if p in seen or not p.is_file():
                continue
            if SKIP_DIRS & set(p.relative_to(ROOT).parts):
                continue
            seen.add(p)
            pages.append(p)

    changed = 0
    for page in sorted(pages):
        if page.resolve() == SOURCE.resolve():
            continue
        html = page.read_text(encoding="utf-8")
        if START not in html or END not in html:
            continue

        i, j = html.index(START), html.index(END)
        if j < i:
            print(f"  {page.relative_to(ROOT)}: markers out of order, skipped")
            continue

        opts = mount_opts(html, i)
        variant = opts.get("data-footer", "full")
        try:
            markup = variant_markup(footer, variant)
        except ValueError as e:
            print(f"  {page.relative_to(ROOT)}: {e}, skipped")
            continue

        block = (START + "\n<!-- generated from assets/footer.html - do not edit here -->\n"
                 + markup + "\n" + END)
        updated = html[:i] + block + html[j + len(END):]

        if updated != html:
            page.write_text(updated, encoding="utf-8")
            changed += 1
        print(f"  {page.relative_to(ROOT)}  [{variant}]")

    print(f"inlined the footer into {len(
        [p for p in pages if START in p.read_text(encoding='utf-8')])} page(s); "
        f"{changed} rewritten")
    return 0


if __name__ == "__main__":
    sys.exit(main())
