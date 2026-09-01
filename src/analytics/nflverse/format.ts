export function formatEpa(value: number) {
  if (!Number.isFinite(value)) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function formatYards(value: number) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.abs(value - Math.round(value)) < 0.05 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} yd`;
}

export function formatWinProbability(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return `${Math.round(value * 100)}%`;
}

export function formatProbabilityPoints(value: number) {
  if (!Number.isFinite(value) || value < 0) return null;
  return value < 0.05 ? "0.0 pts" : `+${value.toFixed(1)} pts`;
}
