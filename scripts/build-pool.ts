/**
 * Build data/movies.json from Wikidata (CC0).
 *
 * Selects films and TV series that have an English Wikiquote page, an IMDb
 * id (for the post-round deep link only), and a date. "Has a curated
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

// Wikidata QIDs. Q11424 = film, Q5398426 = television series.
const FILM = "wd:Q11424";
const SERIES = "wd:Q5398426";

const GENRE_MAP: [RegExp, Genre][] = [
  [/sci(ence)?[- ]?fi|science fiction/i, "Sci-Fi"],
  [/animat/i, "Animation"],
  [/romanc|romantic/i, "Romance"],
  [/comedy|sitcom/i, "Comedy"],
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

// Two narrow queries instead of one union — the union + dual date OPTIONALs
// + genre concat over films∪series exceeds Wikidata's 60s limit. Films carry
// P577 (publication date); series often only have P580 (start time).
const FILM_QUERY = `
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

const SERIES_QUERY = `
SELECT ?title (SAMPLE(?yr) AS ?year) (SAMPLE(?im) AS ?imdb) ?wq
       (GROUP_CONCAT(DISTINCT ?gl; SEPARATOR="|") AS ?genres) WHERE {
  ?item wdt:P31 ${SERIES} ;
        wdt:P345 ?im ;
        rdfs:label ?title .
  FILTER(LANG(?title) = "en")
  OPTIONAL { ?item wdt:P577 ?pub }
  OPTIONAL { ?item wdt:P580 ?start }
  BIND(YEAR(COALESCE(?pub, ?start)) AS ?yr)
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
  const filmRows = await runSparql(FILM_QUERY);
  console.log(`  films: ${filmRows.length} rows`);

  console.log("Querying Wikidata for TV series with English Wikiquote pages...");
  const seriesRows = await runSparql(SERIES_QUERY);
  console.log(`  series: ${seriesRows.length} rows`);

  const seen = new Set<string>();
  const movies: Movie[] = [];
  const ingest = (rows: Row[], kind: Kind) => {
    for (const r of rows) {
      const wqTitle = r.wq?.value;
      const imdb = r.imdb?.value;
      const title = r.title?.value;
      if (!wqTitle || !imdb || !title) continue;
      if (seen.has(wqTitle)) continue; // first occurrence wins
      const year = Number(r.year?.value);
      if (!Number.isFinite(year)) continue;
      const decade = decadeFor(year);
      if (!decade) continue;
      seen.add(wqTitle);
      const genres = mapGenres((r.genres?.value ?? "").split("|").filter(Boolean));
      movies.push({ id: imdb, title, year, decade, kind, genres, wqTitle });
    }
  };
  // Films first so a film and a same-named series resolve to the film.
  ingest(filmRows, "movie");
  ingest(seriesRows, "series");

  movies.sort((a, b) => a.title.localeCompare(b.title));
  await writeFile(OUT, JSON.stringify(movies));
  const counts = movies.reduce<Record<string, number>>((a, m) => {
    a[m.kind] = (a[m.kind] ?? 0) + 1;
    return a;
  }, {});
  console.log(`Wrote ${movies.length} titles to ${OUT} (${JSON.stringify(counts)})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
