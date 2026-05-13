import type { HintKind, RoundState } from "./types";

export const HINT_COSTS: Record<HintKind, number> = {
  year: 1,
  genre: 1,
  title: 2,
};

export type HintsUsed = NonNullable<RoundState["hintsUsed"]>;

export function totalHintCost(used: HintsUsed | undefined): number {
  if (!used) return 0;
  return (
    (used.year ? HINT_COSTS.year : 0) +
    (used.genre ? HINT_COSTS.genre : 0) +
    (used.title ? HINT_COSTS.title : 0)
  );
}

export function anyHintUsed(used: HintsUsed | undefined): boolean {
  if (!used) return false;
  return Boolean(used.year || used.genre || used.title);
}

/**
 * Hangman-style reveal of a title: first alphanumeric character of each word
 * stays visible; remaining alphanumerics become underscores; whitespace and
 * punctuation are preserved as-is.
 *
 *   "The Matrix"                 → "T__ M_____"
 *   "Star Wars: Episode IV"      → "S___ W___: E______ I_"
 *   "2001: A Space Odyssey"      → "2___: A S____ O______"
 */
export function maskTitle(title: string): string {
  const out: string[] = [];
  let wordStarted = false;
  for (const ch of title) {
    if (/\s/.test(ch)) {
      out.push(ch);
      wordStarted = false;
      continue;
    }
    if (/[A-Za-z0-9]/.test(ch)) {
      if (!wordStarted) {
        out.push(ch);
        wordStarted = true;
      } else {
        out.push("_");
      }
      continue;
    }
    // Punctuation — preserve verbatim, doesn't start a new word
    out.push(ch);
  }
  return out.join("");
}
