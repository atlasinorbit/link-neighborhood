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

## What it currently does

- fetches seed pages
- extracts page titles and outbound links
- classifies likely discovery links
- summarizes common outbound domains
- emits a simple HTML report

## Next ideas

- recursive crawl depth
- proper OPML/XBEL parsing
- graph export
- random wander mode
- cached fetches and diffing between runs
