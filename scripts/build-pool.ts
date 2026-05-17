/**
 * Build data/movies.json from Wikidata (CC0).
 *
 * Selects films that have an English Wikiquote page, an IMDb id (for the
 * post-round deep link only), and a publication date. "Has a curated
 * Wikiquote page" is itself the quality filter — it replaces the old
 * IMDb vote-count tiers. No IMDb access.
 *
 * Run with: npm run build:pool
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Decade, Genre, Kind, Movie } from "../lib/types";

const OUT = path.join(process.cwd(), "data", "movies.json");
const SPARQL = "https://query.wikidata.org/sparql";
const UA =
  "ReelQuotes/1.0 (https://github.com/mrgarris0n/reelquotes) build-pool";

// Wikidata QIDs for the title kinds we accept.
const FILM = "wd:Q11424";

const GENRE_MAP: [RegExp, Genre][] = [
  [/sci(ence)?[- ]?fi|science fiction/i, "Sci-Fi"],
  [/animat/i, "Animation"],
  [/romanc|romantic/i, "Romance"],
  [/comedy/i, "Comedy"],
  [/action/i, "Action"],
  [/adventure/i, "Adventure"],
  [/thriller/i, "Thriller"],
  [/horror/i, "Horror"],
  [/crime/i, "Crime"],
  [/myster/i, "Mystery"],
  [/fantasy/i, "Fantasy"],
  [/western/i, "Western"],
  [/\bwar\b/i, "War"],
  [/family|children/i, "Family"],
  [/drama/i, "Drama"],
];

function mapGenres(labels: string[]): Genre[] {
  const out = new Set<Genre>();
  for (const label of labels) {
    for (const [re, g] of GENRE_MAP) {
      if (re.test(label)) out.add(g);
    }
  }
  return [...out];
}

function decadeFor(year: number): Decade | null {
  if (year >= 1950 && year < 1960) return "1950s";
  if (year >= 1960 && year < 1970) return "1960s";
  if (year >= 1970 && year < 1980) return "1970s";
  if (year >= 1980 && year < 1990) return "1980s";
  if (year >= 1990 && year < 2000) return "1990s";
  if (year >= 2000 && year < 2010) return "2000s";
  if (year >= 2010 && year < 2020) return "2010s";
  if (year >= 2020 && year < 2030) return "2020s";
  return null;
}

interface Row {
  title: { value: string };
  year: { value: string };
  imdb: { value: string };
  wq: { value: string };
  genres: { value: string };
}

async function runSparql(query: string): Promise<Row[]> {
  const res = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
  });
  if (!res.ok) {
    throw new Error(`Wikidata SPARQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { results: { bindings: Row[] } };
  return json.results.bindings;
}

const QUERY = `
SELECT ?title (SAMPLE(?yr) AS ?year) (SAMPLE(?im) AS ?imdb) ?wq
       (GROUP_CONCAT(DISTINCT ?gl; SEPARATOR="|") AS ?genres) WHERE {
  ?item wdt:P31 ${FILM} ;
        wdt:P345 ?im ;
        wdt:P577 ?pub ;
        rdfs:label ?title .
  FILTER(LANG(?title) = "en")
  BIND(YEAR(?pub) AS ?yr)
  ?sl schema:about ?item ;
      schema:isPartOf <https://en.wikiquote.org/> ;
      schema:name ?wq .
  OPTIONAL { ?item wdt:P136 ?g . ?g rdfs:label ?gl . FILTER(LANG(?gl) = "en") }
}
GROUP BY ?title ?wq
`;

async function main(): Promise<void> {
  await mkdir(path.dirname(OUT), { recursive: true });
  console.log("Querying Wikidata for films with English Wikiquote pages...");
  const rows = await runSparql(QUERY);
  console.log(`Wikidata returned ${rows.length} rows`);

  const seen = new Set<string>();
  const movies: Movie[] = [];
  for (const r of rows) {
    const wqTitle = r.wq?.value;
    const imdb = r.imdb?.value;
    const title = r.title?.value;
    if (!wqTitle || !imdb || !title) continue;
    if (seen.has(wqTitle)) continue; // first publication-year wins
    const year = Number(r.year?.value);
    if (!Number.isFinite(year)) continue;
    const decade = decadeFor(year);
    if (!decade) continue;
    seen.add(wqTitle);
    const genres = mapGenres((r.genres?.value ?? "").split("|").filter(Boolean));
    const kind: Kind = "movie";
    movies.push({ id: imdb, title, year, decade, kind, genres, wqTitle });
  }

  movies.sort((a, b) => a.title.localeCompare(b.title));
  await writeFile(OUT, JSON.stringify(movies));
  console.log(`Wrote ${movies.length} movies to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
