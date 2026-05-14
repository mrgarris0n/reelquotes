import { readFileSync } from "node:fs";
import path from "node:path";
import type { Difficulty, Quote } from "./types";

export class InsufficientQuotesError extends Error {
  constructor(public imdbId: string, public found: number) {
    super(`Only ${found} usable quotes for ${imdbId}`);
    this.name = "InsufficientQuotesError";
  }
}

const REQUIRED_QUOTES = 5;
const QUOTES_PATH = path.join(process.cwd(), "data", "quotes.json");

let cache: Record<string, Quote[]> | null = null;

function loadAll(): Record<string, Quote[]> {
  if (cache) return cache;
  const raw = readFileSync(QUOTES_PATH, "utf8");
  cache = JSON.parse(raw) as Record<string, Quote[]>;
  return cache;
}

function anonymize(quote: Quote): Quote {
  const map = new Map<string, string>();
  return {
    lines: quote.lines.map((line) => {
      if (!line.speaker) return line;
      let label = map.get(line.speaker);
      if (!label) {
        label = `Character ${map.size + 1}`;
        map.set(line.speaker, label);
      }
      return { speaker: label, text: line.text };
    }),
  };
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export function pickQuotes(imdbId: string, difficulty: Difficulty): Quote[] {
  const all = loadAll();
  const pool = all[imdbId];
  if (!pool || pool.length < REQUIRED_QUOTES) {
    throw new InsufficientQuotesError(imdbId, pool?.length ?? 0);
  }
  const picked = shuffle(pool).slice(0, REQUIRED_QUOTES);
  return difficulty === "easy" ? picked : picked.map(anonymize);
}
