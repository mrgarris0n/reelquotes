import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { decodeScore } from "@/lib/token";
import { getLeaderboard, sanitizeName, submitEntry, NAME_MAX_LEN } from "@/lib/leaderboard";
import type { Difficulty, LeaderboardEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: Difficulty[] = ["easy", "normal", "hard"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("difficulty");
  const difficulty = VALID.includes(raw as Difficulty) ? (raw as Difficulty) : undefined;
  const noCacheHeaders = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
  };
  try {
    const entries = await getLeaderboard(difficulty);
    return NextResponse.json({ entries }, { headers: noCacheHeaders });
  } catch (err) {
    console.error("Leaderboard read failed:", err);
    return NextResponse.json(
      { error: "Failed to read leaderboard" },
      { status: 500, headers: noCacheHeaders },
    );
  }
}

export async function POST(req: Request) {
  const verification = await checkBotId();
  if (verification.isBot) {
    return NextResponse.json({ error: "Bot detected" }, { status: 403 });
  }

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
    difficulty: session.difficulty ?? "hard",
  };

  try {
    const rank = await submitEntry(entry);
    return NextResponse.json({ ok: true, rank, entry });
  } catch (err) {
    console.error("Leaderboard write failed:", err);
    return NextResponse.json({ error: "Failed to save entry" }, { status: 500 });
  }
}
