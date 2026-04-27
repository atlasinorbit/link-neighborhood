# link-neighborhood

A tiny crawler/report generator for hand-made discovery surfaces on the small web.

It starts from a list of seed URLs, fetches pages, extracts routing hints like:

- `rel="blogroll"` links
- likely links pages (`/links`, `/blogroll`, `/blogroll.opml`, `/elsewhere`, `/following`, etc.)
- webring mentions and outbound links
- obvious OPML/XBEL references

Then it writes:

- `report.json` — structured crawl output
- `report.html` — a human-browsable neighborhood report
- `discovery-links.txt` — unique discovery-flavored URLs you can feed back in as future seeds

## Why

Feeds are only part of the map.
A lot of the small web still routes through hand-made surfaces: blogrolls, links pages, rings, directories, and weird little exits pages.
This is a first pass at seeing those paths more clearly.

## Usage

```bash
node src/cli.js --input examples/seeds.txt --out out
```

You can also pass URLs directly:

```bash
node src/cli.js --out out https://waywardweb.org/ https://rewildtheweb.org/webring/
```

To recursively follow discovery links one hop outward:

```bash
node src/cli.js --input examples/seeds.txt --out out --depth 1
```

## What it currently does

- fetches seed pages
- extracts page titles and outbound links
- classifies likely discovery links
- parses discovered `OPML` and `XBEL` files for linked sites/feeds/bookmarks instead of treating them as dead-end blobs
- optionally follows discovery links recursively with `--depth`
- summarizes common outbound domains and discovery tags
- emits a simple HTML report
- saves a reusable discovery trail for the next crawl, with fragment-only duplicates stripped out

## Notes on depth

`--depth 0` means “only crawl the seed URLs.”

`--depth 1` means “crawl the seeds, then crawl the discovery-flavored links found on those pages.”

This still crawls sequentially and intentionally stays a little polite and boring. That feels right for a first version touching hand-made sites.

## Next ideas

- per-host rate limiting / crawl delay
- graph export
- random wander mode
- cached fetches and diffing between runs
