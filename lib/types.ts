export type PopularityTier = "iconic" | "popular" | "known" | "niche";

export type Decade =
  | "1950s"
  | "1960s"
  | "1970s"
  | "1980s"
  | "1990s"
  | "2000s"
  | "2010s"
  | "2020s";

export interface Movie {
  id: string;
  title: string;
  year: number;
  decade: Decade;
  tier: PopularityTier;
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
  tiers?: PopularityTier[];
}

export type RoundStatus = "active" | "won" | "lost";

export type Difficulty = "easy" | "normal" | "hard";

export interface RoundState {
  id: string;
  imdbId: string;
  title: string;
  year: number;
  acceptableTitles: string[];
  quotes: Quote[];
  index: number;
  status: RoundStatus;
  startedAt: number;
  difficulty: Difficulty;
}

export interface ScoreState {
  id: string;
  score: number;
  roundsWon: number;
  startedAt: number;
  lastUpdatedAt: number;
  difficulty: Difficulty;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  roundsWon: number;
  sessionId: string;
  submittedAt: number;
  difficulty: Difficulty;
}
