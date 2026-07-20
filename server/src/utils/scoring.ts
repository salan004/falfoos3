export function calculateSpeedBonus(responseTimeMs: number, maxBonus = 50, decayFactor = 5): number {
  return Math.max(0, maxBonus - (responseTimeMs / 1000) * decayFactor);
}

export function calculateTimeRemaining(startedAt: number, durationMs: number): number {
  return Math.max(0, durationMs - (Date.now() - startedAt));
}
