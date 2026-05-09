import { NextResponse } from "next/server";
import { decodeRound, encodeRound } from "@/lib/token";
import { matches } from "@/lib/matcher";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { token?: string; guess?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = body.token ?? "";
  const round = decodeRound(token);
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
    return NextResponse.json({
      correct: true,
      title: round.title,
      year: round.year,
      imdbId: round.imdbId,
      quotesShown: round.quotes.slice(0, round.index + 1),
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
