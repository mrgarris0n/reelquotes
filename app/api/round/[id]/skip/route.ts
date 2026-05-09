import { NextResponse } from "next/server";
import { getRound, updateRound } from "@/lib/rounds";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const round = getRound(id);
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.status !== "active") {
    return NextResponse.json({ error: "Round already finished" }, { status: 410 });
  }

  const nextIndex = round.index + 1;
  if (nextIndex >= round.quotes.length) {
    round.status = "lost";
    updateRound(round);
    return NextResponse.json({
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
    quote: round.quotes[nextIndex],
    index: nextIndex,
    total: round.quotes.length,
  });
}
