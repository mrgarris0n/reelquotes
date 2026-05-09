import { NextResponse } from "next/server";
import { pickRandom } from "@/lib/pool";
import { scrapeQuotes } from "@/lib/scraper";
import { buildAcceptableTitles } from "@/lib/matcher";
import { encodeRound } from "@/lib/token";
import type { Filters, RoundState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { filters?: Filters } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const filters: Filters = body.filters ?? {};

  let movie;
  try {
    movie = pickRandom(filters);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

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
    console.error(`Failed to load quotes for ${movie.id}:`, err);
    return NextResponse.json({ error: "Could not load quotes for the picked movie." }, { status: 500 });
  }
}
