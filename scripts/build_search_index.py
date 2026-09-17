#!/usr/bin/env python3
"""
Builds data/search-index.json — a flat, site-wide text index used by the
search box on every page so a query can find content on ANY page, not just
the one you're currently viewing.

Run this manually after adding/editing static page content:
    python3 scripts/build_search_index.py

Note: entries for data/opportunities.json are baked in at build time too,
so opportunities published later via the /admin/ CMS won't be searchable
site-wide until this script is re-run.
"""
import json
import re
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://danmuzata.github.io"

INDEX_SELECTOR = (
    "section h2, section h3, section p, section li, "
    ".quote-card blockquote, .highlight-slide-body h3, .highlight-slide-body p"
)
MAIN_SELECTOR = "main h1, main h2, main h3, main p, main li"


def page_title(soup, fallback):
    if soup.title and soup.title.string:
        return soup.title.string.split("|")[0].strip()
    return fallback


def extract_text(html_path, selector):
    soup = BeautifulSoup(html_path.read_text(encoding="utf-8"), "html.parser")
    bits = [el.get_text(" ", strip=True) for el in soup.select(selector)]
    text = " ".join(b for b in bits if b)
    text = re.sub(r"\s+", " ", text).strip()
    return soup, text


def build():
    pages = []

    # Homepage
    soup, text = extract_text(ROOT / "index.html", INDEX_SELECTOR)
    pages.append({
        "url": f"{SITE_URL}/index.html",
        "title": page_title(soup, "Danny Muzata"),
        "text": text,
    })

    # Resources
    soup, text = extract_text(ROOT / "resources.html", MAIN_SELECTOR)
    pages.append({
        "url": f"{SITE_URL}/resources.html",
        "title": page_title(soup, "Resources"),
        "text": text,
    })

    # Opportunities: static wrapper text + current entries baked in from the
    # data file (see module docstring re: staleness after future CMS edits)
    soup, text = extract_text(ROOT / "opportunities.html", MAIN_SELECTOR)
    opp_data = json.loads((ROOT / "data" / "opportunities.json").read_text(encoding="utf-8"))
    extra = []
    for item in opp_data.get("items", []):
        extra.append(item.get("title", ""))
        extra.append(item.get("type", ""))
        extra.append(item.get("description", ""))
    text = re.sub(r"\s+", " ", (text + " " + " ".join(extra))).strip()
    pages.append({
        "url": f"{SITE_URL}/opportunities.html",
        "title": page_title(soup, "Opportunities"),
        "text": text,
    })

    # Project pages
    for html_path in sorted((ROOT / "projects").glob("*.html")):
        soup, text = extract_text(html_path, MAIN_SELECTOR)
        pages.append({
            "url": f"{SITE_URL}/projects/{html_path.name}",
            "title": page_title(soup, html_path.stem),
            "text": text,
        })

    out_path = ROOT / "data" / "search-index.json"
    out_path.write_text(json.dumps(pages, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} — {len(pages)} pages, "
          f"{sum(len(p['text']) for p in pages)} chars total")


if __name__ == "__main__":
    build()
