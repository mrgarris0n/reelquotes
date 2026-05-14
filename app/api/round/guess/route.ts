import { NextResponse } from "next/server";
import { decodeRound, decodeScore, encodeRound, encodeScore } from "@/lib/token";
import { matches, matchesExact } from "@/lib/matcher";
import { anyHintUsed, totalHintCost } from "@/lib/hints";
import { isRoundExpired, isScoreExpired } from "@/lib/expiry";
import { POINTS_PER_QUOTE, STREAK_BONUS_CAP } from "@/lib/scoring";
import type { ScoreState } from "@/lib/types";

export const runtime = "nodejs";

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
  if (isRoundExpired(round.startedAt)) {
    return NextResponse.json({ error: "Round expired" }, { status: 410 });
  }

  const session: ScoreState | null = body.scoreToken ? decodeScore(body.scoreToken) : null;
  if (!session) {
    return NextResponse.json({ error: "Invalid score token" }, { status: 400 });
  }
  if (isScoreExpired(session.lastUpdatedAt)) {
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }
  if (round.sessionId !== session.id) {
    return NextResponse.json({ error: "Token mismatch" }, { status: 400 });
  }

  const difficulty = round.difficulty;
  const hintsUsed = round.hintsUsed ?? {};
  const hintCost = totalHintCost(hintsUsed);
  const hintCount =
    (hintsUsed.year ? 1 : 0) + (hintsUsed.genre ? 1 : 0) + (hintsUsed.title ? 1 : 0);

  const guess = (body.guess ?? "").trim();
  if (!guess) {
    return NextResponse.json({ error: "Empty guess — call /skip instead" }, { status: 400 });
  }

  const isMatch = body.exact
    ? matchesExact(guess, round.acceptableTitles[0] ?? "")
    : matches(guess, round.acceptableTitles);

  const prevStreak = session.streak ?? 0;
  const outcomes = session.outcomes ?? [];

  if (isMatch) {
    round.status = "won";
    const qualifiesForStreak = round.index === 0 && !anyHintUsed(hintsUsed);
    const basePoints = POINTS_PER_QUOTE[round.index] ?? 0;
    const streakBonus = qualifiesForStreak ? Math.min(STREAK_BONUS_CAP, prevStreak) : 0;
    const effectiveHintCost = qualifiesForStreak ? 0 : hintCost;
    const rawPoints = basePoints + streakBonus - effectiveHintCost;
    const points = Math.max(0, rawPoints);

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
      hintCost: effectiveHintCost,
      hintCount,
      pointsFloored: rawPoints < 0,
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
