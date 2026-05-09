import { head, put } from "@vercel/blob";
import type { LeaderboardEntry } from "./types";

const BLOB_KEY = "leaderboard.json";
const MAX_ENTRIES = 20;

export const NAME_MAX_LEN = 10;
const NAME_RE = /[^A-Za-z0-9]/g;

export function sanitizeName(input: string): string {
  return input.replace(NAME_RE, "").slice(0, NAME_MAX_LEN);
}

async function readEntries(): Promise<LeaderboardEntry[]> {
  // `head` doesn't return content; we use `list` to find the blob URL, then fetch it.
  // If the blob doesn't exist yet, return an empty list.
  try {
    const meta = await head(BLOB_KEY);
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return [];
    const parsed = (await res.json()) as LeaderboardEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEntries(entries: LeaderboardEntry[]): Promise<void> {
  await put(BLOB_KEY, JSON.stringify(entries), {
    access: "public",
    contentType: "application/json",
    allowOverwrite: true,
    addRandomSuffix: false,
  });
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const entries = await readEntries();
  return entries.sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
}

/**
 * Submit a leaderboard entry. Idempotent per sessionId — once a session is
 * recorded, further submissions for the same id are silently ignored. Returns
 * the entry's rank (1-indexed) if it makes the top 20, otherwise null.
 */
export async function submitEntry(entry: LeaderboardEntry): Promise<number | null> {
  const existing = await readEntries();
  if (existing.some((e) => e.sessionId === entry.sessionId)) {
    // Already recorded — find its rank in the trimmed top 20.
    const sorted = [...existing].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
    const idx = sorted.findIndex((e) => e.sessionId === entry.sessionId);
    return idx === -1 ? null : idx + 1;
  }

  const next = [...existing, entry].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  await writeEntries(next);
  const idx = next.findIndex((e) => e.sessionId === entry.sessionId);
  return idx === -1 ? null : idx + 1;
}

