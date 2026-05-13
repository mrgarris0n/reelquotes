import { NextResponse } from "next/server";
import { decodeRound, encodeRound } from "@/lib/token";
import { findById } from "@/lib/pool";
import { maskTitle, type HintsUsed } from "@/lib/hints";
import type { HintKind, RoundState } from "@/lib/types";

export const runtime = "nodejs";

const VALID_HINTS: HintKind[] = ["year", "genre", "title"];

export async function POST(req: Request) {
  let body: { token?: string; hint?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const round = decodeRound(body.token ?? "");
  if (!round) return NextResponse.json({ error: "Invalid round token" }, { status: 400 });
  if (round.status !== "active") {
    return NextResponse.json({ error: "Round already finished" }, { status: 410 });
  }

  const hint = body.hint as HintKind | undefined;
  if (!hint || !VALID_HINTS.includes(hint)) {
    return NextResponse.json({ error: "Unknown hint type" }, { status: 400 });
  }

  const hintsUsed: HintsUsed = round.hintsUsed ?? {};
  if (!hintsUsed[hint]) {
    hintsUsed[hint] = true;
    round.hintsUsed = hintsUsed;
  }

  return NextResponse.json({ token: encodeRound(round), ...buildReveal(round, hintsUsed) });
}

function buildReveal(
  round: RoundState,
  hintsUsed: HintsUsed,
): { year?: number; genres?: string[]; titleMask?: string } {
  const out: { year?: number; genres?: string[]; titleMask?: string } = {};
  if (hintsUsed.year) out.year = round.year;
  if (hintsUsed.genre) {
    const movie = findById(round.imdbId);
    out.genres = movie?.genres ?? [];
  }
  if (hintsUsed.title) out.titleMask = maskTitle(round.title);
  return out;
}
