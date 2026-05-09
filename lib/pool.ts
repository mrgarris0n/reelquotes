import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Filters, Movie, PopularityTier } from "./types";

const DEFAULT_TIERS: PopularityTier[] = ["iconic", "popular"];

let cached: Movie[] | null = null;

function loadPool(): Movie[] {
  if (cached) return cached;
  const generated = path.join(process.cwd(), "data", "movies.json");
  const seed = path.join(process.cwd(), "data", "movies.seed.json");
  const filePath = existsSync(generated) ? generated : seed;
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Movie[];
  cached = parsed;
  return parsed;
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
