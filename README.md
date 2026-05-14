# ReelQuotes

A movie-quote guessing game. The player sees a quote from a random movie and has to identify the title. Five quotes per round; empty/wrong guesses advance to the next quote; running out of quotes ends the game. Live at <https://reelquotes.vercel.app>.

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **Tailwind CSS**
- **fastest-levenshtein** for fuzzy title matching
- **AES-256-GCM tokens** for stateless round / score state (no server-side session storage)
- **Vercel Blob** (private) for the leaderboard
- **Vercel BotID** protecting leaderboard submissions
- **Vercel Web Analytics** for traffic metrics

## Quickstart

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The repo ships with a pre-built quote database, so the app works immediately without scraping anything at runtime.

## How to play

1. Pick decade(s), genre(s), and a difficulty on the setup screen. Era and genre default to "any".
2. Type a title or pick one from the autocompleting dropdown. Empty input or the Skip button advances to the next quote.
3. **Scoring** — `5/4/3/2/1` points by quote index (round-win pays based on which quote you guessed on).
4. **Streak bonus** — if you guess on quote 1 in consecutive rounds *with no hints used*, each streak step beyond the first adds `+1` (capped at `+5`). Any hint, wrong guess, or guess on quote 2+ resets the streak.
5. **Hints** — three buyable mid-round reveals; cost is deducted from the round's payout (floored at 0):

   | Hint                 | Cost | Notes                                                    |
   |----------------------|------|----------------------------------------------------------|
   | Reveal year          | 1pt  | Only offered on Hard (easy/normal show it free)          |
   | Reveal genre         | 1pt  | Always offered                                           |
   | Reveal first letters | 2pts | Hangman-style outline of the title (`T__ M_____`)        |

   Using any hint disqualifies the round from the streak bonus.
6. **Game over** when all five quotes of a movie are exhausted. If your final score is > 0, enter a name (1–10 alphanumeric chars) to submit to the leaderboard. The end screen also shows a Wordle-style emoji grid of your round outcomes and a Share button (Web Share API on mobile, clipboard on desktop).

### Difficulty levels

| Mode    | Character names | Year shown free |
|---------|-----------------|-----------------|
| Easy    | Real            | Yes             |
| Normal  | Anonymized      | Yes             |
| Hard    | Anonymized      | No              |

Difficulty is locked to the session at first round-start and baked into the signed score token, so it can't be swapped mid-game.

### Leaderboard

Top 20 entries, persisted in a private Vercel Blob (`leaderboard.json`). Filterable by difficulty (`All / Easy / Normal / Hard`); the "All" view tags each row with its difficulty. Each session id can only be submitted once (server-side dedup) — replaying the same playthrough has no effect.

### Quote of the Day

The setup screen shows a deterministically-chosen quote each UTC day, with a click-to-reveal answer. Seed combines today's date with `REELQUOTES_SECRET` so preview environments get a different quote (prevents previewing tomorrow's quote from the public site).

## Architecture

Server has **no mutable state** between requests. Round progress and cumulative score live inside two encrypted, signed tokens that the client carries on every request:

```
┌─ Client ──────────────────────────────────────────────────┐
│ React state: roundToken, scoreToken, score, streak, ...   │
└────────────┬──────────────────────────────────────────────┘
             │ POST /api/round/{start,guess,skip,hint}
             ▼
┌─ Server (Vercel Function) ────────────────────────────────┐
│ decode → validate → mutate → re-encode → respond          │
│ • round token expires after 1h, score token after 24h     │
│ • round.sessionId must equal scoreToken.id (anti-tamper)  │
└───────────────────────────────────────────────────────────┘
```

### Library modules (`lib/`)

| File             | Responsibility                                                                                              |
|------------------|-------------------------------------------------------------------------------------------------------------|
| `types.ts`       | Shared types (`Movie`, `RoundState`, `ScoreState`, `Difficulty`, `HintKind`, `LeaderboardEntry`, …).        |
| `pool.ts`        | Loads `data/movies.json` once; `pickRandom(filters)` for round start; `findById` for hint lookups.          |
| `scraper.ts`     | `pickQuotes(imdbId, difficulty)` — reads `data/quotes.json`, picks 5 random, anonymizes unless `easy`.      |
| `matcher.ts`     | `matches()` lenient fuzzy (Levenshtein + article/subtitle stripping). `matchesExact()` strict for dropdown picks. |
| `token.ts`       | AES-256-GCM encode/decode for both `RoundState` and `ScoreState`. Key derived from `REELQUOTES_SECRET`.    |
| `expiry.ts`      | `ROUND_MAX_AGE_MS = 1h`, `SCORE_MAX_AGE_MS = 24h`, and the two `isExpired()` helpers used by every route.   |
| `hints.ts`       | `HINT_COSTS` table, `totalHintCost`, `anyHintUsed`, `maskTitle` (hangman renderer).                         |
| `scoring.ts`     | `POINTS_PER_QUOTE`, `STREAK_BONUS_CAP` — single source of truth for both client and server.                 |
| `name.ts`        | `NAME_MAX_LEN` + `sanitizeName` — used client-side for input filtering and server-side on submit.           |
| `leaderboard.ts` | Vercel Blob read/write with sessionId-based dedup. `cacheControlMaxAge: 0` on writes (no edge staleness).   |
| `daily.ts`       | Deterministic per-UTC-day movie+quote selection for the Quote of the Day panel.                             |

### API routes (`app/api/`)

| Route                       | Verb | Purpose                                                                            |
|-----------------------------|------|------------------------------------------------------------------------------------|
| `/api/round/start`          | POST | `{ filters?, difficulty?, scoreToken? }` → picks a movie, mints round+score tokens. If a score token is provided, the new round inherits that session's id and difficulty. |
| `/api/round/guess`          | POST | `{ token, scoreToken, guess, exact? }` → returns `correct`, `failed`, or wrong-but-continue. Computes points (base − hints + streak bonus, floored at 0) on the correct branch. |
| `/api/round/skip`           | POST | `{ token, scoreToken }` → advances quote index or ends the round (records `-1` in outcomes). |
| `/api/round/hint`           | POST | `{ token, hint: "year"\|"genre"\|"title" }` → flips the flag in the round token and returns the reveal. Idempotent. |
| `/api/leaderboard`          | GET  | `?difficulty=easy\|normal\|hard` returns top 20 entries; no query = top 20 across all modes. Cache-busted (`no-store`). |
| `/api/leaderboard`          | POST | `{ name, scoreToken }` → validates BotID + signature, dedups by session id, persists.   |
| `/api/titles`               | GET  | Returns the full list of `{ title, year }` for the autocomplete combobox. CDN-cacheable. |
| `/api/daily`                | GET  | Today's deterministic quote for the setup-screen teaser.                            |

### Security model

- **Round/score tokens** are encrypted (AES-256-GCM) and authenticated (GCM tag), so the client can't forge or tamper with them. Decryption key is `SHA-256(REELQUOTES_SECRET)`.
- **Session binding** — every round token carries the score token's session id; mismatched pairs are rejected with `400`. Prevents a player from swapping in a different session's score token to inflate their streak.
- **Expiry** — round tokens are valid for 1 hour, score tokens for 24 hours after `lastUpdatedAt`. Caps the value of any leaked secret to that window.
- **Idempotent leaderboard submissions** — each session id can only enter the board once.
- **Vercel BotID** on the leaderboard POST blocks headless/scripted submissions.
- **Score floors at 0** per round — hints can zero out a round's contribution but never make it negative.

Known soft-spots (intentional trade-offs, not bugs):
- A patient attacker can play many sessions and submit only the high-scoring ones (per-IP rate limit on `/api/round/start` would address this).
- Vercel Blob has no atomic CAS, so two truly-concurrent leaderboard writes can race and one entry is lost (extremely unlikely at current traffic).

## Refreshing the quote database

```bash
npm run refresh   # = build:pool + build:quotes
```

- `build:pool` downloads IMDb's TSV dumps from <https://datasets.imdbws.com/>, joins `title.basics` × `title.ratings`, filters to movies with `numVotes ≥ 5000` and a valid decade/tier, captures genres, and writes the raw pool to `data/movies.json`.
- `build:quotes` reads that pool, scrapes quotes from IMDb's GraphQL endpoint for the `iconic` + `popular` tiers, drops movies with fewer than 5 usable quotes, caps each remaining movie at 20 quotes, and overwrites `data/movies.json` to only those movies plus writes `data/quotes.json` keyed by IMDb id.

The scrape is resumable — re-running skips movies already present in `data/quotes.json`. Expect ~25 minutes for a full run at concurrency 4.

After refreshing, commit `data/movies.json` and `data/quotes.json` and push. The current bundled DB is ~2,600 movies (iconic + popular tiers).

## Logo recolor

`public/logo.png` is the original cream-background design. `public/logo-dark.png` is the dark-theme variant the page actually uses, produced by:

```bash
npx tsx scripts/recolor-logo.ts
```

The recolor maps cream → transparent, navy → zinc-100, gold → amber-700, with per-pixel alpha for clean anti-aliased edges on the dark page.

## Versioning

The footer displays the `package.json` version plus the deployed commit's short SHA (linked to GitHub). Powered by `process.env.COMMIT_SHA` (which `next.config.ts` populates from `VERCEL_GIT_COMMIT_SHA` at build time).

## Deployment

Required env vars on the Vercel project:

| Name                     | Purpose                                                                                       |
|--------------------------|-----------------------------------------------------------------------------------------------|
| `REELQUOTES_SECRET`      | ≥16 chars (32 random hex bytes recommended). Derives the AES key for round/score tokens. Falls back to a per-process key with a loud warning if missing or too short — sessions break across Lambda instances in that case. |
| `BLOB_READ_WRITE_TOKEN`  | Auto-provisioned by the Vercel Blob integration. Required for leaderboard reads + writes.     |

One-time Vercel project setup:

1. **Vercel Blob** — Storage → Blob → Connect to project. The store can be private; the server uses `BLOB_READ_WRITE_TOKEN` to read.
2. **Vercel BotID** — package install (`botid` is in deps) and `withBotId()` wrapper in `next.config.ts` enable basic protection. No dashboard action required for basic; "Deep Analysis" is an opt-in firewall toggle.
3. **Vercel Web Analytics** — already wired via `@vercel/analytics/next` in the root layout.

`next.config.ts` adds `outputFileTracingIncludes` so `data/movies.json` + `data/quotes.json` are bundled with the API route Lambdas. Without it, runtime `fs.readFileSync` against those paths would fail.

## TypeScript / tooling

- `strict: true` + `noUncheckedIndexedAccess: true` in `tsconfig.json`. Run `npm run typecheck` to verify.
- Type-only checks (no formal test suite yet). Candidate areas for future tests: `lib/matcher` (`matches` / `matchesExact` / `buildAcceptableTitles`), `lib/hints` (`maskTitle`), and the scoring math inside `/api/round/guess`.

## Caveats

- IMDb has no public quotes API. The build script scrapes their GraphQL endpoint with a browser user-agent — pragmatic, but fragile (they can change the contract any release) and arguably outside their ToS. The deployed app makes zero IMDb calls at runtime, so the risk is confined to refresh time.
- The bundled DB only covers `iconic` + `popular` tiers (≥100k IMDb votes), ~2,600 movies. Selecting filters that yield zero matches surfaces a clear error.

## License

No license file. Personal project.
