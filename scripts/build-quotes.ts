import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Movie, Quote, QuoteLine } from "../lib/types";

const ENDPOINT = "https://caching.graphql.imdb.com/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const QUERY = `query Quotes($id: ID!, $first: Int!) {
  title(id: $id) {
    quotes(first: $first) {
      edges { node { lines { characters { character } text } } }
    }
  }
}`;

const MOVIES_PATH = path.join(process.cwd(), "data", "movies.json");
const QUOTES_PATH = path.join(process.cwd(), "data", "quotes.json");

const TIERS_TO_INCLUDE = new Set(["iconic", "popular"] as const);
const FETCH_PAGE_SIZE = 50;
const QUOTE_CAP = 20;
const MIN_QUOTE_CHARS = 15;
const REQUIRED_QUOTES = 5;
const CONCURRENCY = 4;
const CHECKPOINT_EVERY = 50;

interface GqlLine {
  characters: { character: string | null }[] | null;
  text: string | null;
}
interface GqlResponse {
  data?: { title?: { quotes?: { edges?: { node?: { lines?: GqlLine[] } }[] } } };
  errors?: { message: string }[];
}

function isStageDirection(text: string): boolean {
  const t = text.trim();
  return t.startsWith("[") && t.endsWith("]");
}

function isUsable(quote: Quote): boolean {
  if (quote.lines.length === 0) return false;
  if (quote.lines.every((l) => isStageDirection(l.text))) return false;
  const total = quote.lines.reduce((s, l) => s + l.text.length, 0);
  return total >= MIN_QUOTE_CHARS;
}

function toQuote(lines: GqlLine[] | undefined): Quote | null {
  if (!lines) return null;
  const out: QuoteLine[] = [];
  for (const line of lines) {
    const text = (line.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const speaker = line.characters?.[0]?.character?.trim() ?? "";
    out.push({ speaker, text });
  }
  if (out.length === 0) return null;
  return { lines: out };
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function fetchQuotes(imdbId: string): Promise<Quote[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      "x-imdb-client-name": "imdb-web-next",
      "x-imdb-user-language": "en-US",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { id: imdbId, first: FETCH_PAGE_SIZE },
      operationName: "Quotes",
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as GqlResponse;
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  const edges = json.data?.title?.quotes?.edges ?? [];
  const quotes: Quote[] = [];
  for (const edge of edges) {
    const q = toQuote(edge.node?.lines);
    if (q && isUsable(q)) quotes.push(q);
  }
  return quotes;
}

async function loadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function saveQuotes(map: Record<string, Quote[]>): Promise<void> {
  await mkdir(path.dirname(QUOTES_PATH), { recursive: true });
  await writeFile(QUOTES_PATH, JSON.stringify(map), "utf8");
}

async function main(): Promise<void> {
  const movies = JSON.parse(await readFile(MOVIES_PATH, "utf8")) as Movie[];
  const target = movies.filter((m) => TIERS_TO_INCLUDE.has(m.tier as "iconic" | "popular"));
  const existing = await loadJson<Record<string, Quote[]>>(QUOTES_PATH, {});

  const todo = target.filter((m) => !(m.id in existing));
  console.log(`Movies in scope: ${target.length}`);
  console.log(`Already scraped: ${target.length - todo.length}`);
  console.log(`To scrape: ${todo.length} (concurrency=${CONCURRENCY})`);

  let completed = 0;
  let failed = 0;
  let dropped = 0;
  let inFlight = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < todo.length) {
      const movie = todo[cursor++];
      inFlight++;
      try {
        const all = await fetchQuotes(movie.id);
        if (all.length < REQUIRED_QUOTES) {
          dropped++;
          existing[movie.id] = []; // sentinel so we don't retry
        } else {
          const sample = shuffle(all).slice(0, QUOTE_CAP);
          existing[movie.id] = sample;
        }
      } catch (err) {
        failed++;
        console.warn(`  ! ${movie.id} (${movie.title}): ${(err as Error).message}`);
      }
      inFlight--;
      completed++;
      if (completed % CHECKPOINT_EVERY === 0) {
        await saveQuotes(existing);
        console.log(
          `  ${completed}/${todo.length} done · ${dropped} dropped · ${failed} failed`,
        );
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  await saveQuotes(existing);

  // Filter movies.json to only keep entries that have >=REQUIRED_QUOTES quotes.
  const usable = movies.filter((m) => {
    const q = existing[m.id];
    return q && q.length >= REQUIRED_QUOTES;
  });
  await writeFile(MOVIES_PATH, JSON.stringify(usable), "utf8");

  console.log(
    `\nDone. Scraped ${completed} new, ${failed} errors, ${dropped} dropped (insufficient quotes).`,
  );
  console.log(`Final pool: ${usable.length} movies with quotes (was ${movies.length}).`);
}

void main();
