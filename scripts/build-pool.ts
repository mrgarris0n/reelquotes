/**
 * One-off script: download IMDb TSV datasets, filter, write data/movies.json.
 * Run with: npm run build:pool
 *
 * IMDb publishes free non-commercial dumps at https://datasets.imdbws.com/
 *  - title.basics.tsv.gz   tconst | titleType | primaryTitle | originalTitle | isAdult | startYear | endYear | runtimeMinutes | genres
 *  - title.ratings.tsv.gz  tconst | averageRating | numVotes
 */

import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import readline from "node:readline";
import path from "node:path";
import { ALL_GENRES, type Decade, type Genre, type Movie, type PopularityTier } from "../lib/types";

const KNOWN_GENRES = new Set<string>(ALL_GENRES);

const TMP = path.join(process.cwd(), ".cache", "imdb-tsv");
const OUT = path.join(process.cwd(), "data", "movies.json");

const MIN_VOTES = 5000;

const URLS = {
  basics: "https://datasets.imdbws.com/title.basics.tsv.gz",
  ratings: "https://datasets.imdbws.com/title.ratings.tsv.gz",
};

async function download(url: string, dest: string): Promise<void> {
  if (existsSync(dest)) return;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url}: ${res.status}`);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

async function* tsvLines(file: string): AsyncGenerator<string[]> {
  const stream = createReadStream(file).pipe(createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    yield line.split("\t");
  }
}

function tierFor(votes: number): PopularityTier | null {
  if (votes >= 500_000) return "iconic";
  if (votes >= 100_000) return "popular";
  if (votes >= 25_000) return "known";
  if (votes >= MIN_VOTES) return "niche";
  return null;
}

function decadeFor(year: number): Decade | null {
  if (year >= 1950 && year < 1960) return "1950s";
  if (year >= 1960 && year < 1970) return "1960s";
  if (year >= 1970 && year < 1980) return "1970s";
  if (year >= 1980 && year < 1990) return "1980s";
  if (year >= 1990 && year < 2000) return "1990s";
  if (year >= 2000 && year < 2010) return "2000s";
  if (year >= 2010 && year < 2020) return "2010s";
  if (year >= 2020 && year < 2030) return "2020s";
  return null;
}

async function main(): Promise<void> {
  await mkdir(TMP, { recursive: true });
  await mkdir(path.dirname(OUT), { recursive: true });

  const basicsGz = path.join(TMP, "title.basics.tsv.gz");
  const ratingsGz = path.join(TMP, "title.ratings.tsv.gz");
  await download(URLS.basics, basicsGz);
  await download(URLS.ratings, ratingsGz);

  console.log("Reading ratings...");
  const ratings = new Map<string, number>(); // tconst -> numVotes
  for await (const cols of tsvLines(ratingsGz)) {
    const tconst = cols[0];
    const numVotes = cols[2];
    if (!tconst || !numVotes) continue;
    const votes = Number(numVotes);
    if (votes >= MIN_VOTES) ratings.set(tconst, votes);
  }

  console.log(`Filtering basics (${ratings.size} candidate ids)...`);
  const movies: Movie[] = [];
  for await (const cols of tsvLines(basicsGz)) {
    const tconst = cols[0];
    const titleType = cols[1];
    const primaryTitle = cols[2];
    const isAdult = cols[4];
    const startYear = cols[5];
    const genresRaw = cols[8]; // title.basics col index 8
    if (!tconst || !primaryTitle) continue;
    if (titleType !== "movie") continue;
    if (isAdult === "1") continue;
    const votes = ratings.get(tconst);
    if (votes === undefined) continue;
    const year = Number(startYear);
    if (!Number.isFinite(year)) continue;
    const decade = decadeFor(year);
    if (!decade) continue;
    const tier = tierFor(votes);
    if (!tier) continue;
    const genres: Genre[] =
      genresRaw && genresRaw !== "\\N"
        ? (genresRaw.split(",").filter((g) => KNOWN_GENRES.has(g)) as Genre[])
        : [];
    movies.push({ id: tconst, title: primaryTitle, year, decade, tier, genres });
  }

  movies.sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0));

  await writeFile(OUT, JSON.stringify(movies));
  console.log(`Wrote ${movies.length} movies to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
