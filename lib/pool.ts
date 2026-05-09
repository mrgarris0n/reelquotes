import { readFileSync } from "node:fs";
import path from "node:path";
import type { Filters, Movie, PopularityTier } from "./types";

const DEFAULT_TIERS: PopularityTier[] = ["iconic", "popular"];
const MOVIES_PATH = path.join(process.cwd(), "data", "movies.json");

let cached: Movie[] | null = null;

function loadPool(): Movie[] {
  if (cached) return cached;
  const raw = readFileSync(MOVIES_PATH, "utf8");
  cached = JSON.parse(raw) as Movie[];
  return cached;
}

export function poolSize(): number {
  return loadPool().length;
}

export function pickRandom(filters: Filters = {}): Movie {
  const all = loadPool();
  const tiers = filters.tiers && filters.tiers.length > 0 ? filters.tiers : DEFAULT_TIERS;
  const decades = filters.decades && filters.decades.length > 0 ? filters.decades : null;

  const filtered = all.filter((m) => {
    if (!tiers.includes(m.tier)) return false;
    if (decades && !decades.includes(m.decade)) return false;
    return true;
  });

  if (filtered.length === 0) {
    throw new Error("No movies match the chosen filters");
  }
  return filtered[Math.floor(Math.random() * filtered.length)];
}
