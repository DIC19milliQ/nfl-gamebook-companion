export function formatEpa(value: number) {
  if (!Number.isFinite(value)) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
