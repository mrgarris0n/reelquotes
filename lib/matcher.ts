import { distance } from "fastest-levenshtein";

const LEADING_ARTICLES = /^(the|a|an)\s+/;

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutArticle(s: string): string {
  return s.replace(LEADING_ARTICLES, "").trim();
}

function withoutSubtitle(s: string): string {
  // Strip anything after a colon in the *original* (already normalized) form.
  const idx = s.indexOf(":");
  return idx > 0 ? s.slice(0, idx).trim() : s;
}

export function buildAcceptableTitles(rawTitle: string): string[] {
  const full = normalize(rawTitle);
  const subFromRaw = withoutSubtitle(rawTitle);
  const variants = new Set<string>();
  variants.add(full);
  variants.add(withoutArticle(full));
  const subNorm = normalize(subFromRaw);
  if (subNorm) {
    variants.add(subNorm);
    variants.add(withoutArticle(subNorm));
  }
  return [...variants].filter((v) => v.length > 0);
}

function fuzzyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 3) return false;
  const threshold = Math.max(1, Math.floor(len / 6));
  return distance(a, b) <= threshold;
}

export function matches(guess: string, acceptable: string[]): boolean {
  const g = normalize(guess);
  if (g.length < 2) return false;
  const gNoArticle = withoutArticle(g);
  for (const candidate of acceptable) {
    if (fuzzyEqual(g, candidate)) return true;
    if (fuzzyEqual(gNoArticle, candidate)) return true;
  }
  return false;
}
