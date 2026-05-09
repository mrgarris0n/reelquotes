# ReelQuotes

A small web game: a quote from a random movie is shown; you guess the title. Leave the field blank to skip and see another quote from the same movie. Five quotes max — wrong guess at any point or skipping past the fifth is a fail.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · cheerio for IMDb scraping · fastest-levenshtein for fuzzy title matching.

## Quickstart

```bash
npm install
npm run dev
```

Open http://localhost:3000.

The app ships with a small seed catalog (`data/movies.seed.json`, ~50 well-known films). To use a wider pool (~10k movies), build it once:

```bash
npm run build:pool
```

That downloads two TSVs from <https://datasets.imdbws.com/> (a few hundred MB each) and writes `data/movies.json`, which the app prefers when present.

## How it works

1. `/api/round/start` picks a random movie matching your filters, scrapes 5 quotes from `imdb.com/title/{id}/quotes`, caches them on disk, and creates a server-side round.
2. `/api/round/[id]/guess` fuzzy-matches your guess against the canonical title (and a couple of variants).
3. `/api/round/[id]/skip` advances to the next quote, or fails the round if you've used all five.

The server never sends the answer to the client until the round ends.

## Caveats

- IMDb has no public quotes API; this app scrapes their HTML, which is technically against their ToS and can break when they change their markup. Quotes are cached aggressively so the same movie isn't refetched.
- The catalog is filtered to titles with ≥5,000 IMDb votes, which still includes plenty of obscure films — narrow with the difficulty / era chips.
