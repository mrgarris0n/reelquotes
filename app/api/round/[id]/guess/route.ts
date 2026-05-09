import { NextResponse } from "next/server";
import { getRound, updateRound } from "@/lib/rounds";
import { matches } from "@/lib/matcher";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const round = getRound(id);
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.status !== "active") {
    return NextResponse.json({ error: "Round already finished" }, { status: 410 });
  }

  let body: { guess?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  const guess = (body.guess ?? "").trim();
  if (!guess) {
    return NextResponse.json({ error: "Empty guess — call /skip instead" }, { status: 400 });
  }

  if (matches(guess, round.acceptableTitles)) {
    round.status = "won";
    updateRound(round);
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
    updateRound(round);
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
  updateRound(round);
  return NextResponse.json({
    correct: false,
    failed: false,
    quote: round.quotes[nextIndex],
    index: nextIndex,
    total: round.quotes.length,
  });
}
