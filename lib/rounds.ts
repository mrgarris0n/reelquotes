import type { RoundState } from "./types";

const ROUND_TTL_MS = 30 * 60 * 1000;

interface RoundStoreGlobal {
  rounds: Map<string, RoundState>;
  sweeperStarted: boolean;
}

const g = globalThis as unknown as { __reelquotesRounds?: RoundStoreGlobal };
if (!g.__reelquotesRounds) {
  g.__reelquotesRounds = { rounds: new Map(), sweeperStarted: false };
}
const store = g.__reelquotesRounds;

function startSweeper(): void {
  if (store.sweeperStarted) return;
  store.sweeperStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, round] of store.rounds) {
      if (now - round.startedAt > ROUND_TTL_MS) store.rounds.delete(id);
    }
  }, 5 * 60 * 1000).unref();
}

export function createRound(state: RoundState): void {
  startSweeper();
  store.rounds.set(state.id, state);
}

export function getRound(id: string): RoundState | undefined {
  return store.rounds.get(id);
}

export function updateRound(round: RoundState): void {
  store.rounds.set(round.id, round);
}
