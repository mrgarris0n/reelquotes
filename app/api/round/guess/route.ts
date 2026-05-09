import { NextResponse } from "next/server";
import { decodeRound, decodeScore, encodeRound, encodeScore } from "@/lib/token";
import { matches } from "@/lib/matcher";
import type { ScoreState } from "@/lib/types";

export const runtime = "nodejs";

const POINTS_PER_QUOTE = [5, 4, 3, 2, 1];

export async function POST(req: Request) {
  let body: { token?: string; scoreToken?: string; guess?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const round = decodeRound(body.token ?? "");
  if (!round) return NextResponse.json({ error: "Invalid round token" }, { status: 400 });
  if (round.status !== "active") {
    return NextResponse.json({ error: "Round already finished" }, { status: 410 });
  }

  const guess = (body.guess ?? "").trim();
  if (!guess) {
    return NextResponse.json({ error: "Empty guess — call /skip instead" }, { status: 400 });
  }

  if (matches(guess, round.acceptableTitles)) {
    round.status = "won";
    const points = POINTS_PER_QUOTE[round.index] ?? 0;

    // Update or initialize the cumulative score token. If a token was passed
    // in, we trust its (signed) score; otherwise we start a new session.
    let session: ScoreState | null = body.scoreToken ? decodeScore(body.scoreToken) : null;
    if (!session) {
      session = {
        id: crypto.randomUUID(),
        score: 0,
        roundsWon: 0,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      };
    }
    session.score += points;
    session.roundsWon += 1;
    session.lastUpdatedAt = Date.now();

    return NextResponse.json({
      correct: true,
      title: round.title,
      year: round.year,
      imdbId: round.imdbId,
      quotesShown: round.quotes.slice(0, round.index + 1),
      points,
      scoreToken: encodeScore(session),
      score: session.score,
      roundsWon: session.roundsWon,
    });
  }

  // Wrong guess: behave like a skip — advance to the next quote, or end the round if exhausted.
  const nextIndex = round.index + 1;
  if (nextIndex >= round.quotes.length) {
    round.status = "lost";
    return NextResponse.json({
      correct: false,
      failed: true,
      title: round.title,
      year: round.year,
      imdbId: round.imdbId,
      quotesShown: round.quotes,
    });
  }

  round.index = nextIndex;
  return NextResponse.json({
    correct: false,
    failed: false,
    token: encodeRound(round),
    quote: round.quotes[nextIndex],
    index: nextIndex,
    total: round.quotes.length,
  });
}
