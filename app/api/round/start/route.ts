import { NextResponse } from "next/server";
import { pickRandom } from "@/lib/pool";
import { scrapeQuotes, InsufficientQuotesError } from "@/lib/scraper";
import { buildAcceptableTitles } from "@/lib/matcher";
import { encodeRound } from "@/lib/token";
import type { Filters, RoundState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 6;

export async function POST(req: Request) {
  let body: { filters?: Filters } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const filters: Filters = body.filters ?? {};

  const tried = new Set<string>();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let movie;
    try {
      movie = pickRandom(filters);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    if (tried.has(movie.id)) continue;
    tried.add(movie.id);

    try {
      const quotes = await scrapeQuotes(movie.id);
      const round: RoundState = {
        id: crypto.randomUUID(),
        imdbId: movie.id,
        title: movie.title,
        year: movie.year,
        acceptableTitles: buildAcceptableTitles(movie.title),
        quotes,
        index: 0,
        status: "active",
        startedAt: Date.now(),
      };
      return NextResponse.json({
        token: encodeRound(round),
        quote: round.quotes[0],
        index: 0,
        total: round.quotes.length,
      });
    } catch (err) {
      lastError = err;
      if (err instanceof InsufficientQuotesError) continue;
      console.warn(`Scrape failed for ${movie.id}:`, (err as Error).message);
      continue;
    }
  }

  console.error("Could not start a round after retries", lastError);
  return NextResponse.json(
    { error: "Could not find a movie with enough quotes. Try different filters." },
    { status: 503 },
  );
}
