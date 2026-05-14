# ReelQuotes

A small web game: a quote from a random movie is shown; you guess the title. Leave the field blank to skip and see another quote from the same movie. Five quotes max per round — wrong guesses count like skips; running out of quotes for a movie ends the game.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · fastest-levenshtein for fuzzy title matching · Vercel Blob for the leaderboard · AES-256-GCM tokens for stateless round/session state.

## Quickstart

```bash
npm install
npm run dev
```

Open http://localhost:3000.

The repo ships with a pre-built quote database (`data/movies.json` + `data/quotes.json`) covering the iconic and popular tiers, so the app works immediately with no scraping at runtime.

## How to play

1. Pick decade(s) and a difficulty on the setup screen.
2. Type or pick a title from the autocompleting dropdown. Empty input = skip.
3. Five points if you get it on quote 1, four on quote 2, … one on quote 5. Wrong guesses just show the next quote.
4. Game ends when you exhaust all five quotes for a movie. If your final score is positive, you can put your name (1–10 alphanumeric chars) on the leaderboard.

### Difficulty levels

| Mode    | Character names | Year hint |
|---------|-----------------|-----------|
| Easy    | Real            | Shown     |
| Normal  | Anonymized      | Shown     |
| Hard    | Anonymized      | Hidden    |

Difficulty is locked to the session at first round-start and stored inside the signed score token, so it can't be swapped mid-game. The leaderboard tracks each entry's difficulty and supports a top-20 filter per mode.

## Architecture

- `lib/pool.ts` — loads `data/movies.json`, picks a random movie matching the user's decade filters.
- `lib/scraper.ts` — loads `data/quotes.json`, picks 5 random quotes per round and anonymizes character names except on `easy` difficulty. No network calls at runtime.
- `lib/matcher.ts` — title matching. `matches()` is the lenient fuzzy path used for free-text submissions (Levenshtein with normalization, article/subtitle stripping). `matchesExact()` is used for explicit dropdown picks: normalized strict equality with optional leading-article tolerance, no fuzz.
- `lib/token.ts` — AES-256-GCM encrypt/decrypt for both the per-round token and the cumulative score token. Both are carried by the client; the server is the only party that can mint or validate them.
- `lib/leaderboard.ts` — read/write a single private blob (`leaderboard.json`) backed by Vercel Blob. Writes are idempotent per session id (a session can't be submitted twice).
- `app/api/round/start` — picks a movie, builds quotes, returns a fresh round token (and `year` for easy/normal modes).
- `app/api/round/guess` — validates the round token; on a correct guess, increments the cumulative score in the score token and returns the refreshed token. Honours `exact: true` for dropdown picks.
- `app/api/round/skip` — advances quote index or ends the round.
- `app/api/round/hint` — POST `{ token, hint }` buys a hint (`year`, `genre`, or `title`). Year=1pt, genre=1pt, title=2pts. Returns updated round token plus the revealed data. Each hint kind buyable once per round; any hint disqualifies the round from the streak bonus.
- `app/api/leaderboard` — `GET ?difficulty=easy|normal|hard` returns the top 20 (or all-mode top 20 with no filter); `POST` accepts `{ name, scoreToken }` and persists.
- `app/api/titles` — returns `{ title, year }[]` for the autocomplete combobox.

There is no server-side mutable state — every round and session lives entirely inside encrypted tokens that the client passes back on each request, so the app survives Vercel Lambda instance churn.

## Refreshing the quote database

```bash
npm run refresh   # = build:pool + build:quotes
```

- `build:pool` downloads IMDb's TSV dumps from <https://datasets.imdbws.com/> and writes the raw movies pool to `data/movies.json`.
- `build:quotes` reads that pool, fetches quotes from IMDb's GraphQL endpoint for the iconic + popular tiers, drops movies with fewer than 5 usable quotes, caps each remaining movie at 20 quotes, and overwrites `data/movies.json` to only the movies that have quotes plus writes `data/quotes.json` keyed by IMDb id.

The scrape is resumable — re-running skips movies already in `data/quotes.json`. Expect ~25 minutes for a full run at concurrency 4.

After refreshing, commit `data/movies.json` and `data/quotes.json` and push.

## Logo recolor

The cream-background logo at `public/logo.png` is also published as `public/logo-dark.png`, recolored for the dark page theme (cream → transparent, navy → zinc-100, gold → amber-700). The transformation is reproducible:

```bash
npx tsx scripts/recolor-logo.ts
```

## Deployment

Required env vars on the Vercel project:

| Name                     | Purpose                                                                                |
|--------------------------|----------------------------------------------------------------------------------------|
| `REELQUOTES_SECRET`      | ≥16 chars (ideally 32+ random hex bytes). Derives the AES key for round/score tokens. |
| `BLOB_READ_WRITE_TOKEN`  | Auto-provisioned by the Vercel Blob integration. Required for the leaderboard.         |

The Vercel Blob integration must be installed on the project (Storage → Blob → Connect to project) for the leaderboard endpoints to work. The store can be private; the SDK uses the token to read/write authenticated.

`next.config.ts` adds `outputFileTracingIncludes` so `data/movies.json` and `data/quotes.json` are bundled into the API routes' Lambda. Without that, runtime `fs.readFileSync` would fail because Next.js can't trace dynamic file paths.

## Caveats

- IMDb has no public quotes API. Pre-scraping happens locally and is committed to the repo, so the deployed app makes zero IMDb calls at runtime.
- The bundled DB only covers iconic + popular tiers (≥100k IMDb votes). Roughly 2,600 movies after pruning ones with fewer than 5 usable quotes.
- Anti-cheat is best-effort: the score token is server-signed so the client can't fabricate a score, but a determined attacker could play many sessions to grind a high score (or, since the leaderboard is per-session, submit one cheap session per name they want on the board). The session-id dedup protects against trivial replay.
