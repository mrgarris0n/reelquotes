"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import pkg from "../package.json";
import { ALL_GENRES, type Decade, type Difficulty, type Filters, type Genre, type HintKind, type Quote } from "@/lib/types";
import { totalHintCost, type HintsUsed } from "@/lib/hints";
import { POINTS_PER_QUOTE } from "@/lib/scoring";
import { NAME_MAX_LEN, sanitizeName } from "@/lib/name";

const APP_VERSION = pkg.version;
const COMMIT_SHA = process.env.COMMIT_SHA ?? "";
const COMMIT_SHA_SHORT = COMMIT_SHA ? COMMIT_SHA.slice(0, 7) : "";
const GITHUB_REPO_URL = "https://github.com/mrgarris0n/reelquotes";

interface TitleEntry {
  title: string;
  year: number;
}

const DECADES: Decade[] = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];
const GENRES: Genre[] = ALL_GENRES;

const DIFFICULTIES: { id: Difficulty; label: string; hint: string }[] = [
  { id: "easy", label: "Easy", hint: "Real character names · year shown" },
  { id: "normal", label: "Normal", hint: "Anonymized characters · year shown" },
  { id: "hard", label: "Hard", hint: "Anonymized characters · no year" },
];

type Phase =
  | { kind: "setup" }
  | { kind: "loading" }
  | {
      kind: "playing";
      token: string;
      quote: Quote;
      index: number;
      total: number;
      year?: number;
      genres?: string[];
      titleMask?: string;
      hintsUsed: HintsUsed;
      pendingSkip?: boolean;
      lastWrongGuess?: string;
    }
  | {
      kind: "roundWon";
      points: number;
      basePoints: number;
      streakBonus: number;
      hintCost: number;
      hintCount: number;
      pointsFloored: boolean;
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
      outcomes: number[];
    }
  | { kind: "error"; message: string };

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

const OUTCOME_EMOJI = ["🟩", "🟨", "🟨", "🟧", "🟥"]; // by quote index 0..4
function emojiFor(outcome: number): string {
  if (outcome < 0) return "⬛";
  return OUTCOME_EMOJI[outcome] ?? "⬛";
}

function buildShareText(outcomes: number[], score: number, roundsWon: number): string {
  const grid = outcomes.map(emojiFor).join("");
  const url = typeof window !== "undefined" ? window.location.origin : "https://reelquotes.vercel.app";
  return `🎬 ReelQuotes · ${score} pts · ${roundsWon} round${roundsWon === 1 ? "" : "s"}\n${grid}\n${url}`;
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
  const [genres, setGenres] = useState<Genre[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [guess, setGuess] = useState("");
  const [score, setScore] = useState(0);
  const [roundsWon, setRoundsWon] = useState(0);
  const [scoreToken, setScoreToken] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [titles, setTitles] = useState<TitleEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [submitName, setSubmitName] = useState("");
  const [submitState, setSubmitState] = useState<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "submitted"; rank: number | null }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [daily, setDaily] = useState<{ title: string; year: number; quote: Quote } | null>(null);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

  useEffect(() => {
    fetch("/api/titles")
      .then((r) => r.json())
      .then((d: { titles: TitleEntry[] }) => setTitles(d.titles))
      .catch(() => {
        // Combobox falls back to plain text input if titles fail to load.
      });
    fetch("/api/daily")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.quote) setDaily({ title: d.title, year: d.year, quote: d.quote });
      })
      .catch(() => {
        // Daily quote is optional flavor; ignore failures.
      });
  }, []);

  const matches = useMemo<TitleEntry[]>(() => {
    const q = guess.trim().toLowerCase();
    if (!q) return [];
    const prefix: TitleEntry[] = [];
    const contains: TitleEntry[] = [];
    for (const t of titles) {
      const tl = t.title.toLowerCase();
      if (tl.startsWith(q)) prefix.push(t);
      else if (tl.includes(q)) contains.push(t);
    }
    return [...prefix, ...contains].slice(0, 8);
  }, [titles, guess]);

  function clearGuess(): void {
    setGuess("");
    setOpen(false);
    setHighlight(-1);
  }

  function currentFilters(): Filters {
    const f: Filters = {};
    if (decades.length) f.decades = decades;
    if (genres.length) f.genres = genres;
    return f;
  }

  async function startRound() {
    setPhase({ kind: "loading" });
    try {
      const res = await fetch("/api/round/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: currentFilters(), difficulty, scoreToken }),
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
        year: data.year,
        hintsUsed: {},
      });
      clearGuess();
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    }
  }

  function startGame() {
    setScore(0);
    setRoundsWon(0);
    setStreak(0);
    setScoreToken(null);
    setSubmitName("");
    setSubmitState({ kind: "idle" });
    void startRound();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase.kind !== "playing") return;
    const highlighted = highlight >= 0 ? matches[highlight] : undefined;
    const picked = highlighted ? highlighted.title : guess.trim();
    if (picked === "") {
      await skip();
    } else {
      await sendGuess(picked, Boolean(highlighted));
    }
  }

  async function sendGuess(g: string, exact = false) {
    if (phase.kind !== "playing") return;
    if (actionInFlight) return;
    setActionInFlight(true);
    let res: Response;
    try {
      res = await fetch("/api/round/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: phase.token, scoreToken, guess: g, exact }),
      });
    } finally {
      setActionInFlight(false);
    }
    const data = await res.json();
    if (!res.ok) {
      setPhase({ kind: "error", message: data.error ?? "Guess failed" });
      return;
    }
    if (data.correct) {
      // Server is the source of truth for cumulative score (score token is signed).
      setScore(data.score);
      setRoundsWon(data.roundsWon);
      setStreak(data.streak ?? 0);
      if (data.scoreToken) setScoreToken(data.scoreToken);
      setPhase({
        kind: "roundWon",
        points: data.points ?? 0,
        basePoints: data.basePoints ?? data.points ?? 0,
        streakBonus: data.streakBonus ?? 0,
        hintCost: data.hintCost ?? 0,
        hintCount: data.hintCount ?? 0,
        pointsFloored: data.pointsFloored ?? false,
        title: data.title,
        year: data.year,
        imdbId: data.imdbId,
        quotes: data.quotesShown ?? [phase.quote],
      });
      return;
    }
    if (data.failed) {
      if (data.scoreToken) setScoreToken(data.scoreToken);
      setStreak(0);
      setPhase({
        kind: "gameOver",
        title: data.title,
        year: data.year,
        imdbId: data.imdbId,
        quotes: data.quotesShown ?? [phase.quote],
        outcomes: data.outcomes ?? [],
      });
      return;
    }
    // Wrong guess but more quotes remain — advance like a skip.
    // Preserve hint-revealed data (title mask, genres, purchased year) across
    // quote advances so the player keeps what they paid for.
    setPhase({
      kind: "playing",
      token: data.token,
      quote: data.quote,
      index: data.index,
      total: data.total,
      year: data.year ?? phase.year,
      genres: phase.genres,
      titleMask: phase.titleMask,
      hintsUsed: phase.hintsUsed,
      lastWrongGuess: g,
    });
    clearGuess();
  }

  async function skip() {
    if (phase.kind !== "playing") return;
    if (actionInFlight) return;
    setActionInFlight(true);
    const tokenAtSkip = phase.token;
    const hintsAtSkip = phase.hintsUsed;
    setPhase({ ...phase, pendingSkip: true });
    let res: Response;
    try {
      res = await fetch("/api/round/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenAtSkip, scoreToken }),
      });
    } finally {
      setActionInFlight(false);
    }
    const data = await res.json();
    if (!res.ok) {
      setPhase({ kind: "error", message: data.error ?? "Skip failed" });
      return;
    }
    if (data.failed) {
      if (data.scoreToken) setScoreToken(data.scoreToken);
      setStreak(0);
      setPhase({
        kind: "gameOver",
        title: data.title,
        year: data.year,
        imdbId: data.imdbId,
        quotes: data.quotesShown,
        outcomes: data.outcomes ?? [],
      });
    } else {
      setPhase({
        kind: "playing",
        token: data.token,
        quote: data.quote,
        index: data.index,
        total: data.total,
        year: data.year ?? phase.year,
        genres: phase.genres,
        titleMask: phase.titleMask,
        hintsUsed: hintsAtSkip,
      });
      clearGuess();
    }
  }

  async function buyHint(kind: HintKind) {
    if (phase.kind !== "playing") return;
    if (phase.hintsUsed[kind]) return;
    const res = await fetch("/api/round/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: phase.token, hint: kind }),
    });
    const data = await res.json();
    if (!res.ok) {
      setPhase({ kind: "error", message: data.error ?? "Hint failed" });
      return;
    }
    setPhase({
      ...phase,
      token: data.token,
      year: data.year ?? phase.year,
      genres: data.genres ?? phase.genres,
      titleMask: data.titleMask ?? phase.titleMask,
      hintsUsed: { ...phase.hintsUsed, [kind]: true },
    });
  }

  async function shareResults() {
    if (phase.kind !== "gameOver") return;
    const text = buildShareText(phase.outcomes, score, roundsWon);
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (!nav) return;
    try {
      const maybeShare = (nav as Navigator & {
        share?: (d: { text: string }) => Promise<void>;
      }).share;
      if (typeof maybeShare === "function") {
        await maybeShare.call(nav, { text });
        // OS handles its own UI; no toast needed.
      } else {
        await nav.clipboard.writeText(text);
        setShareToast("Copied!");
        window.setTimeout(() => setShareToast(null), 1800);
      }
    } catch {
      // user dismissed share sheet, or clipboard write was blocked — silent.
    }
  }

  async function submitToLeaderboard(e: React.FormEvent) {
    e.preventDefault();
    if (submitState.kind === "submitting" || submitState.kind === "submitted") return;
    if (!scoreToken) return;
    const cleaned = sanitizeName(submitName);
    if (!cleaned) {
      setSubmitState({
        kind: "error",
        message: `Use 1–${NAME_MAX_LEN} letters or digits.`,
      });
      return;
    }
    setSubmitState({ kind: "submitting" });
    try {
      const res = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleaned, scoreToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitState({ kind: "error", message: data.error ?? "Submission failed" });
        return;
      }
      setSubmitState({ kind: "submitted", rank: data.rank ?? null });
    } catch (err) {
      setSubmitState({ kind: "error", message: (err as Error).message });
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Image
            src="/logo-dark.png"
            alt=""
            width={352}
            height={311}
            priority
            className="h-14 w-auto shrink-0 sm:h-20"
          />
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">ReelQuotes</h1>
            <p className="mt-1 text-sm text-zinc-400 sm:mt-2 sm:text-base">
              Guess the movie from its quotes. Skip with an empty guess. Five quotes max per round.
            </p>
          </div>
        </div>
        {phase.kind !== "setup" && (
          <div className="self-start rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-right sm:shrink-0">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Score</div>
            <div className="text-2xl font-bold tabular-nums text-amber-300">{score}</div>
            <div className="text-xs text-zinc-500">
              {roundsWon} round{roundsWon === 1 ? "" : "s"}
              {streak > 1 && <span className="ml-1 text-amber-200">· 🔥 {streak}</span>}
            </div>
          </div>
        )}
      </header>

      {phase.kind === "setup" && (
        <section className="space-y-8">
          {daily && (
            <div className="rounded-xl border border-amber-300/30 bg-amber-300/5 p-5">
              <p className="text-xs uppercase tracking-wider text-amber-300">Quote of the Day</p>
              <div className="mt-3 font-mono text-sm leading-relaxed text-zinc-100">
                {daily.quote.lines.map((line, i) => (
                  <p key={i} className="mb-1 last:mb-0">
                    {line.speaker ? (
                      <>
                        <span className="text-amber-200">{line.speaker}:</span>{" "}
                        <span>{line.text}</span>
                      </>
                    ) : (
                      <span>{line.text}</span>
                    )}
                  </p>
                ))}
              </div>
              <details className="mt-3 text-xs text-zinc-400">
                <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-300">
                  Reveal answer
                </summary>
                <p className="mt-2 text-zinc-200">
                  {daily.title}{" "}
                  <span className="text-zinc-500">({daily.year})</span>
                </p>
              </details>
            </div>
          )}

          <details className="group rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-2 text-zinc-200">
              <span className="font-semibold">How to play &amp; scoring</span>
              <span className="text-xs text-zinc-500 transition group-open:rotate-180">▾</span>
            </summary>

            <div className="mt-4 space-y-4 text-zinc-400">
              <div>
                <p className="font-semibold text-zinc-200">Gameplay</p>
                <p className="mt-1">
                  Each round shows quotes from a random movie. Type or pick the title from the
                  dropdown. Submit an empty guess (or press Skip) to see another quote from the
                  same movie. A wrong guess counts as a skip — you just see the next quote.
                  When all five quotes are exhausted the game ends.
                </p>
              </div>

              <div>
                <p className="font-semibold text-zinc-200">Scoring</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>5 pts if you guess on quote 1, 4 on quote 2, … 1 on quote 5.</li>
                  <li>
                    Streak bonus: guess on quote 1 with no hints used in consecutive rounds and
                    each next perfect round earns +1 extra point (capped at +5).
                  </li>
                  <li>
                    Hints: <span className="text-zinc-200">Reveal year</span> (1 pt, hard only),{" "}
                    <span className="text-zinc-200">Reveal genre</span> (1 pt), and{" "}
                    <span className="text-zinc-200">Reveal first letters</span> (2 pts —
                    hangman-style outline of the title). Costs are deducted from this round's
                    payout (floored at 0) and using any hint disqualifies the round from the
                    streak bonus.
                  </li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-zinc-200">Difficulty</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>
                    <span className="text-zinc-200">Easy</span> — real character names, release
                    year shown.
                  </li>
                  <li>
                    <span className="text-zinc-200">Normal</span> — character names anonymized,
                    release year shown.
                  </li>
                  <li>
                    <span className="text-zinc-200">Hard</span> — anonymized, no year (you can
                    still pay 1 pt to reveal it as a hint).
                  </li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-zinc-200">Leaderboard</p>
                <p className="mt-1">
                  At game over, if your score is positive you can put your name (1–10
                  alphanumeric characters) on the top-20 leaderboard. Filterable by difficulty.
                  Each session can only be submitted once.
                </p>
              </div>
            </div>
          </details>

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
            <h2 className="mb-3 text-sm uppercase tracking-wider text-zinc-400">Genre</h2>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => (
                <button
                  key={g}
                  onClick={() => setGenres(toggle(genres, g))}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    genres.includes(g)
                      ? "border-amber-300 bg-amber-300/10 text-amber-200"
                      : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              {genres.length === 0 ? "Any genre" : genres.join(", ")}
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-sm uppercase tracking-wider text-zinc-400">Difficulty</h2>
            <div className="flex flex-wrap gap-2">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDifficulty(d.id)}
                  title={d.hint}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    difficulty === d.id
                      ? "border-amber-300 bg-amber-300/10 text-amber-200"
                      : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              {DIFFICULTIES.find((d) => d.id === difficulty)?.hint}
            </p>
          </div>

          <button
            onClick={startGame}
            className="w-full rounded-lg bg-amber-300 px-6 py-3 font-semibold text-zinc-900 transition hover:bg-amber-200"
          >
            Start game
          </button>

          <Link
            href="/leaderboard"
            className="block w-full rounded-lg border border-zinc-700 px-6 py-3 text-center text-sm text-zinc-200 transition hover:border-zinc-500"
          >
            View leaderboard →
          </Link>
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
                · worth {Math.max(0, (POINTS_PER_QUOTE[phase.index] ?? 0) - totalHintCost(phase.hintsUsed))} pt
                {Math.max(0, (POINTS_PER_QUOTE[phase.index] ?? 0) - totalHintCost(phase.hintsUsed)) === 1
                  ? ""
                  : "s"}
              </span>
              {phase.year !== undefined && (
                <span className="ml-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-xs text-amber-200">
                  Released in {phase.year}
                </span>
              )}
              {phase.genres && phase.genres.length > 0 && (
                <span className="ml-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-xs text-amber-200">
                  {phase.genres.join(" · ")}
                </span>
              )}
            </span>
            <span>{phase.pendingSkip ? "Skipping…" : null}</span>
          </div>

          {(() => {
            const canShowYear = difficulty === "hard" && !phase.hintsUsed.year;
            const canShowGenre = !phase.hintsUsed.genre;
            const canShowTitle = !phase.hintsUsed.title;
            if (!canShowYear && !canShowGenre && !canShowTitle) return null;
            return (
              <div className="flex flex-wrap gap-2 text-xs">
                {canShowYear && (
                  <button
                    type="button"
                    onClick={() => void buyHint("year")}
                    className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 transition hover:border-amber-300 hover:text-amber-200"
                  >
                    Reveal year — 1 pt
                  </button>
                )}
                {canShowGenre && (
                  <button
                    type="button"
                    onClick={() => void buyHint("genre")}
                    className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 transition hover:border-amber-300 hover:text-amber-200"
                  >
                    Reveal genre — 1 pt
                  </button>
                )}
                {canShowTitle && (
                  <button
                    type="button"
                    onClick={() => void buyHint("title")}
                    className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 transition hover:border-amber-300 hover:text-amber-200"
                  >
                    Reveal first letters — 2 pts
                  </button>
                )}
              </div>
            );
          })()}

          {phase.titleMask && (
            <div className="rounded-lg border border-amber-300/30 bg-amber-300/5 px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-amber-300/80">
                Title outline
              </div>
              <div className="mt-1 font-mono text-xl tracking-widest text-amber-100">
                {phase.titleMask}
              </div>
            </div>
          )}

          {phase.lastWrongGuess && (
            <div className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-4 py-2 text-sm text-rose-200">
              Not <span className="font-semibold">“{phase.lastWrongGuess}”</span> — here's another
              quote.
            </div>
          )}

          <QuoteBlock quote={phase.quote} />

          <form onSubmit={submit} className="space-y-3">
            <div className="relative">
              <input
                type="text"
                value={guess}
                onChange={(e) => {
                  setGuess(e.target.value);
                  setOpen(true);
                  setHighlight(-1);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => {
                  // small delay so a mousedown on a dropdown item still registers
                  window.setTimeout(() => setOpen(false), 120);
                }}
                onKeyDown={(e) => {
                  if (!open || matches.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => Math.min(h + 1, matches.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => Math.max(h - 1, -1));
                  } else if (e.key === "Escape") {
                    setOpen(false);
                    setHighlight(-1);
                  }
                }}
                autoFocus
                autoComplete="off"
                placeholder="Movie title — or blank to skip"
                aria-autocomplete="list"
                aria-expanded={open && matches.length > 0}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-base outline-none placeholder:text-zinc-600 focus:border-amber-300 sm:text-lg"
              />
              {open && matches.length > 0 && (
                <ul
                  role="listbox"
                  className="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
                >
                  {matches.map((m, i) => (
                    <li
                      key={`${m.title}-${m.year}`}
                      role="option"
                      aria-selected={i === highlight}
                      onMouseEnter={() => setHighlight(i)}
                      onMouseDown={(e) => {
                        // prevent input blur from closing the dropdown before submit fires
                        e.preventDefault();
                        setOpen(false);
                        setHighlight(-1);
                        void sendGuess(m.title, true);
                      }}
                      className={`flex cursor-pointer items-baseline justify-between gap-3 px-4 py-2 text-sm ${
                        i === highlight
                          ? "bg-amber-300/15 text-amber-100"
                          : "text-zinc-200 hover:bg-zinc-800"
                      }`}
                    >
                      <span className="truncate">{m.title}</span>
                      <span className="shrink-0 text-xs text-zinc-500">{m.year}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={guess.trim() === "" || actionInFlight}
                className="flex-1 rounded-lg bg-amber-300 px-4 py-2.5 font-semibold text-zinc-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                Guess
              </button>
              <button
                type="button"
                onClick={() => skip()}
                disabled={actionInFlight}
                className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
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
            <p className="text-sm uppercase tracking-wider text-emerald-300">Correct</p>
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

            {(phase.streakBonus > 0 || phase.hintCount > 0) ? (
              <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm">
                <span className="text-zinc-300">
                  +{phase.basePoints} base
                </span>
                {phase.streakBonus > 0 && (
                  <span className="text-amber-200">+{phase.streakBonus} streak</span>
                )}
                {phase.hintCount > 0 && (
                  <span className="text-rose-300">
                    −{phase.hintCost} hint{phase.hintCount === 1 ? "" : "s"}
                  </span>
                )}
                <span className="text-zinc-500">=</span>
                <span className="text-lg font-bold text-emerald-200">
                  +{phase.points} pt{phase.points === 1 ? "" : "s"}
                </span>
                {phase.pointsFloored && (
                  <span className="text-xs text-zinc-500">(floored at 0)</span>
                )}
              </div>
            ) : (
              <p className="mt-4 font-mono text-lg font-bold text-emerald-200">
                +{phase.points} point{phase.points === 1 ? "" : "s"}
              </p>
            )}
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

          {phase.outcomes.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <div className="text-xs uppercase tracking-wider text-zinc-500">Round breakdown</div>
              <div className="mt-2 font-mono text-2xl tracking-wide">
                {phase.outcomes.map((o, i) => (
                  <span key={i}>{emojiFor(o)}</span>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => void shareResults()}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:border-amber-300 hover:text-amber-200"
                >
                  {canNativeShare ? "Share results" : "Copy results"}
                </button>
                {shareToast && (
                  <span className="text-xs text-emerald-300">{shareToast}</span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-sm uppercase tracking-wider text-zinc-400">
              Quote{phase.quotes.length > 1 ? "s" : ""} from the final round
            </h3>
            {phase.quotes.map((q, i) => (
              <QuoteBlock key={i} quote={q} />
            ))}
          </div>

          {score > 0 && scoreToken && submitState.kind !== "submitted" && (
            <form
              onSubmit={submitToLeaderboard}
              className="space-y-3 rounded-xl border border-amber-300/40 bg-amber-300/5 p-5"
            >
              <div>
                <p className="text-sm font-semibold text-amber-200">
                  Score {score} — make the leaderboard?
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Up to {NAME_MAX_LEN} letters or digits. No spaces or special characters.
                </p>
              </div>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={submitName}
                  onChange={(e) => setSubmitName(sanitizeName(e.target.value))}
                  maxLength={NAME_MAX_LEN}
                  pattern="[A-Za-z0-9]+"
                  placeholder="Your name"
                  disabled={submitState.kind === "submitting"}
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-base outline-none placeholder:text-zinc-600 focus:border-amber-300"
                />
                <button
                  type="submit"
                  disabled={!submitName.trim() || submitState.kind === "submitting"}
                  className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                >
                  {submitState.kind === "submitting" ? "Submitting…" : "Submit"}
                </button>
              </div>
              {submitState.kind === "error" && (
                <p className="text-xs text-rose-300">{submitState.message}</p>
              )}
            </form>
          )}

          {submitState.kind === "submitted" && (
            <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-5 text-sm">
              <p className="font-semibold text-emerald-200">
                {submitState.rank
                  ? `Submitted — you're #${submitState.rank} on the leaderboard.`
                  : "Submitted — but didn't crack the top 20 this time."}
              </p>
              <Link
                href="/leaderboard"
                className="mt-2 inline-block text-amber-300 underline-offset-2 hover:underline"
              >
                View leaderboard →
              </Link>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setPhase({ kind: "setup" })}
              className="flex-1 rounded-lg bg-amber-300 px-6 py-3 font-semibold text-zinc-900 transition hover:bg-amber-200"
            >
              Play again
            </button>
            <Link
              href="/leaderboard"
              className="flex-1 rounded-lg border border-zinc-700 px-6 py-3 text-center text-zinc-200 transition hover:border-zinc-500"
            >
              Leaderboard
            </Link>
          </div>
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

      <footer className="mt-16 border-t border-zinc-800 pt-6 text-center text-xs text-zinc-500">
        <p>
          Created by{" "}
          <a
            href="https://github.com/mrgarris0n"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-300 underline-offset-2 hover:text-amber-300 hover:underline"
          >
            mrgarris0n
          </a>
          {" · "}
          <a
            href={`${GITHUB_REPO_URL}/issues/new`}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-300 underline-offset-2 hover:text-amber-300 hover:underline"
          >
            Report an issue
          </a>
        </p>
        <p className="mt-1 font-mono text-[10px] text-zinc-600">
          v{APP_VERSION}
          {COMMIT_SHA_SHORT && (
            <>
              {" · "}
              <a
                href={`${GITHUB_REPO_URL}/commit/${COMMIT_SHA}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-amber-300"
              >
                {COMMIT_SHA_SHORT}
              </a>
            </>
          )}
        </p>
      </footer>
    </main>
  );
}
