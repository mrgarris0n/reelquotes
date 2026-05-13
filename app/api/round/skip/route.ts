import { NextResponse } from "next/server";
import { decodeRound, decodeScore, encodeRound, encodeScore } from "@/lib/token";
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

  const nextIndex = round.index + 1;
  if (nextIndex >= round.quotes.length) {
    round.status = "lost";
    // Skipping past the last quote also ends the game; update the score
    // token's streak/outcomes so the share grid and streak are accurate.
    const session: ScoreState | null = body.scoreToken ? decodeScore(body.scoreToken) : null;
    if (session) {
      session.streak = 0;
      session.outcomes = [...(session.outcomes ?? []), -1];
      session.lastUpdatedAt = Date.now();
    }
    return NextResponse.json({
      failed: true,
      title: round.title,
      year: round.year,
      imdbId: round.imdbId,
      quotesShown: round.quotes,
      scoreToken: session ? encodeScore(session) : undefined,
      outcomes: session?.outcomes,
    });
  }

  round.index = nextIndex;
  const difficulty = round.difficulty ?? "hard";
  return NextResponse.json({
    token: encodeRound(round),
    quote: round.quotes[nextIndex],
    index: nextIndex,
    total: round.quotes.length,
    year: difficulty === "hard" ? undefined : round.year,
  });
}
