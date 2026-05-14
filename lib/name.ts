// Leaderboard name validation. Lives in its own module so the client can
// import it without pulling in @vercel/blob (which lib/leaderboard.ts uses).

export const NAME_MAX_LEN = 10;
const NAME_RE = /[^A-Za-z0-9]/g;

export function sanitizeName(input: string): string {
  return input.replace(NAME_RE, "").slice(0, NAME_MAX_LEN);
}
