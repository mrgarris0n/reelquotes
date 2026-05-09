# ReelQuotes

A small web game: a quote from a random movie is shown; you guess the title. Leave the field blank to skip and see another quote from the same movie. Five quotes max — wrong guess at any point counts like a skip; running out of quotes for a movie ends the game.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · fastest-levenshtein for fuzzy title matching · stateless rounds via AES-256-GCM tokens.

## Quickstart

```bash
npm install
npm run dev
```

Open http://localhost:3000.

The repo ships with a pre-built quote database (`data/movies.json` + `data/quotes.json`) covering the iconic and popular tiers, so the app works immediately with no scraping at runtime.

## Refreshing the database

To pull fresh data from IMDb (run locally, then commit and deploy):

```bash
npm run refresh   # = build:pool + build:quotes
```

- `build:pool` downloads IMDb's TSV dumps from <https://datasets.imdbws.com/> and writes the raw movies pool to `data/movies.json`.
- `build:quotes` reads that pool, fetches quotes from IMDb's GraphQL endpoint for the iconic + popular tiers, drops movies with fewer than 5 usable quotes, caps each remaining movie at 20 quotes, and overwrites `data/movies.json` to contain only movies that have quotes plus writes `data/quotes.json` keyed by IMDb id.

The scrape is resumable — re-running it skips movies already in `data/quotes.json`. Expect ~25 minutes for a full run at concurrency 4.

After refreshing, commit `data/movies.json` and `data/quotes.json` and push.

## Architecture

- `lib/pool.ts` — loads `data/movies.json`, picks a random movie matching the user's decade/tier filters.
- `lib/scraper.ts` — loads `data/quotes.json`, picks 5 random quotes for a movie, anonymizes character names. No network calls at runtime.
- `lib/token.ts` — encodes round state into an AES-256-GCM token; the client carries it across `/start` → `/guess` / `/skip` so no server-side state is needed.
- `lib/matcher.ts` — Levenshtein-based fuzzy title matching with normalization (article-stripping, subtitle-stripping, diacritic-stripping).

## Deployment

Set `REELQUOTES_SECRET` (≥16 chars, ideally 32+ random hex bytes) in your Vercel project env vars so round tokens stay valid across Lambda instances.

## Caveats

- IMDb has no public quotes API. Pre-scraping happens locally and is committed to the repo, so the deployed app makes zero IMDb calls at runtime.
- The bundled DB only covers iconic + popular tiers (≥100k IMDb votes). Picking "known" or "niche" filters with no other tiers selected will return an error until you broaden the scope of the build script.
