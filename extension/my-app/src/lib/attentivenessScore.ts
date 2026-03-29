/**
 * Logistic display curve for raw attentiveness scores (0–100-ish from API).
 */
export function adjustAttentivenessScore(score: number): number {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return score
  }
  const k = 0.18 // steeper curve
  const x0 = 45 // shift left so 55 is already “high”
  return 100 / (1 + Math.exp(-k * (score - x0)))
}

export function formatAdjustedAttentivenessScore(score: number): string {
  const y = adjustAttentivenessScore(score)
  return Number.isFinite(y) ? y.toFixed(1) : String(score)
}
