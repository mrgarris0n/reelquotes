// Points awarded for a correct guess, by quote index. Single source of truth —
// imported by both the server's /guess handler and the client's display.
export const POINTS_PER_QUOTE = [5, 4, 3, 2, 1] as const;

// Max bonus stacked on top of a streak-qualifying win.
export const STREAK_BONUS_CAP = 5;
