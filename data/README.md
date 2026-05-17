# Data

Both files are generated and committed (the deployed app reads them at runtime; nothing is fetched in production). Provenance and licensing: see [`../ATTRIBUTION.md`](../ATTRIBUTION.md).

- **`movies.json`** — `Movie[]` (see `lib/types.ts`): `{ id, title, year, decade, kind, genres, wqTitle }`. `kind` is `"movie"` or `"series"`. `id` is the IMDb id (used only for the post-round outbound link). `wqTitle` is the English Wikiquote page the quotes came from (attribution). Only includes titles with ≥5 usable quotes. Sourced from **Wikidata (CC0)**.
- **`quotes.json`** — `{ [imdbId]: Quote[] }`, ≤20 quotes per title. Speaker names stored verbatim; anonymized at request time in `lib/scraper.ts` (skipped on easy difficulty). Sourced from **English Wikiquote (CC BY-SA)**.

## Regenerating

```bash
npm run refresh   # = build:pool + build:quotes
```

- **`build:pool`** (`scripts/build-pool.ts`) — two SPARQL queries to `query.wikidata.org`: films (`wdt:P31 wd:Q11424`, date `P577`) and TV series (`wd:Q5398426`, date `P577` or `P580`), each requiring an English Wikiquote sitelink + IMDb id (`P345`); genres (`P136`) → 15-name allowlist; decade from year; `kind` tagged. Films ingested first so a film and a same-named series resolve to the film. Writes ~6,400 entries. Two queries because the union exceeds Wikidata's 60s limit.
- **`build:quotes`** (`scripts/build-quotes.ts`) — per `wqTitle`, fetches page wikitext via the Wikiquote MediaWiki API and parses with `lib/wikiquote-parse`. Series hubs (thin main page) → follows `Show (season N)` / `Show/Season N` subpage links (root-aware) and aggregates. Drops <5-quote titles, caps at 20, checkpoints every 50, rewrites `movies.json` to only titles with quotes. Concurrency 2, 250 ms delay, descriptive User-Agent. ~45–60 min; resumable (skips ids already in `quotes.json`).

> **If you change the quote source**, delete `data/quotes.json` before re-running `build:quotes` — the resume check keys on IMDb id and would otherwise keep stale entries from the previous source.

After refreshing, commit both files and push — Vercel rebuilds with the new bundle.
