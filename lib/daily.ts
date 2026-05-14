import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findById } from "./pool";
import type { Quote } from "./types";

const QUOTES_PATH = path.join(process.cwd(), "data", "quotes.json");

let quotesCache: Record<string, Quote[]> | null = null;
function loadQuotes(): Record<string, Quote[]> {
  if (quotesCache) return quotesCache;
  quotesCache = JSON.parse(readFileSync(QUOTES_PATH, "utf8")) as Record<string, Quote[]>;
  return quotesCache;
}

export interface DailyMovie {
  imdbId: string;
  title: string;
  year: number;
  quote: Quote;
}

function todayUTC(): string {
  // YYYY-MM-DD in UTC. Same string for everyone in a given 24h slice.
  return new Date().toISOString().slice(0, 10);
}

function hashToInt(seed: string): number {
  const h = createHash("sha256").update(seed).digest();
  // First 4 bytes as unsigned 32-bit int.
  return h.readUInt32BE(0);
}

/**
 * Deterministic per-UTC-day movie + quote selection. Anyone hitting the app
 * on the same date sees the same teaser.
 */
export function getDailyMovie(): DailyMovie | null {
  const quotes = loadQuotes();
  const ids = Object.keys(quotes).sort();
  if (ids.length === 0) return null;

  const seed = `${todayUTC()}|${process.env.REELQUOTES_SECRET ?? ""}`;
  const movieIdx = hashToInt(seed) % ids.length;
  const imdbId = ids[movieIdx];
  if (!imdbId) return null;

  const movieQuotes = quotes[imdbId];
  if (!movieQuotes || movieQuotes.length === 0) return null;
  const quoteIdx = hashToInt(`${seed}|q`) % movieQuotes.length;
  const quote = movieQuotes[quoteIdx];
  if (!quote) return null;

  const movie = findById(imdbId);
  if (!movie) return null;

  return {
    imdbId,
    title: movie.title,
    year: movie.year,
    quote,
  };
}
