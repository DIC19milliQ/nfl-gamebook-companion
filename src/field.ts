import type { GameData, Play, TeamId } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function absoluteYardLine(yardLine: string, game: Pick<GameData, "teams">) {
  if (yardLine === "50") return 50;
  const match = yardLine.match(/^([A-Z]{2,3})\s+(\d+)$/);
  if (!match) return null;
  const yard = Number(match[2]);
  if (match[1] === game.teams[0].id) return clamp(yard, 0, 50);
  if (match[1] === game.teams[1].id) return 100 - clamp(yard, 0, 50);
  return null;
}

export function fieldPercent(absoluteYard: number) {
  return 10 + clamp(absoluteYard, 0, 100) * 0.8;
}

export function attackDirection(possession: TeamId, game: Pick<GameData, "teams">) {
  if (possession === game.teams[0].id) return "right" as const;
  if (possession === game.teams[1].id) return "left" as const;
  return "unknown" as const;
}

export function fieldView(game: Pick<GameData, "teams">, play?: Play) {
  const absoluteBall = play ? absoluteYardLine(play.yardLine, game) : null;
  const direction = play ? attackDirection(play.possession, game) : "unknown";
  let firstDown: number | null = null;
  if (absoluteBall !== null && play && direction !== "unknown") {
    const distance = play.distance === "Goal" ? direction === "right" ? 100 - absoluteBall : absoluteBall : play.distance;
    firstDown = clamp(absoluteBall + (direction === "right" ? distance : -distance), 0, 100);
  }
  return {
    direction,
    ballPercent: fieldPercent(absoluteBall ?? 50),
    firstDownPercent: firstDown === null ? null : fieldPercent(firstDown),
    leftTeam: game.teams[0],
    rightTeam: game.teams[1],
  };
}
