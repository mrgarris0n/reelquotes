# Data

`movies.seed.json` is a small handcrafted set of well-known films committed to the repo so the app runs immediately.

`movies.json` is generated and gitignored. Build it once with:

```
npm run build:pool
```

That downloads two TSVs from <https://datasets.imdbws.com/> (a few hundred MB each) and produces ~10k filtered movies (`numVotes >= 5000`, `titleType === "movie"`).

`lib/pool.ts` prefers `movies.json` if present; otherwise it falls back to the seed.
