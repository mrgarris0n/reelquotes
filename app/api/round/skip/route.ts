import { NextResponse } from "next/server";
import { decodeRound, decodeScore, encodeRound, encodeScore } from "@/lib/token";
import { isRoundExpired, isScoreExpired } from "@/lib/expiry";
import type { ScoreState } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { token?: string; scoreToken?: string } = {};
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

  const nextIndex = round.index + 1;
  if (nextIndex >= round.quotes.length) {
    round.status = "lost";
    session.streak = 0;
    session.outcomes = [...(session.outcomes ?? []), -1];
    session.lastUpdatedAt = Date.now();
    return NextResponse.json({
      failed: true,
      title: round.title,
      year: round.year,
      imdbId: round.imdbId,
      quotesShown: round.quotes,
      scoreToken: encodeScore(session),
      outcomes: session.outcomes,
    });
  }

  round.index = nextIndex;
  const difficulty = round.difficulty;
  return NextResponse.json({
    token: encodeRound(round),
    quote: round.quotes[nextIndex],
    index: nextIndex,
    total: round.quotes.length,
    year: difficulty === "hard" ? undefined : round.year,
  });
}
