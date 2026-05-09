import { NextResponse } from "next/server";
import { decodeRound, encodeRound } from "@/lib/token";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { token?: string } = {};
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
    return NextResponse.json({
      failed: true,
      title: round.title,
      year: round.year,
      imdbId: round.imdbId,
      quotesShown: round.quotes,
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
