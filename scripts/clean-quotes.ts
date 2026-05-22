/**
 * Apply the parser's current cleaning rules — bracketed stage-direction
 * stripping + long-line trimming — to data/quotes.json in place, without
 * re-scraping Wikiquote. Drops quotes that fall below the usable threshold
 * after cleanup, and drops titles that fall below 5 quotes; rewrites
 * data/movies.json accordingly.
 *
 * Idempotent: re-running on already-clean data is a no-op.
 *
 * Run with: npx tsx scripts/clean-quotes.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chunkDialogue, repairOrphanBrackets, trimLongLines } from "../lib/wikiquote-parse";
import type { Movie, Quote, QuoteLine } from "../lib/types";

const MOVIES_PATH = path.join(process.cwd(), "data", "movies.json");
const QUOTES_PATH = path.join(process.cwd(), "data", "quotes.json");
const MIN_QUOTE_CHARS = 15;
const REQUIRED_QUOTES = 5;
const QUOTE_CAP = 20; // mirror scripts/build-quotes.ts

function cleanLine(l: QuoteLine): QuoteLine {
  const text = trimLongLines(repairOrphanBrackets(l.text));
  const speaker = repairOrphanBrackets(l.speaker);
  return { speaker, text };
}

function cleanQuote(q: Quote): Quote[] {
  const lines = q.lines.map(cleanLine).filter((l) => l.text);
  if (lines.length === 0) return [];
  if (lines.reduce((a, l) => a + l.text.length, 0) < MIN_QUOTE_CHARS) return [];
  if (lines.length <= 1) return [{ lines }];
  return chunkDialogue(lines)
    .filter((chunk) => chunk.reduce((a, l) => a + l.text.length, 0) >= MIN_QUOTE_CHARS)
    .map((chunk) => ({ lines: chunk }));
}

async function main(): Promise<void> {
  const movies = JSON.parse(await readFile(MOVIES_PATH, "utf8")) as Movie[];
  const quotes = JSON.parse(await readFile(QUOTES_PATH, "utf8")) as Record<string, Quote[]>;

  let quotesIn = 0,
    quotesOut = 0;
  const cleaned: Record<string, Quote[]> = {};
  for (const [id, qs] of Object.entries(quotes)) {
    quotesIn += qs.length;
    const out: Quote[] = [];
    for (const q of qs) out.push(...cleanQuote(q));
    // Cap per movie — chunking can multiply quotes well past the scrape cap.
    // Deterministic (first N) for idempotency on re-runs.
    cleaned[id] = out.slice(0, QUOTE_CAP);
    quotesOut += cleaned[id]!.length;
  }

  const usable = movies.filter((m) => (cleaned[m.id]?.length ?? 0) >= REQUIRED_QUOTES);
  const pruned: Record<string, Quote[]> = {};
  for (const m of usable) pruned[m.id] = cleaned[m.id]!;

  await writeFile(QUOTES_PATH, JSON.stringify(pruned), "utf8");
  await writeFile(MOVIES_PATH, JSON.stringify(usable), "utf8");

  console.log(
    `Cleaned ${quotesIn} → ${quotesOut} quotes (${quotesIn - quotesOut} dropped).`,
  );
  console.log(
    `Final pool: ${usable.length} titles (was ${movies.length}, dropped ${movies.length - usable.length}).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
