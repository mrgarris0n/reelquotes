import { get, put, BlobNotFoundError } from "@vercel/blob";
import type { Difficulty, LeaderboardEntry } from "./types";

export { NAME_MAX_LEN, sanitizeName } from "./name";

const BLOB_KEY = "leaderboard.json";
const MAX_ENTRIES = 20;

async function readEntries(): Promise<LeaderboardEntry[]> {
  try {
    const result = await get(BLOB_KEY, { access: "private" });
    if (!result || result.statusCode !== 200) return [];
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text) as LeaderboardEntry[];
    if (!Array.isArray(parsed)) return [];
    // Backfill: entries written before difficulty existed are treated as "hard".
    return parsed.map((e) => ({ ...e, difficulty: e.difficulty ?? "hard" }));
  } catch (err) {
    if (err instanceof BlobNotFoundError) return [];
    throw err;
  }
}

async function writeEntries(entries: LeaderboardEntry[]): Promise<void> {
  await put(BLOB_KEY, JSON.stringify(entries), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
    addRandomSuffix: false,
    // Vercel Blob defaults to a 30-day edge TTL — way too long for a
    // leaderboard that should reflect new submissions immediately.
    cacheControlMaxAge: 0,
  });
}

export async function getLeaderboard(
  difficulty?: Difficulty,
): Promise<LeaderboardEntry[]> {
  const entries = await readEntries();
  const filtered = difficulty ? entries.filter((e) => e.difficulty === difficulty) : entries;
  return filtered.sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
}

/**
 * Submit a leaderboard entry. Idempotent per sessionId — once a session is
 * recorded, further submissions for the same id are silently ignored. Returns
 * the entry's rank (1-indexed) if it makes the top 20, otherwise null.
 */
export async function submitEntry(entry: LeaderboardEntry): Promise<number | null> {
  const existing = await readEntries();
  if (existing.some((e) => e.sessionId === entry.sessionId)) {
    const sorted = [...existing].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
    const idx = sorted.findIndex((e) => e.sessionId === entry.sessionId);
    return idx === -1 ? null : idx + 1;
  }

  const next = [...existing, entry].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  await writeEntries(next);
  const idx = next.findIndex((e) => e.sessionId === entry.sessionId);
  return idx === -1 ? null : idx + 1;
}
