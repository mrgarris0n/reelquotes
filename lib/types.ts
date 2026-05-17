export type Kind = "movie" | "series";

export type Decade =
  | "1950s"
  | "1960s"
  | "1970s"
  | "1980s"
  | "1990s"
  | "2000s"
  | "2010s"
  | "2020s";

export type Genre =
  | "Action"
  | "Adventure"
  | "Animation"
  | "Comedy"
  | "Crime"
  | "Drama"
  | "Family"
  | "Fantasy"
  | "Horror"
  | "Mystery"
  | "Romance"
  | "Sci-Fi"
  | "Thriller"
  | "War"
  | "Western";

export const ALL_GENRES: Genre[] = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Drama",
  "Family",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Thriller",
  "War",
  "Western",
];

export interface Movie {
  id: string; // IMDb id (P345) — used only to build the post-round deep link
  title: string;
  year: number;
  decade: Decade;
  kind: Kind;
  genres: Genre[];
  wqTitle: string; // English Wikiquote page title — quote source + attribution
}

export interface QuoteLine {
  speaker: string;
  text: string;
}

export interface Quote {
  lines: QuoteLine[];
}

export interface Filters {
  decades?: Decade[];
  genres?: Genre[];
  kinds?: Kind[];
}

export type RoundStatus = "active" | "won" | "lost";

export type Difficulty = "easy" | "normal" | "hard";

export type HintKind = "year" | "genre" | "title";

export interface RoundState {
  id: string;
  sessionId: string;
  imdbId: string;
  title: string;
  year: number;
  acceptableTitles: string[];
  quotes: Quote[];
  index: number;
  status: RoundStatus;
  startedAt: number;
  difficulty: Difficulty;
  hintsUsed?: { year?: boolean; genre?: boolean; title?: boolean };
}

export interface ScoreState {
  id: string;
  score: number;
  roundsWon: number;
  startedAt: number;
  lastUpdatedAt: number;
  difficulty: Difficulty;
  streak?: number;
  outcomes?: number[]; // per-round: quote index when won, -1 when game-over round
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  roundsWon: number;
  sessionId: string;
  submittedAt: number;
  difficulty: Difficulty;
}
