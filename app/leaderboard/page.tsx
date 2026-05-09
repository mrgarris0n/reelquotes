import Link from "next/link";
import { getLeaderboard } from "@/lib/leaderboard";
import type { Difficulty } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILTERS: { id: Difficulty | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "easy", label: "Easy" },
  { id: "normal", label: "Normal" },
  { id: "hard", label: "Hard" },
];

const VALID: Difficulty[] = ["easy", "normal", "hard"];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ difficulty?: string }>;
}) {
  const sp = await searchParams;
  const raw = sp.difficulty;
  const active: Difficulty | undefined = VALID.includes(raw as Difficulty)
    ? (raw as Difficulty)
    : undefined;

  let entries: Awaited<ReturnType<typeof getLeaderboard>> = [];
  let error: string | null = null;
  try {
    entries = await getLeaderboard(active);
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        <Link
          href="/"
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm transition hover:border-zinc-500"
        >
          ← Back
        </Link>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = (f.id === "all" && !active) || f.id === active;
          const href = f.id === "all" ? "/leaderboard" : `/leaderboard?difficulty=${f.id}`;
          return (
            <Link
              key={f.id}
              href={href}
              className={`rounded-full border px-4 py-1.5 text-sm transition ${
                isActive
                  ? "border-amber-300 bg-amber-300/10 text-amber-200"
                  : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-200">
          Couldn't load the leaderboard: {error}
        </div>
      )}

      {!error && entries.length === 0 && (
        <p className="text-zinc-400">
          No entries yet
          {active ? ` for ${active} mode` : ""} — be the first to make the board.
        </p>
      )}

      {entries.length > 0 && (
        <ol className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          {entries.map((e, i) => (
            <li
              key={e.sessionId}
              className="flex items-center justify-between gap-4 border-b border-zinc-800 px-5 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-4">
                <span
                  className={`w-8 text-right font-mono text-sm tabular-nums ${
                    i === 0
                      ? "text-amber-300"
                      : i < 3
                        ? "text-amber-200/70"
                        : "text-zinc-500"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="font-semibold text-zinc-100">{e.name}</span>
                {!active && (
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs uppercase tracking-wider text-zinc-400">
                    {e.difficulty}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-3 text-right">
                <span className="text-lg font-bold tabular-nums text-amber-300">
                  {e.score}
                </span>
                <span className="text-xs text-zinc-500">
                  {e.roundsWon} round{e.roundsWon === 1 ? "" : "s"}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
