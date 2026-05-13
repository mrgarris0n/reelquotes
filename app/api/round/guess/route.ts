import { NextResponse } from "next/server";
import { decodeRound, decodeScore, encodeRound, encodeScore } from "@/lib/token";
import { matches, matchesExact } from "@/lib/matcher";
import type { Difficulty, ScoreState } from "@/lib/types";

export const runtime = "nodejs";

const POINTS_PER_QUOTE = [5, 4, 3, 2, 1];
const STREAK_BONUS_CAP = 5;
const HINT_COST_PER = 1;

export async function POST(req: Request) {
  let body: { token?: string; scoreToken?: string; guess?: string; exact?: boolean } = {};
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
  const difficulty: Difficulty = round.difficulty ?? "hard";
  const hintsUsed = round.hintsUsed ?? {};
  const hintCount = (hintsUsed.year ? 1 : 0) + (hintsUsed.genre ? 1 : 0);

  const guess = (body.guess ?? "").trim();
  if (!guess) {
    return NextResponse.json({ error: "Empty guess — call /skip instead" }, { status: 400 });
  }

  const isMatch = body.exact
    ? matchesExact(guess, round.acceptableTitles[0] ?? "")
    : matches(guess, round.acceptableTitles);

  let session: ScoreState | null = body.scoreToken ? decodeScore(body.scoreToken) : null;
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
  const prevStreak = session.streak ?? 0;
  const outcomes = session.outcomes ?? [];

  if (isMatch) {
    round.status = "won";
    const qualifiesForStreak = round.index === 0 && hintCount === 0;
    const basePoints = POINTS_PER_QUOTE[round.index] ?? 0;
    const streakBonus = qualifiesForStreak ? Math.min(STREAK_BONUS_CAP, prevStreak) : 0;
    const hintCost = qualifiesForStreak ? 0 : hintCount * HINT_COST_PER;
    const rawPoints = basePoints + streakBonus - hintCost;
    const points = Math.max(1, rawPoints);

    session.score += points;
    session.roundsWon += 1;
    session.streak = qualifiesForStreak ? prevStreak + 1 : 0;
    session.outcomes = [...outcomes, round.index];
    session.lastUpdatedAt = Date.now();

    return NextResponse.json({
      correct: true,
      title: round.title,
      year: round.year,
      imdbId: round.imdbId,
      quotesShown: round.quotes.slice(0, round.index + 1),
      points,
      basePoints,
      streakBonus,
      hintCost,
      hintCount,
      pointsFloored: rawPoints < 1,
      scoreToken: encodeScore(session),
      score: session.score,
      roundsWon: session.roundsWon,
      streak: session.streak,
    });
  }

  // Wrong guess: advance to the next quote, or end the round if exhausted.
  const nextIndex = round.index + 1;
  if (nextIndex >= round.quotes.length) {
    round.status = "lost";
    session.streak = 0;
    session.outcomes = [...outcomes, -1];
    session.lastUpdatedAt = Date.now();
    return NextResponse.json({
      correct: false,
      failed: true,
      title: round.title,
      year: round.year,
      imdbId: round.imdbId,
      quotesShown: round.quotes,
      scoreToken: encodeScore(session),
      score: session.score,
      roundsWon: session.roundsWon,
      outcomes: session.outcomes,
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
    year: difficulty === "hard" ? undefined : round.year,
  });
}
