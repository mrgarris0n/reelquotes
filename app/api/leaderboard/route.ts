import { NextResponse } from "next/server";
import { decodeScore } from "@/lib/token";
import { getLeaderboard, sanitizeName, submitEntry, NAME_MAX_LEN } from "@/lib/leaderboard";
import type { LeaderboardEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await getLeaderboard();
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("Leaderboard read failed:", err);
    return NextResponse.json({ error: "Failed to read leaderboard" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { name?: string; scoreToken?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = sanitizeName((body.name ?? "").trim());
  if (!name) {
    return NextResponse.json(
      { error: `Name must be 1–${NAME_MAX_LEN} alphanumeric characters` },
      { status: 400 },
    );
  }

  const session = decodeScore(body.scoreToken ?? "");
  if (!session) {
    return NextResponse.json({ error: "Invalid score token" }, { status: 400 });
  }
  if (session.score <= 0) {
    return NextResponse.json({ error: "Score must be greater than zero" }, { status: 400 });
  }

  const entry: LeaderboardEntry = {
    name,
    score: session.score,
    roundsWon: session.roundsWon,
    sessionId: session.id,
    submittedAt: Date.now(),
  };

  try {
    const rank = await submitEntry(entry);
    return NextResponse.json({ ok: true, rank, entry });
  } catch (err) {
    console.error("Leaderboard write failed:", err);
    return NextResponse.json({ error: "Failed to save entry" }, { status: 500 });
  }
}
