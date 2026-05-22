import type { Quote, QuoteLine } from "./types";

const MIN_QUOTE_CHARS = 15;

// Section headings that never contain usable quotes.
const SKIP_SECTION =
  /^(cast|external links?|see also|references?|notes?|about|taglines?|songs?|soundtrack|crew|gallery|quotes about|further reading|bibliography|filmography)\b/i;

export function isRedirect(wikitext: string): boolean {
  return /^\s*#redirect\s*\[\[/i.test(wikitext);
}

// --- markup stripping -------------------------------------------------------

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&lt;": "<",
  "&gt;": ">",
};

function stripTemplates(s: string): string {
  // Repeatedly remove innermost {{...}} so nested templates collapse.
  let prev: string;
  do {
    prev = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, "");
  } while (s !== prev);
  return s;
}

export function stripMarkup(input: string): string {
  let s = input;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref[^>]*\/>/gi, "");
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  s = stripTemplates(s);
  s = s.replace(/\[\[(?:File|Image):[\s\S]*?\]\]/gi, "");
  s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1"); // [[target|label]] -> label
  s = s.replace(/\[\[([^\]]*)\]\]/g, "$1"); // [[target]] -> target
  s = s.replace(/\[(?:https?:|ftp:)\/\/\S+\s+([^\]]+)\]/g, "$1"); // [url label] -> label
  s = s.replace(/\[(?:https?:|ftp:)\/\/\S+\]/g, ""); // bare [url] -> ""
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/'''''|'''|''/g, ""); // bold/italic markers
  s = s.replace(/<\/?[a-z][^>]*>/gi, ""); // remaining HTML tags
  for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return repairOrphanBrackets(s);
}

/**
 * Strip stage-direction brackets and clean up orphans.
 *
 * Handles four cases:
 *   1. Balanced `[picking up the phone]` (iterated so nested brackets fully
 *      collapse).
 *   2. Mixed `[stage direction)` / `[stage direction}` — Wikiquote editor
 *      typos where the closer is wrong; treated as if it were `]`.
 *   3. Orphan opening `[` with no closer — when followed by whitespace, drop
 *      just the bracket (bare `[ ` artifact); otherwise drop from `[` to the
 *      end of the string (stage-direction prose with no closing `]` more
 *      likely than dialogue beginning with `[`).
 *   4. Orphan closing `]` — strip the character.
 *
 * Idempotent.
 */
export function repairOrphanBrackets(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/\[[^[\]]*\]/g, " ");
  } while (s !== prev);
  s = s.replace(/\[[^\[\]]*[)}]/g, " ");
  while (true) {
    const idx = s.indexOf("[");
    if (idx === -1) break;
    if (idx + 1 < s.length && /\s/.test(s[idx + 1]!)) {
      s = s.slice(0, idx) + " " + s.slice(idx + 1);
    } else {
      s = s.slice(0, idx);
    }
  }
  s = s.replace(/\]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

// Long monologues are hard to read/scroll on mobile. Cap each spoken line at
// MAX_LINE_CHARS, preferring a sentence-end cut (no ellipsis when the trim
// happens at a `.` / `!` / `?`) and falling back to a word-boundary cut with
// "…". Short lines pass through untouched.
const MAX_LINE_CHARS = 280;
const MIN_TRIM_CHARS = 80;

export function trimLongLines(text: string): string {
  if (text.length <= MAX_LINE_CHARS) return text;
  const window = text.slice(0, MAX_LINE_CHARS);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
    window.lastIndexOf("…"),
  );
  if (sentenceEnd >= MIN_TRIM_CHARS) {
    return text.slice(0, sentenceEnd + 1).trim();
  }
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > MIN_TRIM_CHARS ? lastSpace : MAX_LINE_CHARS;
  return text.slice(0, cut).trimEnd() + "…";
}

// Wikiquote sometimes packs an entire scene's dialogue into one `----`-less
// block. Even with per-line trimming, 30+ speaker turns is a wall of text on
// mobile. Split dialogue quotes into ≤MAX_LINES_PER_QUOTE-line chunks; merge a
// trailing single-line tail into the previous chunk so we don't ship orphans.
const MAX_LINES_PER_QUOTE = 6;

export function chunkDialogue(lines: QuoteLine[]): QuoteLine[][] {
  if (lines.length <= MAX_LINES_PER_QUOTE) return [lines];
  const chunks: QuoteLine[][] = [];
  for (let i = 0; i < lines.length; i += MAX_LINES_PER_QUOTE) {
    chunks.push(lines.slice(i, i + MAX_LINES_PER_QUOTE));
  }
  if (chunks.length >= 2 && chunks[chunks.length - 1]!.length === 1) {
    chunks[chunks.length - 2]!.push(...chunks[chunks.length - 1]!);
    chunks.pop();
  }
  return chunks;
}

function isStageDirectionOnly(text: string): boolean {
  const t = text.trim();
  return t.startsWith("[") && t.endsWith("]");
}

function usable(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_QUOTE_CHARS) return false;
  if (isStageDirectionOnly(t)) return false;
  return true;
}

// Pull `'''Speaker:'''`-style segments out of a single line. Returns either a
// single solo line (no speaker markup) or multiple speaker lines (an inline
// exchange, e.g. `'''A:''' hi '''B:''' bye`).
const SPEAKER_RE = /'''\s*([^'\n]+?)\s*'''\s*:?\s*/g;

function splitInlineSpeakers(raw: string): { speaker: string; text: string }[] | null {
  SPEAKER_RE.lastIndex = 0;
  const matches = [...raw.matchAll(SPEAKER_RE)];
  if (matches.length === 0) return null;
  const out: { speaker: string; text: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : raw.length;
    const speaker = stripMarkup(m[1]!).replace(/:$/, "").trim();
    const text = stripMarkup(raw.slice(start, end));
    if (speaker && text) out.push({ speaker, text });
  }
  return out.length ? out : null;
}

// --- section model ----------------------------------------------------------

interface Section {
  heading: string;
  kind: "skip" | "dialogue" | "character";
  body: string[];
}

function classify(heading: string): Section["kind"] {
  const h = heading.trim();
  if (SKIP_SECTION.test(h)) return "skip";
  if (/^dialogues?\b/i.test(h)) return "dialogue";
  return "character";
}

function splitSections(wikitext: string): Section[] {
  const lines = wikitext.split(/\r?\n/);
  const sections: Section[] = [];
  // Implicit lead section so a page that opens straight into quotes
  // (no level-2 heading — common on series season subpages) still gets scanned.
  let current: Section = { heading: "", kind: "character", body: [] };
  for (const line of lines) {
    const h2 = line.match(/^==\s*([^=].*?)\s*==\s*$/);
    if (h2) {
      sections.push(current);
      const heading = h2[1]!.trim();
      current = { heading, kind: classify(heading), body: [] };
      continue;
    }
    // Level-3+ headings (e.g. per-episode `=== ''Pilot'' [1.01] ===` on
    // season subpages) don't change the section but DO separate quotes —
    // turn them into a block boundary the section parser understands.
    if (/^===+\s*[^=].*?\s*===+\s*$/.test(line)) {
      current.body.push("----");
      continue;
    }
    current.body.push(line);
  }
  sections.push(current);
  return sections;
}

// --- unified section parser -------------------------------------------------

// A real speaker line always has a colon delimiting speaker from utterance —
// either after the closing `'''` (`:'''Walter''': text`, `'''Brody''': text`)
// or inside it (`'''Neo:''' text`). Intro prose like `'''The Matrix''' is a
// 1999 film.` has no such colon and must NOT match.
const DL_COLON_AFTER_RE = /^\s*[:*]*\s*'''\s*([^'\n]+?)\s*'''\s*:\s*(.*)$/;
const DL_COLON_IN_RE = /^\s*[:*]*\s*'''\s*([^'\n]+?)\s*:\s*'''\s*(.*)$/;
const DL_SEMICOLON_RE = /^\s*;\s*([^:]+?)\s*:\s*(.*)$/;
const SEPARATOR_RE = /^\s*(?:----+|<hr\b[^>]*>)\s*$/i;
// Series subpages open with a season-navigation header that looks like a
// speaker line: `:'''Season''' [[Show (season 1)|1]] … | [[Show|Main]]`.
const NAV_SPEAKER_RE = /^seasons?$/i;

function matchSpeaker(line: string): RegExpMatchArray | null {
  return (
    line.match(DL_COLON_AFTER_RE) ??
    line.match(DL_COLON_IN_RE) ??
    line.match(DL_SEMICOLON_RE)
  );
}

/**
 * Handles both Wikiquote quote layouts within one pass:
 *   - `* bullet` solo quotes (films' per-character sections), attributed to
 *     the section heading, with inline `'''A:''' … '''B:''' …` promotion.
 *   - `:'''Speaker''': line` definition-list dialogue (films' Dialogue
 *     sections AND series season-subpage episodes), grouped into blocks.
 * Blocks/quotes are separated by `----`, `<hr>`, blank lines, level-3
 * headings (converted to `----` upstream), or a mode switch.
 */
function parseSection(s: Section, quotes: Quote[]): void {
  const heading = s.heading || "";
  let solo: string[] = [];
  let block: QuoteLine[] = [];

  const trim = (lines: QuoteLine[]): QuoteLine[] =>
    lines.map((l) => ({ speaker: l.speaker, text: trimLongLines(l.text) }));

  const flushSolo = () => {
    if (solo.length === 0) return;
    const raw = solo.join(" ");
    solo = [];
    const inline = splitInlineSpeakers(raw);
    if (inline) {
      const lines = inline.filter((l) => l.text);
      if (lines.length && lines.reduce((a, l) => a + l.text.length, 0) >= MIN_QUOTE_CHARS) {
        quotes.push({ lines: trim(lines) });
      }
      return;
    }
    const text = stripMarkup(raw);
    if (usable(text)) quotes.push({ lines: [{ speaker: heading, text: trimLongLines(text) }] });
  };

  const flushBlock = () => {
    const lines = block.filter((l) => l.text);
    block = [];
    if (lines.length === 0) return;
    if (lines.length === 1) {
      // A lone speaker line is really a solo quote.
      const only = lines[0]!;
      if (usable(only.text)) quotes.push({ lines: [{ speaker: only.speaker, text: trimLongLines(only.text) }] });
      return;
    }
    if (lines.reduce((a, l) => a + l.text.length, 0) < MIN_QUOTE_CHARS) return;
    const trimmed = trim(lines);
    for (const chunk of chunkDialogue(trimmed)) {
      if (chunk.reduce((a, l) => a + l.text.length, 0) >= MIN_QUOTE_CHARS) {
        quotes.push({ lines: chunk });
      }
    }
  };

  const flushAll = () => {
    flushSolo();
    flushBlock();
  };

  for (const line of s.body) {
    if (SEPARATOR_RE.test(line) || line.trim() === "") {
      flushAll();
      continue;
    }

    const bullet = line.match(/^\*+\s+(.*)$/);
    if (bullet) {
      // Bullets are solo-mode; a bullet ends any dialogue block and any
      // previous bullet.
      flushBlock();
      flushSolo();
      solo.push(bullet[1]!);
      continue;
    }

    const dl = matchSpeaker(line);
    if (dl) {
      // A speaker line ends any solo bullet (mode switch to dialogue).
      flushSolo();
      const speaker = stripMarkup(dl[1]!).replace(/:$/, "").trim();
      if (NAV_SPEAKER_RE.test(speaker)) {
        flushBlock(); // season-nav header — not dialogue
        continue;
      }
      const text = stripMarkup(dl[2]!);
      block.push({ speaker, text });
      continue;
    }

    // Continuation line: append to whichever quote is open.
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (block.length > 0) {
      const last = block[block.length - 1]!;
      const extra = stripMarkup(trimmed.replace(/^[:*]+\s*/, ""));
      if (extra) last.text = `${last.text} ${extra}`.trim();
    } else if (solo.length > 0) {
      const cont = line.match(/^(?::+|\*+:+|\*\*+)\s*(.*)$/);
      if (cont && cont[1]!.trim()) solo.push(cont[1]!);
    }
  }
  flushAll();
}

/**
 * Parse a Wikiquote film/series page's wikitext into quotes.
 * Returns [] for redirects or pages with no extractable quotes.
 */
export function parseWikiquote(wikitext: string): Quote[] {
  if (isRedirect(wikitext)) return [];
  const quotes: Quote[] = [];
  for (const section of splitSections(wikitext)) {
    if (section.kind === "skip") continue;
    parseSection(section, quotes);
  }
  return quotes;
}
