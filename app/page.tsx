"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import pkg from "../package.json";
import { ALL_GENRES, type Decade, type Difficulty, type Filters, type Genre, type HintKind, type Kind, type Quote } from "@/lib/types";
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
const KINDS: { id: Kind; label: string }[] = [
  { id: "movie", label: "Movies" },
  { id: "series", label: "TV series" },
];

const DIFFICULTIES: { id: Difficulty; label: string; hint: string }[] = [
  { id: "easy", label: "G", hint: "Real character names · year shown" },
  { id: "normal", label: "PG-13", hint: "Anonymized characters · year shown" },
  { id: "hard", label: "R", hint: "Anonymized characters · no year" },
  { id: "nightmare", label: "NC-17", hint: "Anonymized · no year · no hints" },
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

function FilterRow({
  label,
  tail,
  children,
}: {
  label: string;
  tail: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="hud-rule mb-3 pb-2 font-body text-base uppercase tracking-[0.25em] text-cream">
        ▮ {label}
      </h2>
      <div className="flex flex-wrap gap-2">{children}</div>
      <p className="mt-2 font-body text-sm text-cream-smoke">{tail}</p>
    </div>
  );
}

function ChipBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        "chip border-2 px-3 py-1 font-body text-base uppercase tracking-wider transition " +
        (active
          ? "border-cream bg-neon-pink text-ink-deep"
          : "border-cream/40 bg-transparent text-cream hover:text-ink-deep")
      }
    >
      {children}
    </button>
  );
}

function QuoteBlock({ quote }: { quote: Quote }) {
  return (
    <div className="tape-border-pink shadow-vhs-pink relative bg-ink-veil/50 p-6 font-body text-cream">
      {/* in-card faint scanlines so the quote feels like it's playing on a CRT */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_3px,rgba(255,59,139,0.05)_3px,rgba(255,59,139,0.05)_4px)]"
      />
      <div className="relative space-y-3 text-[15px] leading-relaxed">
        {quote.lines.map((line, i) => (
          <p key={i}>
            {line.speaker && (
              <span className="mr-2 inline-block bg-neon-pink px-1.5 py-0.5 align-baseline font-body text-xs uppercase leading-none tracking-wider text-ink-deep">
                {line.speaker}
              </span>
            )}
            <span>{line.text}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [decades, setDecades] = useState<Decade[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [kinds, setKinds] = useState<Kind[]>([]);
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
    if (kinds.length) f.kinds = kinds;
    return f;
  }

  async function startRound(scoreTokenOverride?: string | null) {
    setPhase({ kind: "loading" });
    try {
      // Caller passes `null` explicitly when starting a fresh game — at that
      // point setScoreToken(null) has been queued but our closure still
      // captures the previous render's scoreToken. Without this override
      // we'd send the old token and the server would continue the previous
      // session, carrying its `outcomes` array into the "new" game's
      // game-over breakdown.
      const tokenToSend = scoreTokenOverride === undefined ? scoreToken : scoreTokenOverride;
      const res = await fetch("/api/round/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: currentFilters(), difficulty, scoreToken: tokenToSend }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase({ kind: "error", message: data.error ?? "Failed to start round" });
        return;
      }
      if (data.scoreToken) setScoreToken(data.scoreToken);
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
    void startRound(null);
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
    if (actionInFlight) return;
    setActionInFlight(true);
    let res: Response;
    try {
      res = await fetch("/api/round/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: phase.token, hint: kind }),
      });
    } finally {
      setActionInFlight(false);
    }
    const data = await res.json();
    // Use the functional setState form so a hint that resolves while another
    // request was in flight still merges into the *latest* phase rather than
    // a stale closure capture.
    setPhase((p) => {
      if (p.kind !== "playing") return p;
      if (!res.ok) return { kind: "error", message: data.error ?? "Hint failed" };
      return {
        ...p,
        token: data.token,
        year: data.year ?? p.year,
        genres: data.genres ?? p.genres,
        titleMask: data.titleMask ?? p.titleMask,
        hintsUsed: { ...p.hintsUsed, [kind]: true },
      };
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
    <main className="mx-auto max-w-4xl px-5 pb-16 pt-8 sm:px-6 sm:pt-12">
      <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
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
            <p className="font-body text-xs uppercase tracking-[0.3em] text-neon-pink">
              ◤ Now Playing ◢
            </p>
            <h1 className="crt-shift animate-crt font-display text-4xl leading-none text-cream sm:text-6xl">
              REEL<span className="text-neon-pink">/</span>QUOTES
            </h1>
            <p className="mt-2 font-body text-base text-cream-dim sm:text-lg">
              Guess the title. Skip with an empty box. Five quotes per round — then the tape ejects.
            </p>
          </div>
        </div>
        {phase.kind !== "setup" && (
          <div className="tape-border-pink shadow-vhs-pink self-start bg-ink-veil/70 px-4 py-2 text-right sm:shrink-0">
            <div className="font-body text-xs uppercase tracking-[0.2em] text-cream-dim">
              ▮ Score
            </div>
            <div className="font-display text-3xl leading-none tabular-nums text-neon-pink">
              {String(score).padStart(3, "0")}
            </div>
            <div className="font-body text-sm text-cream-dim">
              {roundsWon} round{roundsWon === 1 ? "" : "s"}
              {streak > 1 && <span className="ml-2 text-neon-orange">· 🔥 {streak}</span>}
            </div>
          </div>
        )}
      </header>

      {phase.kind === "setup" && (
        <section className="space-y-8">
          {daily && (
            <details className="group tape-border-pink shadow-vhs-pink bg-ink-veil/40 p-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2">
                <span className="font-body text-base uppercase tracking-[0.2em] text-neon-pink">
                  ▮ Quote of the Day
                </span>
                <span className="font-body text-base text-neon-pink/70 transition group-open:rotate-180">▾</span>
              </summary>
              <div className="mt-4 space-y-2 font-body text-sm leading-relaxed text-cream">
                {daily.quote.lines.map((line, i) => (
                  <p key={i}>
                    {line.speaker && (
                      <span className="mr-2 inline-block bg-neon-pink px-1.5 py-0.5 align-baseline font-body text-[11px] uppercase leading-none tracking-wider text-ink-deep">
                        {line.speaker}
                      </span>
                    )}
                    <span>{line.text}</span>
                  </p>
                ))}
              </div>
              <details className="mt-3 font-body text-base text-cream-dim">
                <summary className="cursor-pointer select-none text-cream-smoke hover:text-neon-orange">
                  ▶ Reveal answer
                </summary>
                <p className="mt-2 text-cream">
                  {daily.title}{" "}
                  <span className="text-cream-smoke">({daily.year})</span>
                </p>
              </details>
            </details>
          )}

          <details className="group tape-border bg-ink-veil/30 p-4 font-body text-sm text-cream-dim [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-2">
              <span className="font-body text-base uppercase tracking-[0.2em] text-cream">
                ▮ How to play &amp; scoring
              </span>
              <span className="font-body text-base text-cream/70 transition group-open:rotate-180">▾</span>
            </summary>

            <div className="mt-4 space-y-4">
              <div>
                <p className="font-body text-base uppercase tracking-wider text-neon-orange">
                  ▸ Gameplay
                </p>
                <p className="mt-1 text-cream">
                  Each round plays quotes from a random title. Type or pick from the dropdown.
                  Empty input (or Skip) jumps to the next quote — same goes for a wrong guess.
                  Burn through all five quotes and the tape ejects.
                </p>
              </div>

              <div>
                <p className="font-body text-base uppercase tracking-wider text-neon-orange">
                  ▸ Scoring
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-cream">
                  <li>5 pts if you guess on quote 1, 4 on quote 2, … 1 on quote 5.</li>
                  <li>
                    Streak bonus: consecutive quote-1 wins with no hints used add +1 per step
                    (capped at +5).
                  </li>
                  <li>
                    Hints: <span className="text-neon-orange">Reveal year</span> (1 pt, hard
                    only), <span className="text-neon-orange">Reveal genre</span> (1 pt),{" "}
                    <span className="text-neon-orange">Reveal first letters</span> (2 pts —
                    hangman outline). Costs come off this round's payout (floor 0). Any hint
                    breaks the streak.
                  </li>
                </ul>
              </div>

              <div>
                <p className="font-body text-base uppercase tracking-wider text-neon-orange">
                  ▸ Difficulty
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-cream">
                  <li>
                    <span className="text-neon-orange">Easy</span> — real character names,
                    release year shown.
                  </li>
                  <li>
                    <span className="text-neon-orange">Normal</span> — names anonymized, release
                    year shown.
                  </li>
                  <li>
                    <span className="text-neon-orange">Hard</span> — anonymized, no year (pay
                    1 pt to reveal).
                  </li>
                </ul>
              </div>

              <div>
                <p className="font-body text-base uppercase tracking-wider text-neon-orange">
                  ▸ Leaderboard
                </p>
                <p className="mt-1 text-cream">
                  Game-over with a positive score lets you put your name (1–{NAME_MAX_LEN}
                  {" "}alphanumeric chars) on the top-20 board. Filterable by difficulty.
                  One submission per session.
                </p>
              </div>
            </div>
          </details>

          <FilterRow label="Type" tail={
            kinds.length === 0
              ? "Movies & TV series"
              : kinds.map((k) => KINDS.find((x) => x.id === k)?.label).join(", ")
          }>
            {KINDS.map((k) => (
              <ChipBtn
                key={k.id}
                active={kinds.includes(k.id)}
                onClick={() => setKinds(toggle(kinds, k.id))}
              >
                {k.label}
              </ChipBtn>
            ))}
          </FilterRow>

          <FilterRow label="Era" tail={decades.length === 0 ? "Any era" : decades.join(", ")}>
            {DECADES.map((d) => (
              <ChipBtn
                key={d}
                active={decades.includes(d)}
                onClick={() => setDecades(toggle(decades, d))}
              >
                {d}
              </ChipBtn>
            ))}
          </FilterRow>

          <FilterRow label="Genre" tail={genres.length === 0 ? "Any genre" : genres.join(", ")}>
            {GENRES.map((g) => (
              <ChipBtn
                key={g}
                active={genres.includes(g)}
                onClick={() => setGenres(toggle(genres, g))}
              >
                {g}
              </ChipBtn>
            ))}
          </FilterRow>

          <FilterRow
            label="Difficulty"
            tail={DIFFICULTIES.find((d) => d.id === difficulty)?.hint ?? ""}
          >
            {DIFFICULTIES.map((d) => (
              <ChipBtn
                key={d.id}
                active={difficulty === d.id}
                onClick={() => setDifficulty(d.id)}
                title={d.hint}
              >
                {d.label}
              </ChipBtn>
            ))}
          </FilterRow>

          <div className="pt-2">
            <button
              onClick={startGame}
              className="press-btn shadow-vhs-pink group flex w-full items-center justify-center gap-3 bg-neon-pink px-6 py-4 font-display text-2xl uppercase tracking-wider text-cream tape-border-pink"
            >
              <span>▶ Press Play</span>
              <span className="eject text-cream">◢◤</span>
            </button>
            <Link
              href="/leaderboard"
              className="press-btn mt-3 block bg-ink-veil/40 px-6 py-3 text-center font-body text-lg uppercase tracking-[0.2em] text-cream tape-border hover:text-neon-orange"
            >
              ◇ View Leaderboard ◇
            </Link>
          </div>
        </section>
      )}

      {phase.kind === "loading" && (
        <p className="font-body text-2xl uppercase tracking-[0.3em] text-cream-dim">
          ░ Rewinding tape ░░░░░ ▓▓
        </p>
      )}

      {phase.kind === "playing" && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-body text-base uppercase tracking-wider">
            <span className="bg-neon-pink px-2 py-0.5 text-ink-deep">● REC</span>
            <span className="text-cream">
              Quote{" "}
              <span className="text-neon-orange">
                {String(phase.index + 1).padStart(2, "0")} / {String(phase.total).padStart(2, "0")}
              </span>
            </span>
            <span className="text-cream-dim">·</span>
            <span className="text-cream">
              worth{" "}
              <span className="text-neon-orange">
                {Math.max(0, (POINTS_PER_QUOTE[phase.index] ?? 0) - totalHintCost(phase.hintsUsed))} pts
              </span>
            </span>
            {phase.year !== undefined && (
              <span className="border border-cream/40 px-2 py-0.5 text-cream">
                © {phase.year}
              </span>
            )}
            {phase.genres && phase.genres.length > 0 && (
              <span className="border border-cream/40 px-2 py-0.5 text-cream">
                {phase.genres.join(" · ")}
              </span>
            )}
            {phase.pendingSkip && (
              <span className="ml-auto text-neon-orange animate-pulse">SKIP &gt;&gt;</span>
            )}
          </div>

          {(() => {
            if (difficulty === "nightmare") return null;
            const canShowYear = difficulty === "hard" && !phase.hintsUsed.year;
            const canShowGenre = !phase.hintsUsed.genre;
            const canShowTitle = !phase.hintsUsed.title;
            if (!canShowYear && !canShowGenre && !canShowTitle) return null;
            const hintCls =
              "chip border-2 border-cream/40 bg-transparent px-3 py-1 font-body text-base uppercase tracking-wider text-cream transition hover:text-ink-deep disabled:cursor-not-allowed disabled:opacity-50";
            return (
              <div className="flex flex-wrap gap-2">
                {canShowYear && (
                  <button type="button" onClick={() => void buyHint("year")} disabled={actionInFlight} className={hintCls}>
                    + Year ◦ 1pt
                  </button>
                )}
                {canShowGenre && (
                  <button type="button" onClick={() => void buyHint("genre")} disabled={actionInFlight} className={hintCls}>
                    + Genre ◦ 1pt
                  </button>
                )}
                {canShowTitle && (
                  <button type="button" onClick={() => void buyHint("title")} disabled={actionInFlight} className={hintCls}>
                    + First Letters ◦ 2pts
                  </button>
                )}
              </div>
            );
          })()}

          {phase.titleMask && (
            <div className="tape-border bg-ink-veil/40 px-4 py-3">
              <div className="font-body text-base uppercase tracking-[0.25em] text-neon-orange">
                ▮ Title outline
              </div>
              <div className="mt-1 font-body text-2xl tracking-[0.3em] text-cream">
                {phase.titleMask}
              </div>
            </div>
          )}

          {phase.lastWrongGuess && (
            <div className="border-2 border-neon-red bg-neon-red/10 px-4 py-2 font-body text-base tracking-wider text-cream">
              <span className="mr-2 bg-neon-red px-1.5 py-0.5 text-ink-deep">✗ WRONG</span>
              Not <span className="text-neon-red">“{phase.lastWrongGuess}”</span> — rolling tape…
            </div>
          )}

          <div key={phase.index} className="vhs-jitter">
            <QuoteBlock quote={phase.quote} />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
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
                placeholder="▶ Type the title — or blank to skip"
                enterKeyHint="go"
                aria-autocomplete="list"
                aria-expanded={open && matches.length > 0}
                className="w-full border-2 border-cream/40 bg-ink-veil/40 px-4 py-3 font-body text-base text-cream caret-neon-pink outline-none placeholder:text-cream-smoke focus:border-neon-pink sm:text-lg"
              />
              {open && matches.length > 0 && (
                <ul
                  role="listbox"
                  className="tape-border-pink mt-3 max-h-64 overflow-auto bg-ink-deep/95 shadow-vhs-pink"
                >
                  {matches.map((m, i) => (
                    <li
                      key={`${m.title}-${m.year}`}
                      role="option"
                      aria-selected={i === highlight}
                      onMouseEnter={() => setHighlight(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setOpen(false);
                        setHighlight(-1);
                        void sendGuess(m.title, true);
                      }}
                      className={
                        "flex cursor-pointer items-baseline justify-between gap-3 px-4 py-2 font-body text-sm " +
                        (i === highlight
                          ? "bg-neon-pink text-ink-deep"
                          : "text-cream hover:bg-ink-veil")
                      }
                    >
                      <span className="truncate">
                        <span className={i === highlight ? "text-ink-deep" : "text-neon-pink"}>▶</span>{" "}
                        {m.title}
                      </span>
                      <span
                        className={
                          "shrink-0 font-body text-base " +
                          (i === highlight ? "text-ink-deep" : "text-cream-smoke")
                        }
                      >
                        {m.year}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={guess.trim() === "" || actionInFlight}
                className="press-btn shadow-vhs-pink flex-1 bg-neon-pink px-4 py-3 font-display text-xl uppercase tracking-wider text-cream tape-border-pink disabled:cursor-not-allowed disabled:bg-ink-veil disabled:text-cream-smoke disabled:shadow-none"
              >
                ▶ Guess
              </button>
              <button
                type="button"
                onClick={() => skip()}
                disabled={actionInFlight}
                className="press-btn flex-1 bg-transparent px-4 py-3 font-display text-xl uppercase tracking-wider text-cream tape-border hover:text-neon-orange disabled:cursor-not-allowed disabled:opacity-50"
              >
                ▷▷ Skip
              </button>
            </div>
            <p className="font-body text-sm text-cream-smoke">
              A wrong guess = next quote. Run out and the tape ejects.
            </p>
          </form>
        </section>
      )}

      {phase.kind === "roundWon" && (
        <section className="space-y-6">
          <div className="tape-border bg-neon-teal/10 p-6" style={{ borderColor: "#3dd8ce" }}>
            <p className="font-body text-lg uppercase tracking-[0.3em] text-neon-teal">
              ◢ Correct ◣
            </p>
            <h2 className="mt-2 font-display text-3xl uppercase leading-tight text-cream sm:text-4xl">
              {phase.title}{" "}
              <span className="font-body text-2xl text-cream-dim">({phase.year})</span>
            </h2>
            <a
              href={`https://www.imdb.com/title/${phase.imdbId}/`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-body text-lg text-neon-orange hover:underline"
            >
              ▶ View on IMDb
            </a>

            {(phase.streakBonus > 0 || phase.hintCount > 0) ? (
              <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-body text-xl">
                <span className="text-cream">+{phase.basePoints} base</span>
                {phase.streakBonus > 0 && (
                  <span className="text-neon-orange">+{phase.streakBonus} streak</span>
                )}
                {phase.hintCount > 0 && (
                  <span className="text-neon-red">
                    −{phase.hintCost} hint{phase.hintCount === 1 ? "" : "s"}
                  </span>
                )}
                <span className="text-cream-smoke">=</span>
                <span className="font-display text-3xl text-neon-teal">
                  +{phase.points}
                </span>
                {phase.pointsFloored && (
                  <span className="text-sm text-cream-smoke">(floored at 0)</span>
                )}
              </div>
            ) : (
              <p className="mt-5 font-display text-4xl text-neon-teal">+{phase.points}</p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="hud-rule pb-1 font-body text-base uppercase tracking-[0.25em] text-cream">
              ▮ Quote{phase.quotes.length > 1 ? "s" : ""} you saw
            </h3>
            {phase.quotes.map((q, i) => (
              <QuoteBlock key={i} quote={q} />
            ))}
          </div>

          <button
            onClick={() => void startRound()}
            className="press-btn shadow-vhs-pink group flex w-full items-center justify-center gap-3 bg-neon-pink px-6 py-4 font-display text-2xl uppercase tracking-wider text-cream tape-border-pink"
          >
            <span>Next Round</span>
            <span className="eject text-cream">◢◤</span>
          </button>
        </section>
      )}

      {phase.kind === "gameOver" && (
        <section className="space-y-6">
          <div className="tape-border bg-neon-red/10 p-6" style={{ borderColor: "#ff5160" }}>
            <p className="font-body text-lg uppercase tracking-[0.3em] text-neon-red">
              ◢ Tape Ejected ◣
            </p>
            <h2 className="mt-2 font-display text-3xl uppercase text-cream sm:text-4xl">
              Final Score:{" "}
              <span className="text-neon-orange">{String(score).padStart(3, "0")}</span>
            </h2>
            <p className="mt-2 font-body text-lg text-cream-dim">
              {roundsWon} round{roundsWon === 1 ? "" : "s"} won · ran out of quotes for{" "}
              <span className="text-cream">{phase.title}</span>{" "}
              <span className="text-cream-smoke">({phase.year})</span>
            </p>
            <a
              href={`https://www.imdb.com/title/${phase.imdbId}/`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-body text-lg text-neon-orange hover:underline"
            >
              ▶ View on IMDb
            </a>
          </div>

          {phase.outcomes.length > 0 && (
            <div className="tape-border bg-ink-veil/40 p-5">
              <div className="font-body text-base uppercase tracking-[0.25em] text-cream-dim">
                ▮ Round breakdown
              </div>
              <div className="mt-3 font-mono text-3xl tracking-wide">
                {phase.outcomes.map((o, i) => (
                  <span key={i}>{emojiFor(o)}</span>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => void shareResults()}
                  className="press-btn bg-transparent px-4 py-2 font-body text-base uppercase tracking-wider text-cream tape-border hover:text-neon-orange"
                >
                  {canNativeShare ? "▶ Share results" : "▶ Copy results"}
                </button>
                {shareToast && (
                  <span className="font-body text-base text-neon-teal">{shareToast}</span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="hud-rule pb-1 font-body text-base uppercase tracking-[0.25em] text-cream">
              ▮ Quote{phase.quotes.length > 1 ? "s" : ""} from the final round
            </h3>
            {phase.quotes.map((q, i) => (
              <QuoteBlock key={i} quote={q} />
            ))}
          </div>

          {score > 0 && scoreToken && submitState.kind !== "submitted" && (
            <form
              onSubmit={submitToLeaderboard}
              className="tape-border-pink shadow-vhs-pink space-y-3 bg-ink-veil/40 p-5"
            >
              <div>
                <p className="font-body text-lg uppercase tracking-[0.2em] text-neon-pink">
                  ▶ Score {score} — make the board?
                </p>
                <p className="mt-1 font-body text-base text-cream-dim">
                  Up to {NAME_MAX_LEN} letters or digits. No spaces or specials.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={submitName}
                  onChange={(e) => setSubmitName(sanitizeName(e.target.value))}
                  maxLength={NAME_MAX_LEN}
                  size={NAME_MAX_LEN}
                  pattern="[A-Za-z0-9]+"
                  placeholder="Your name"
                  enterKeyHint="send"
                  disabled={submitState.kind === "submitting"}
                  className="min-w-0 flex-1 border-2 border-cream/40 bg-ink-deep px-3 py-2 font-body text-base text-cream caret-neon-pink outline-none placeholder:text-cream-smoke focus:border-neon-pink"
                />
                <button
                  type="submit"
                  disabled={!submitName.trim() || submitState.kind === "submitting"}
                  className="press-btn bg-neon-pink px-4 py-2 font-body text-lg uppercase tracking-wider text-ink-deep tape-border-pink disabled:cursor-not-allowed disabled:bg-ink-veil disabled:text-cream-smoke sm:shrink-0"
                >
                  {submitState.kind === "submitting" ? "Sending…" : "▶ Submit"}
                </button>
              </div>
              {submitState.kind === "error" && (
                <p className="font-body text-base text-neon-red">{submitState.message}</p>
              )}
            </form>
          )}

          {submitState.kind === "submitted" && (
            <div className="tape-border bg-neon-teal/10 p-5" style={{ borderColor: "#3dd8ce" }}>
              <p className="font-body text-lg uppercase tracking-wider text-neon-teal">
                {submitState.rank
                  ? `◢ Submitted — #${submitState.rank} on the board ◣`
                  : "Submitted — didn't crack the top 20"}
              </p>
              <Link
                href="/leaderboard"
                className="mt-2 inline-block font-body text-base text-neon-orange hover:underline"
              >
                ▶ View leaderboard
              </Link>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => setPhase({ kind: "setup" })}
              className="press-btn shadow-vhs-pink flex-1 bg-neon-pink px-6 py-4 font-display text-2xl uppercase tracking-wider text-cream tape-border-pink"
            >
              ◀◀ Rewind
            </button>
            <Link
              href="/leaderboard"
              className="press-btn flex-1 bg-transparent px-6 py-4 text-center font-display text-2xl uppercase tracking-wider text-cream tape-border hover:text-neon-orange"
            >
              ◇ Board ◇
            </Link>
          </div>
        </section>
      )}

      {phase.kind === "error" && (
        <section className="space-y-4">
          <div className="tape-border bg-neon-red/10 p-6" style={{ borderColor: "#ff5160" }}>
            <p className="font-body text-lg uppercase tracking-[0.3em] text-neon-red">
              ◢ Tracking Error ◣
            </p>
            <p className="mt-2 font-body text-base text-cream">{phase.message}</p>
          </div>
          <button
            onClick={() => setPhase({ kind: "setup" })}
            className="press-btn w-full bg-transparent px-6 py-3 font-display text-xl uppercase tracking-wider text-cream tape-border hover:text-neon-orange"
          >
            ◀◀ Back
          </button>
        </section>
      )}

      <footer className="mt-20 border-t-2 border-dashed border-cream/20 pt-6 text-center">
        <div className="flex flex-col items-center justify-center gap-1 font-body text-base uppercase tracking-[0.25em] text-cream-dim sm:flex-row sm:gap-3">
          <span>
            ◢ Created by{" "}
            <a
              href="https://github.com/mrgarris0n"
              target="_blank"
              rel="noreferrer"
              className="text-cream hover:text-neon-pink"
            >
              mrgarris0n
            </a>
            {" ◣"}
          </span>
          <span aria-hidden className="hidden text-cream-smoke sm:inline">·</span>
          <span>
            ◢{" "}
            <a
              href={`${GITHUB_REPO_URL}/issues/new`}
              target="_blank"
              rel="noreferrer"
              className="text-cream hover:text-neon-pink"
            >
              Report an issue
            </a>
            {" ◣"}
          </span>
        </div>
        <p className="mt-1 font-body text-sm text-cream-smoke">
          v{APP_VERSION}
          {COMMIT_SHA_SHORT && (
            <>
              {" · "}
              <a
                href={`${GITHUB_REPO_URL}/commit/${COMMIT_SHA}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-neon-pink"
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
