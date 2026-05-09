import { NextResponse } from "next/server";
import { pickRandom } from "@/lib/pool";
import { scrapeQuotes } from "@/lib/scraper";
import { buildAcceptableTitles } from "@/lib/matcher";
import { decodeScore, encodeRound } from "@/lib/token";
import type { Difficulty, Filters, RoundState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

function normalizeDifficulty(raw: unknown, fallback: Difficulty): Difficulty {
  return typeof raw === "string" && VALID_DIFFICULTIES.includes(raw as Difficulty)
    ? (raw as Difficulty)
    : fallback;
}

export async function POST(req: Request) {
  let body: { filters?: Filters; difficulty?: string; scoreToken?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const filters: Filters = body.filters ?? {};

  // Difficulty is locked to the session: if a scoreToken is in flight, derive
  // it from there; otherwise take what the body says.
  const session = body.scoreToken ? decodeScore(body.scoreToken) : null;
  const difficulty: Difficulty = session
    ? session.difficulty ?? "hard"
    : normalizeDifficulty(body.difficulty, "hard");

  let movie;
  try {
    movie = pickRandom(filters);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const quotes = await scrapeQuotes(movie.id, difficulty);
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
      difficulty,
    };
    return NextResponse.json({
      token: encodeRound(round),
      quote: round.quotes[0],
      index: 0,
      total: round.quotes.length,
      difficulty,
      year: difficulty === "hard" ? undefined : round.year,
    });
  } catch (err) {
    console.error(`Failed to load quotes for ${movie.id}:`, err);
    return NextResponse.json({ error: "Could not load quotes for the picked movie." }, { status: 500 });
  }
}
