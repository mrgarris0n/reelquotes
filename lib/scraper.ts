import { getCached, putCached } from "./cache";
import type { Quote, QuoteLine } from "./types";

function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job();
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(run);
      next();
    });
}

export class InsufficientQuotesError extends Error {
  constructor(public imdbId: string, public found: number) {
    super(`Only ${found} usable quotes for ${imdbId}`);
    this.name = "InsufficientQuotesError";
  }
}

const ENDPOINT = "https://caching.graphql.imdb.com/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const QUERY = `query Quotes($id: ID!, $first: Int!) {
  title(id: $id) {
    quotes(first: $first) {
      edges { node { lines { characters { character } text } } }
    }
  }
}`;

const limit = createLimiter(2);

const MIN_QUOTE_CHARS = 15;
const REQUIRED_QUOTES = 5;
const FETCH_PAGE_SIZE = 50;

interface GqlLine {
  characters: { character: string | null }[] | null;
  text: string | null;
}
interface GqlResponse {
  data?: { title?: { quotes?: { edges?: { node?: { lines?: GqlLine[] } }[] } } };
  errors?: { message: string }[];
}

function isStageDirection(text: string): boolean {
  const t = text.trim();
  return t.startsWith("[") && t.endsWith("]");
}

function isUsable(quote: Quote): boolean {
  if (quote.lines.length === 0) return false;
  if (quote.lines.every((l) => isStageDirection(l.text))) return false;
  const total = quote.lines.reduce((s, l) => s + l.text.length, 0);
  if (total < MIN_QUOTE_CHARS) return false;
  return true;
}

function toQuote(lines: GqlLine[] | undefined): Quote | null {
  if (!lines) return null;
  const out: QuoteLine[] = [];
  for (const line of lines) {
    const text = (line.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const speaker = line.characters?.[0]?.character?.trim() ?? "";
    out.push({ speaker, text });
  }
  if (out.length === 0) return null;
  return { lines: out };
}

function anonymize(quote: Quote): Quote {
  const map = new Map<string, string>();
  return {
    lines: quote.lines.map((line) => {
      if (!line.speaker) return line;
      let label = map.get(line.speaker);
      if (!label) {
        label = `Character ${map.size + 1}`;
        map.set(line.speaker, label);
      }
      return { speaker: label, text: line.text };
    }),
  };
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function fetchFresh(imdbId: string): Promise<Quote[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      "x-imdb-client-name": "imdb-web-next",
      "x-imdb-user-language": "en-US",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { id: imdbId, first: FETCH_PAGE_SIZE },
      operationName: "Quotes",
    }),
  });
  if (!res.ok) throw new Error(`IMDb GraphQL ${res.status} for ${imdbId}`);
  const json = (await res.json()) as GqlResponse;
  if (json.errors?.length) {
    throw new Error(`IMDb GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  const edges = json.data?.title?.quotes?.edges ?? [];
  const quotes: Quote[] = [];
  for (const edge of edges) {
    const q = toQuote(edge.node?.lines);
    if (q && isUsable(q)) quotes.push(q);
  }
  return quotes;
}

export async function scrapeQuotes(imdbId: string): Promise<Quote[]> {
  let pool = await getCached(imdbId);
  if (!pool) {
    pool = await limit(() => fetchFresh(imdbId));
    await putCached(imdbId, pool);
  }
  if (pool.length < REQUIRED_QUOTES) {
    throw new InsufficientQuotesError(imdbId, pool.length);
  }
  return shuffle(pool).slice(0, REQUIRED_QUOTES).map(anonymize);
}
