# Data

Both files are generated and committed (the deployed app reads them at runtime; nothing is fetched in production). Provenance and licensing: see [`../ATTRIBUTION.md`](../ATTRIBUTION.md).

- **`movies.json`** — `Movie[]` (see `lib/types.ts`): `{ id, title, year, decade, kind, genres, wqTitle }`. `id` is the IMDb id (used only for the post-round outbound link). `wqTitle` is the English Wikiquote page the quotes came from (attribution). Only includes movies with ≥5 usable quotes. Sourced from **Wikidata (CC0)**.
- **`quotes.json`** — `{ [imdbId]: Quote[] }`, ≤20 quotes per movie. Speaker names stored verbatim; anonymized at request time in `lib/scraper.ts` (skipped on easy difficulty). Sourced from **English Wikiquote (CC BY-SA)**.

## Regenerating

```bash
npm run refresh   # = build:pool + build:quotes
```

- **`build:pool`** (`scripts/build-pool.ts`) — one SPARQL query to `query.wikidata.org`: films (`wdt:P31 wd:Q11424`) that have an English Wikiquote sitelink, an IMDb id (`P345`), and a publication date (`P577`); genres (`P136`) mapped onto the 15-name allowlist; decade derived from the year. Writes ~5,100 entries to `movies.json`. Fast (~1 query).
- **`build:quotes`** (`scripts/build-quotes.ts`) — for each `wqTitle`, fetches page wikitext via the Wikiquote MediaWiki API, parses with `lib/wikiquote-parse`, drops <5-quote movies, caps at 20 (random sample), checkpoints every 50, and rewrites `movies.json` to only movies with quotes. Concurrency 2, 250 ms inter-request delay, descriptive User-Agent (Wikimedia etiquette). ~40 min; resumable (skips ids already in `quotes.json`).

> **If you change the quote source**, delete `data/quotes.json` before re-running `build:quotes` — the resume check keys on IMDb id and would otherwise keep stale entries from the previous source.

After refreshing, commit both files and push — Vercel rebuilds with the new bundle.
