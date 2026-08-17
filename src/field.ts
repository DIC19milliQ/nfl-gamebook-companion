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
  const startPosition = play?.stateBefore.ballPosition ?? play?.yardLine;
  const absoluteBall = startPosition ? absoluteYardLine(startPosition, game) : null;
  const direction = play ? attackDirection(play.possession, game) : "unknown";
  let firstDown: number | null = null;
  if (absoluteBall !== null && play && direction !== "unknown") {
    const distance = play.distance === "Goal" ? direction === "right" ? 100 - absoluteBall : absoluteBall : play.distance;
    firstDown = clamp(absoluteBall + (direction === "right" ? distance : -distance), 0, 100);
  }
  const finalPosition = play?.details.officialEndPosition;
  const absoluteFinal = finalPosition ? absoluteYardLine(finalPosition, game) : null;
  const actionEnd = play?.details.spots?.filter((spot) => spot.kind === "action-end" && spot.certain).at(-1)?.position;
  const absoluteActionEnd = actionEnd ? absoluteYardLine(actionEnd, game) : null;
  const movementYards = absoluteBall !== null && absoluteFinal !== null && direction !== "unknown" ? Math.round((absoluteFinal - absoluteBall) * (direction === "right" ? 1 : -1)) : null;
  return {
    direction,
    ballPercent: fieldPercent(absoluteBall ?? 50),
    startPosition,
    startPercent: absoluteBall === null ? null : fieldPercent(absoluteBall),
    actionEndPosition: actionEnd,
    actionEndPercent: absoluteActionEnd === null ? null : fieldPercent(absoluteActionEnd),
    finalPosition,
    endPercent: absoluteFinal === null ? null : fieldPercent(absoluteFinal),
    movementYards,
    spots: (play?.details.spots ?? []).filter((spot) => spot.certain).map((spot) => ({ ...spot, percent: absoluteYardLine(spot.position, game) })).filter((spot) => spot.percent !== null).map((spot) => ({ ...spot, percent: fieldPercent(spot.percent!) })),
    firstDownPercent: firstDown === null ? null : fieldPercent(firstDown),
    leftTeam: game.teams[0],
    rightTeam: game.teams[1],
  };
}
