// Token freshness windows. The server rejects tokens older than these limits,
// which (a) caps the value of any one leaked AES key to its window and (b)
// keeps round/score state from drifting against current code.
export const ROUND_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
export const SCORE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isRoundExpired(startedAt: number): boolean {
  return Date.now() - startedAt > ROUND_MAX_AGE_MS;
}

export function isScoreExpired(lastUpdatedAt: number): boolean {
  return Date.now() - lastUpdatedAt > SCORE_MAX_AGE_MS;
}
