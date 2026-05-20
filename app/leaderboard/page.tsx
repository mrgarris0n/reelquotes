"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Difficulty, LeaderboardEntry } from "@/lib/types";

const FILTERS: { id: Difficulty | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "easy", label: "Easy" },
  { id: "normal", label: "Normal" },
  { id: "hard", label: "Hard" },
];

const RANK_GLYPH = (i: number) => (i === 0 ? "★" : i === 1 ? "◆" : i === 2 ? "◇" : "·");

export default function LeaderboardPage() {
  const [active, setActive] = useState<Difficulty | "all">("all");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const base =
      active === "all" ? "/api/leaderboard" : `/api/leaderboard?difficulty=${active}`;
    const sep = base.includes("?") ? "&" : "?";
    const url = `${base}${sep}t=${Date.now()}`;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Failed to load leaderboard");
          setEntries([]);
        } else {
          setEntries(data.entries ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <main className="mx-auto max-w-4xl px-5 pb-16 pt-8 sm:px-6 sm:pt-12">
      <header className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-body text-base uppercase tracking-[0.3em] text-neon-pink">
            ◤ Top 20 ◢
          </p>
          <h1 className="crt-shift font-display text-4xl uppercase leading-none text-cream sm:text-5xl">
            Leaderboard
          </h1>
        </div>
        <Link
          href="/"
          className="press-btn bg-transparent px-4 py-2 font-body text-lg uppercase tracking-wider text-cream tape-border hover:text-neon-orange"
        >
          ◀◀ Back
        </Link>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = f.id === active;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setActive(f.id)}
              className={
                "chip border-2 px-3 py-1 font-body text-base uppercase tracking-wider transition " +
                (isActive
                  ? "border-cream bg-neon-pink text-ink-deep"
                  : "border-cream/40 bg-transparent text-cream hover:text-ink-deep")
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="tape-border bg-neon-red/10 p-4 font-body text-base text-cream" style={{ borderColor: "#ff5160" }}>
          Couldn&apos;t load the leaderboard: {error}
        </div>
      )}

      {!error && loading && (
        <p className="font-body text-xl uppercase tracking-[0.3em] text-cream-dim">
          ░ Reading tape ░░░░ ▓▓
        </p>
      )}

      {!error && !loading && entries.length === 0 && (
        <p className="font-body text-lg text-cream-dim">
          ▶ No entries yet
          {active !== "all" ? ` for ${active} mode` : ""} — be the first to make the board.
        </p>
      )}

      {!loading && entries.length > 0 && (
        <ol className="tape-border-pink shadow-vhs-pink overflow-hidden bg-ink-veil/40">
          {entries.map((e, i) => (
            <li
              key={e.sessionId}
              className="flex items-center justify-between gap-3 border-b border-cream/15 px-4 py-3 last:border-b-0 sm:px-5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={
                    "w-10 shrink-0 text-right font-display text-2xl tabular-nums " +
                    (i === 0
                      ? "text-neon-pink"
                      : i < 3
                        ? "text-neon-orange"
                        : "text-cream-smoke")
                  }
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={
                    "shrink-0 font-body text-xl " +
                    (i < 3 ? "text-neon-pink" : "text-cream-smoke")
                  }
                  aria-hidden
                >
                  {RANK_GLYPH(i)}
                </span>
                <span className="truncate font-body text-lg text-cream">{e.name}</span>
                {active === "all" && (
                  <span className="hidden shrink-0 border border-cream/30 px-2 py-0.5 font-body text-sm uppercase tracking-wider text-cream-dim sm:inline">
                    {e.difficulty}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-3 text-right">
                <span className="font-display text-2xl tabular-nums text-neon-pink">
                  {e.score}
                </span>
                <span className="hidden font-body text-base text-cream-smoke sm:inline">
                  {e.roundsWon} rd{e.roundsWon === 1 ? "" : "s"}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
