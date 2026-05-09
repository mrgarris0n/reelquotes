# Data

Both files in this directory are generated and committed.

- `movies.json` — array of `{ id, title, year, decade, tier }`. Only contains movies for which `quotes.json` has at least 5 usable quotes.
- `quotes.json` — `{ [imdbId]: Quote[] }`. Up to 20 quotes per movie. Character names are stored verbatim and anonymized at request time.

Regenerate both with:

```
npm run refresh   # = build:pool + build:quotes
```

`build:pool` downloads IMDb's TSV dumps from <https://datasets.imdbws.com/> and writes the raw movies pool to `movies.json`. `build:quotes` then fetches quotes from IMDb's GraphQL endpoint for the iconic + popular tiers, drops movies with too few quotes, and overwrites `movies.json` with the trimmed list. The scrape is resumable — it skips IMDb ids already present in `quotes.json`.
