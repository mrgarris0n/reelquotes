import { promises as fs } from "node:fs";
import path from "node:path";
import type { Quote } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache", "quotes");
const memory = new Map<string, Quote[]>();

async function ensureDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function fileFor(imdbId: string): string {
  return path.join(CACHE_DIR, `${imdbId}.json`);
}

export async function getCached(imdbId: string): Promise<Quote[] | null> {
  const mem = memory.get(imdbId);
  if (mem) return mem;
  try {
    const raw = await fs.readFile(fileFor(imdbId), "utf8");
    const parsed = JSON.parse(raw) as Quote[];
    memory.set(imdbId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function putCached(imdbId: string, quotes: Quote[]): Promise<void> {
  memory.set(imdbId, quotes);
  await ensureDir();
  await fs.writeFile(fileFor(imdbId), JSON.stringify(quotes), "utf8");
}
