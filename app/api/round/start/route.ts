import { NextResponse } from "next/server";
import { pickRandom } from "@/lib/pool";
import { pickQuotes } from "@/lib/scraper";
import { buildAcceptableTitles } from "@/lib/matcher";
import { decodeScore, encodeRound, encodeScore } from "@/lib/token";
import { isScoreExpired } from "@/lib/expiry";
import type { Difficulty, Filters, RoundState, ScoreState } from "@/lib/types";

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

  // If a score token came in, it must be valid and not expired — that's the
  // session we'll bind this round to. Otherwise mint a fresh session.
  let session: ScoreState | null = null;
  if (body.scoreToken) {
    session = decodeScore(body.scoreToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid score token" }, { status: 400 });
    }
    if (isScoreExpired(session.lastUpdatedAt)) {
      return NextResponse.json({ error: "Score token expired" }, { status: 410 });
    }
  }

  const difficulty: Difficulty = session
    ? session.difficulty
    : normalizeDifficulty(body.difficulty, "hard");

  if (!session) {
    session = {
      id: crypto.randomUUID(),
      score: 0,
      roundsWon: 0,
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      difficulty,
      streak: 0,
      outcomes: [],
    };
  }

  let movie;
  try {
    movie = pickRandom(filters);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const quotes = pickQuotes(movie.id, difficulty);
    const round: RoundState = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      imdbId: movie.id,
      title: movie.title,
      year: movie.year,
      acceptableTitles: buildAcceptableTitles(movie.title),
      quotes,
      index: 0,
      status: "active",
      startedAt: Date.now(),
      difficulty,
      hintsUsed: {},
    };
    return NextResponse.json({
      token: encodeRound(round),
      scoreToken: encodeScore(session),
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
