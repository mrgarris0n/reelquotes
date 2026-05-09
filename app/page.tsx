"use client";

import { useState } from "react";
import type { Decade, Filters, PopularityTier, Quote } from "@/lib/types";

const DECADES: Decade[] = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];
const TIERS: { id: PopularityTier; label: string; hint: string }[] = [
  { id: "iconic", label: "Iconic", hint: "500k+ votes" },
  { id: "popular", label: "Popular", hint: "100k+ votes" },
  { id: "known", label: "Known", hint: "25k+ votes" },
  { id: "niche", label: "Niche", hint: "5k+ votes" },
];

const POINTS_PER_QUOTE = [5, 4, 3, 2, 1];

type Phase =
  | { kind: "setup" }
  | { kind: "loading" }
  | {
      kind: "playing";
      token: string;
      quote: Quote;
      index: number;
      total: number;
      pendingSkip?: boolean;
      lastWrongGuess?: string;
    }
  | {
      kind: "roundWon";
      points: number;
      title: string;
      year: number;
      imdbId: string;
      quotes: Quote[];
    }
  | {
      kind: "gameOver";
      title: string;
      year: number;
      imdbId: string;
      quotes: Quote[];
    }
  | { kind: "error"; message: string };

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function QuoteBlock({ quote }: { quote: Quote }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 font-mono text-base leading-relaxed shadow-inner">
      {quote.lines.map((line, i) => (
        <p key={i} className="mb-2 last:mb-0">
          {line.speaker ? (
            <>
              <span className="text-amber-300">{line.speaker}:</span>{" "}
              <span className="text-zinc-100">{line.text}</span>
            </>
          ) : (
            <span className="text-zinc-100">{line.text}</span>
          )}
        </p>
      ))}
    </div>
  );
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [decades, setDecades] = useState<Decade[]>([]);
  const [tiers, setTiers] = useState<PopularityTier[]>(["iconic", "popular"]);
  const [guess, setGuess] = useState("");
  const [score, setScore] = useState(0);
  const [roundsWon, setRoundsWon] = useState(0);

  function currentFilters(): Filters {
    const f: Filters = {};
    if (decades.length) f.decades = decades;
    if (tiers.length) f.tiers = tiers;
    return f;
  }

  async function startRound() {
    setPhase({ kind: "loading" });
    try {
      const res = await fetch("/api/round/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: currentFilters() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase({ kind: "error", message: data.error ?? "Failed to start round" });
        return;
      }
      setPhase({
        kind: "playing",
        token: data.token,
        quote: data.quote,
        index: data.index,
        total: data.total,
      });
      setGuess("");
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    }
  }

  function startGame() {
    setScore(0);
    setRoundsWon(0);
    void startRound();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase.kind !== "playing") return;
    const trimmed = guess.trim();
    if (trimmed === "") {
      await skip();
    } else {
      await sendGuess(trimmed);
    }
  }

  async function sendGuess(g: string) {
    if (phase.kind !== "playing") return;
    const indexAtGuess = phase.index;
    const res = await fetch("/api/round/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: phase.token, guess: g }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPhase({ kind: "error", message: data.error ?? "Guess failed" });
      return;
    }
    if (data.correct) {
      const points = POINTS_PER_QUOTE[indexAtGuess] ?? 0;
      setScore((s) => s + points);
      setRoundsWon((r) => r + 1);
      setPhase({
        kind: "roundWon",
        points,
        title: data.title,
        year: data.year,
        imdbId: data.imdbId,
        quotes: data.quotesShown ?? [phase.quote],
      });
      return;
    }
    if (data.failed) {
      setPhase({
        kind: "gameOver",
        title: data.title,
        year: data.year,
        imdbId: data.imdbId,
        quotes: data.quotesShown ?? [phase.quote],
      });
      return;
    }
    // Wrong guess but more quotes remain — advance like a skip.
    setPhase({
      kind: "playing",
      token: data.token,
      quote: data.quote,
      index: data.index,
      total: data.total,
      lastWrongGuess: g,
    });
    setGuess("");
  }

  async function skip() {
    if (phase.kind !== "playing") return;
    const tokenAtSkip = phase.token;
    setPhase({ ...phase, pendingSkip: true });
    const res = await fetch("/api/round/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenAtSkip }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPhase({ kind: "error", message: data.error ?? "Skip failed" });
      return;
    }
    if (data.failed) {
      setPhase({
        kind: "gameOver",
        title: data.title,
        year: data.year,
        imdbId: data.imdbId,
        quotes: data.quotesShown,
      });
    } else {
      setPhase({
        kind: "playing",
        token: data.token,
        quote: data.quote,
        index: data.index,
        total: data.total,
      });
      setGuess("");
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">ReelQuotes</h1>
          <p className="mt-2 text-zinc-400">
            Guess the movie from its quotes. Skip with an empty guess. Five quotes max per round.
          </p>
        </div>
        {phase.kind !== "setup" && (
          <div className="shrink-0 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-right">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Score</div>
            <div className="text-2xl font-bold tabular-nums text-amber-300">{score}</div>
            <div className="text-xs text-zinc-500">
              {roundsWon} round{roundsWon === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </header>

      {phase.kind === "setup" && (
        <section className="space-y-8">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-300">
            <p className="font-semibold text-zinc-100">Scoring</p>
            <p className="mt-1 text-zinc-400">
              5 points if you guess on quote 1, 4 on quote 2, … 1 on quote 5. Wrong guesses just
              show the next quote — the game ends when you run out of quotes for a movie.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-sm uppercase tracking-wider text-zinc-400">Era</h2>
            <div className="flex flex-wrap gap-2">
              {DECADES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDecades(toggle(decades, d))}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    decades.includes(d)
                      ? "border-amber-300 bg-amber-300/10 text-amber-200"
                      : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              {decades.length === 0 ? "Any era" : decades.join(", ")}
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-sm uppercase tracking-wider text-zinc-400">Difficulty</h2>
            <div className="flex flex-wrap gap-2">
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTiers(toggle(tiers, t.id))}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    tiers.includes(t.id)
                      ? "border-amber-300 bg-amber-300/10 text-amber-200"
                      : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                  }`}
                  title={t.hint}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              {tiers.length === 0 ? "Defaulting to iconic + popular" : tiers.join(", ")}
            </p>
          </div>

          <button
            onClick={startGame}
            className="w-full rounded-lg bg-amber-300 px-6 py-3 font-semibold text-zinc-900 transition hover:bg-amber-200"
          >
            Start game
          </button>
        </section>
      )}

      {phase.kind === "loading" && (
        <p className="text-zinc-400">Picking a movie and pulling quotes…</p>
      )}

      {phase.kind === "playing" && (
        <section className="space-y-6">
          <div className="flex items-center justify-between text-sm text-zinc-400">
            <span>
              Quote{" "}
              <span className="font-semibold text-zinc-200">
                {phase.index + 1} / {phase.total}
              </span>{" "}
              <span className="text-zinc-500">
                · worth {POINTS_PER_QUOTE[phase.index]} pt
                {POINTS_PER_QUOTE[phase.index] === 1 ? "" : "s"}
              </span>
            </span>
            <span>{phase.pendingSkip ? "Skipping…" : null}</span>
          </div>

          {phase.lastWrongGuess && (
            <div className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-4 py-2 text-sm text-rose-200">
              Not <span className="font-semibold">“{phase.lastWrongGuess}”</span> — here's another
              quote.
            </div>
          )}

          <QuoteBlock quote={phase.quote} />

          <form onSubmit={submit} className="space-y-3">
            <input
              type="text"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              autoFocus
              placeholder="Type the movie title — or leave blank to skip"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-lg outline-none placeholder:text-zinc-600 focus:border-amber-300"
            />
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={guess.trim() === ""}
                className="flex-1 rounded-lg bg-amber-300 px-4 py-2.5 font-semibold text-zinc-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                Guess
              </button>
              <button
                type="button"
                onClick={() => skip()}
                className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-zinc-200 transition hover:border-zinc-500"
              >
                Skip
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              A wrong guess just shows the next quote. The game ends when you run out of quotes.
            </p>
          </form>
        </section>
      )}

      {phase.kind === "roundWon" && (
        <section className="space-y-6">
          <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-6">
            <p className="text-sm uppercase tracking-wider text-emerald-300">
              Correct · +{phase.points} point{phase.points === 1 ? "" : "s"}
            </p>
            <h2 className="mt-1 text-2xl font-bold">
              {phase.title} <span className="font-normal text-zinc-400">({phase.year})</span>
            </h2>
            <a
              href={`https://www.imdb.com/title/${phase.imdbId}/`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-amber-300 underline-offset-2 hover:underline"
            >
              View on IMDb →
            </a>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm uppercase tracking-wider text-zinc-400">
              Quote{phase.quotes.length > 1 ? "s" : ""} you saw
            </h3>
            {phase.quotes.map((q, i) => (
              <QuoteBlock key={i} quote={q} />
            ))}
          </div>

          <button
            onClick={() => void startRound()}
            className="w-full rounded-lg bg-amber-300 px-6 py-3 font-semibold text-zinc-900 transition hover:bg-amber-200"
          >
            Next round →
          </button>
        </section>
      )}

      {phase.kind === "gameOver" && (
        <section className="space-y-6">
          <div className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-6">
            <p className="text-sm uppercase tracking-wider text-rose-300">Game over</p>
            <h2 className="mt-1 text-2xl font-bold">
              Final score: <span className="text-amber-300">{score}</span>
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {roundsWon} round{roundsWon === 1 ? "" : "s"} won · ran out of quotes for{" "}
              <span className="font-semibold text-zinc-200">{phase.title}</span>{" "}
              <span className="text-zinc-500">({phase.year})</span>
            </p>
            <a
              href={`https://www.imdb.com/title/${phase.imdbId}/`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-amber-300 underline-offset-2 hover:underline"
            >
              View on IMDb →
            </a>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm uppercase tracking-wider text-zinc-400">
              Quote{phase.quotes.length > 1 ? "s" : ""} from the final round
            </h3>
            {phase.quotes.map((q, i) => (
              <QuoteBlock key={i} quote={q} />
            ))}
          </div>

          <button
            onClick={() => setPhase({ kind: "setup" })}
            className="w-full rounded-lg bg-amber-300 px-6 py-3 font-semibold text-zinc-900 transition hover:bg-amber-200"
          >
            Play again
          </button>
        </section>
      )}

      {phase.kind === "error" && (
        <section className="space-y-4">
          <div className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-6">
            <p className="text-sm uppercase tracking-wider text-rose-300">Something went wrong</p>
            <p className="mt-2 text-zinc-200">{phase.message}</p>
          </div>
          <button
            onClick={() => setPhase({ kind: "setup" })}
            className="w-full rounded-lg border border-zinc-700 px-6 py-3 transition hover:border-zinc-500"
          >
            Back
          </button>
        </section>
      )}
    </main>
  );
}
