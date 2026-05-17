/**
 * Build data/quotes.json from English Wikiquote (CC BY-SA).
 *
 * For each title in data/movies.json, fetch its Wikiquote page wikitext via
 * the MediaWiki API and run lib/wikiquote-parse. TV series are hub-and-spoke:
 * the main page is just an index, so when it yields too few quotes we follow
 * its `Show (season N)` / `Show/...` subpage links and aggregate. Drops
 * titles with fewer than 5 usable quotes, caps each at 20, then rewrites
 * data/movies.json to only the titles that have quotes.
 *
 * Polite to Wikimedia: descriptive User-Agent, low concurrency, inter-request
 * delay. Resumable — re-running skips ids already present in quotes.json.
 *
 * Run with: npm run build:quotes
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseWikiquote } from "../lib/wikiquote-parse";
import type { Movie, Quote } from "../lib/types";

const MOVIES_PATH = path.join(process.cwd(), "data", "movies.json");
const QUOTES_PATH = path.join(process.cwd(), "data", "quotes.json");
const API = "https://en.wikiquote.org/w/api.php";
const UA =
  "ReelQuotes/1.0 (https://github.com/mrgarris0n/reelquotes) build-quotes";

const REQUIRED_QUOTES = 5;
const QUOTE_CAP = 20;
const CONCURRENCY = 2;
const REQUEST_DELAY_MS = 250;
const CHECKPOINT_EVERY = 50;
const MAX_SUBPAGES = 30; // cap fan-out for a hub series

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWikitext(wqTitle: string): Promise<string | null> {
  const url =
    `${API}?action=parse&page=${encodeURIComponent(wqTitle)}` +
    `&prop=wikitext&format=json&redirects=1&formatversion=2`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    parse?: { wikitext?: string };
    error?: { info?: string };
  };
  if (json.error) return null; // missing page, etc.
  return json.parse?.wikitext ?? null;
}

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const norm = (s: string) => s.replace(/_/g, " ").replace(/\s+/g, " ").trim();

/**
 * Season/subpage links to the same show, e.g. `[[Breaking Bad (season 1)|…]]`,
 * `[[Show (series 2)|…]]`, `[[Show (volume 1)|…]]`, `[[Show/Season 1]]`.
 */
function seasonSubpages(wikitext: string, wqTitle: string): string[] {
  // Season pages of `Friends (TV series)` are `Friends (season 1)` — they
  // share the *root*, not the disambiguated title. Match against both.
  const base = norm(wqTitle).toLowerCase();
  const root = base.replace(/\s*\([^()]*\)\s*$/, "").trim();
  const bases = [base, root].filter((b, i, a) => b.length >= 2 && a.indexOf(b) === i);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of wikitext.matchAll(/\[\[\s*([^\]|#]+?)\s*(?:\|[^\]]*)?\]\]/g)) {
    const target = norm(m[1]!);
    if (seen.has(target)) continue;
    const tl = target.toLowerCase();
    if (bases.includes(tl)) continue;
    const isSeason =
      bases.some((b) => tl.startsWith(b + " (")) &&
      /\((?:season|series|volume|part)\b/i.test(target);
    const isSlash = bases.some((b) => tl.startsWith(b + "/"));
    if (isSeason || isSlash) {
      seen.add(target);
      out.push(target);
      if (out.length >= MAX_SUBPAGES) break;
    }
  }
  return out;
}

/**
 * Fetch + parse a title. Single-page (films, single-page series) returns the
 * main page's quotes. Hub series (main page too thin) fall back to following
 * season subpages and aggregating.
 */
async function collectQuotes(wqTitle: string): Promise<Quote[]> {
  const wt = await fetchWikitext(wqTitle);
  if (!wt) return [];
  const main = parseWikiquote(wt);
  if (main.length >= REQUIRED_QUOTES) return main;

  const subs = seasonSubpages(wt, wqTitle);
  if (subs.length === 0) return main;

  const all: Quote[] = [...main];
  for (const sub of subs) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const subWt = await fetchWikitext(sub);
      if (subWt) all.push(...parseWikiquote(subWt));
    } catch {
      // skip a bad subpage; other seasons still count
    }
  }
  return all;
}

async function main(): Promise<void> {
  await mkdir(path.dirname(QUOTES_PATH), { recursive: true });
  const movies = JSON.parse(await readFile(MOVIES_PATH, "utf8")) as Movie[];
  const existing = await loadJson<Record<string, Quote[]>>(QUOTES_PATH, {});

  const todo = movies.filter((m) => !(m.id in existing));
  console.log(`Movies in pool: ${movies.length}`);
  console.log(`Already scraped: ${movies.length - todo.length}`);
  console.log(`To scrape: ${todo.length} (concurrency=${CONCURRENCY})`);

  let completed = 0;
  let failed = 0;
  let dropped = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < todo.length) {
      const movie = todo[cursor++]!;
      try {
        const quotes = await collectQuotes(movie.wqTitle);
        if (quotes.length < REQUIRED_QUOTES) {
          dropped++;
          existing[movie.id] = []; // sentinel — don't retry
        } else {
          existing[movie.id] = shuffle(quotes).slice(0, QUOTE_CAP);
        }
      } catch (err) {
        failed++;
        console.warn(`  ! ${movie.wqTitle}: ${(err as Error).message}`);
      }
      completed++;
      if (completed % CHECKPOINT_EVERY === 0) {
        await writeFile(QUOTES_PATH, JSON.stringify(existing), "utf8");
        console.log(
          `  ${completed}/${todo.length} done · ${dropped} dropped · ${failed} failed`,
        );
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const usable = movies.filter((m) => {
    const q = existing[m.id];
    return q && q.length >= REQUIRED_QUOTES;
  });

  // Prune the `[]` resume sentinels from the committed artifact — keep only
  // movies that made the final pool. (A later re-run re-fetches dropped
  // titles; minor inefficiency, much smaller committed file.)
  const pruned: Record<string, Quote[]> = {};
  for (const m of usable) pruned[m.id] = existing[m.id]!;
  await writeFile(QUOTES_PATH, JSON.stringify(pruned), "utf8");
  await writeFile(MOVIES_PATH, JSON.stringify(usable), "utf8");

  console.log(
    `\nDone. ${completed} processed, ${failed} errors, ${dropped} dropped (<${REQUIRED_QUOTES} quotes).`,
  );
  console.log(`Final pool: ${usable.length} movies with quotes (was ${movies.length}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
