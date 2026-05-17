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
  return s.replace(/\s+/g, " ").trim();
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
  // Implicit lead section so a page that opens straight into a Quotes list
  // (no level-2 heading) still gets scanned.
  let current: Section = { heading: "", kind: "character", body: [] };
  for (const line of lines) {
    const h2 = line.match(/^==\s*([^=].*?)\s*==\s*$/);
    if (h2) {
      sections.push(current);
      const heading = h2[1]!.trim();
      current = { heading, kind: classify(heading), body: [] };
      continue;
    }
    // Drop level-3+ heading lines; their grouping is cosmetic for our purposes.
    if (/^===+\s*[^=].*?\s*===+\s*$/.test(line)) continue;
    current.body.push(line);
  }
  sections.push(current);
  return sections;
}

// --- per-section parsers ----------------------------------------------------

function parseCharacterSection(s: Section, quotes: Quote[]): void {
  const speaker = s.heading || "";
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const raw = buffer.join(" ");
    buffer = [];
    const inline = splitInlineSpeakers(raw);
    if (inline) {
      const lines = inline.filter((l) => l.text);
      if (lines.length && lines.reduce((a, l) => a + l.text.length, 0) >= MIN_QUOTE_CHARS) {
        quotes.push({ lines });
      }
      return;
    }
    const text = stripMarkup(raw);
    if (usable(text)) quotes.push({ lines: [{ speaker, text }] });
  };

  for (const line of s.body) {
    const bullet = line.match(/^\*+\s+(.*)$/);
    if (bullet) {
      flush();
      buffer.push(bullet[1]!);
      continue;
    }
    // `:`-indented or `**` continuation of the current bullet.
    const cont = line.match(/^(?::+|\*+:+|\*\*+)\s*(.*)$/);
    if (cont && buffer.length > 0) {
      if (cont[1]!.trim()) buffer.push(cont[1]!);
      continue;
    }
    if (line.trim() === "") flush();
  }
  flush();
}

const DL_SPEAKER_RE = /^\s*(?::+\s*)?(?:\*+\s*)?'''\s*([^'\n]+?)\s*'''\s*:?\s*(.*)$/;
const DL_SEMICOLON_RE = /^\s*;\s*([^:]+?)\s*:\s*(.*)$/;

function parseDialogueSection(s: Section, quotes: Quote[]): void {
  let block: QuoteLine[] = [];

  const flush = () => {
    const lines = block.filter((l) => l.text);
    block = [];
    if (lines.length === 0) return;
    if (lines.reduce((a, l) => a + l.text.length, 0) < MIN_QUOTE_CHARS) return;
    quotes.push({ lines });
  };

  for (const line of s.body) {
    if (/^----+\s*$/.test(line)) {
      flush();
      continue;
    }
    const m = line.match(DL_SPEAKER_RE) ?? line.match(DL_SEMICOLON_RE);
    if (m) {
      const speaker = stripMarkup(m[1]!).replace(/:$/, "").trim();
      const text = stripMarkup(m[2]!);
      block.push({ speaker, text });
      continue;
    }
    // Continuation of the previous speaker's line.
    const trimmed = line.trim();
    if (trimmed && block.length > 0) {
      const last = block[block.length - 1]!;
      const extra = stripMarkup(trimmed.replace(/^[:*]+\s*/, ""));
      if (extra) last.text = `${last.text} ${extra}`.trim();
    }
  }
  flush();
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
    if (section.kind === "dialogue") parseDialogueSection(section, quotes);
    else parseCharacterSection(section, quotes);
  }
  return quotes;
}
