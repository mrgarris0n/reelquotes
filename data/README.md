# Data

Both files in this directory are generated and committed (the deployed app reads them at runtime; no scraping happens in production).

- **`movies.json`** — `Movie[]` (see `lib/types.ts`). Each entry: `{ id, title, year, decade, tier, genres }`. Only includes movies for which `quotes.json` has at least 5 usable quotes. Sorted by IMDb vote count (most popular first), which biases random picks toward better-known titles.
- **`quotes.json`** — `{ [imdbId]: Quote[] }`. Up to 20 quotes per movie. Character names are stored verbatim; anonymization happens at request time in `lib/scraper.ts` (skipped in easy difficulty).

## Regenerating

```bash
npm run refresh   # = build:pool + build:quotes
```

- **`build:pool`** (`scripts/build-pool.ts`) downloads IMDb's TSV dumps from <https://datasets.imdbws.com/>, joins `title.basics` × `title.ratings`, keeps `titleType === "movie"` with `numVotes ≥ 5000` and a recognized decade/tier, extracts the genre list, and writes the unfiltered pool to `movies.json`. ~18k entries.
- **`build:quotes`** (`scripts/build-quotes.ts`) reads `movies.json`, scrapes quotes from IMDb's GraphQL endpoint for the `iconic` + `popular` tiers (concurrency 4), drops movies with <5 usable quotes, caps each remaining movie at 20 quotes (random sample), and overwrites `movies.json` to only those movies. Writes incremental checkpoints to `quotes.json` every 50 movies. The full run takes ~25 minutes; re-running is resumable (skips any IMDb id already in `quotes.json`).

Current snapshot: ~2,600 movies, ~16 MB `quotes.json`.

After refreshing, commit both files and push — Vercel rebuilds with the new bundle.
