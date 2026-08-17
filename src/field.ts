import type { GameData, Play, PlayAction, PlayPhase, TeamId } from "./types";

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

export interface ReplayPhaseSummary {
  phase: PlayPhase;
  label: string;
  result: string;
  position?: string;
}

export type ReplayFieldMode = "movement" | "no-movement" | "touchdown" | "field-goal" | "unknown";

function downDistance(play: Play) {
  const suffix = ["TH", "ST", "ND", "RD"][play.down] ?? "TH";
  return `${play.down}${suffix} & ${play.distance}`;
}

function isNoMovementAction(action: PlayAction) {
  return action.outcome === "incomplete" || action.outcome === "no-gain" || action.yards === 0;
}

function safeStateAfterPosition(play: Play, action: PlayAction) {
  if (!isNoMovementAction(action) || play.noPlay || play.details.reviews.length > 0 || play.details.actions.length > 1
    || play.details.events.some((event) => ["fumble", "recovery", "interception", "replay"].includes(event.type))
    || !play.stateAfter || play.stateAfter.possession !== play.stateBefore.possession) return undefined;
  if (!play.details.penalties.length) return play.stateAfter.ballPosition === play.stateBefore.ballPosition ? play.stateAfter.ballPosition : undefined;
  if (play.details.penalties.some((penalty) => penalty.status === "unknown" || penalty.status === "offsetting" || penalty.noPlay)) return undefined;
  return play.stateAfter.ballPosition;
}

function touchdownPhases(play: Play): ReplayPhaseSummary[] {
  const phases: ReplayPhaseSummary[] = [{ phase: "scrimmage", label: "SCRIMMAGE", result: "TOUCHDOWN" }];
  const tryAction = play.details.actions.find((action) => action.type === "extra-point");
  if (tryAction) phases.push({ phase: "try", label: "XP", result: tryAction.outcome === "good" ? "GOOD" : "NO GOOD" });
  else if (play.details.scoring?.extraPoint) phases.push({ phase: "try", label: "XP", result: play.details.scoring.extraPoint.result === "good" ? "GOOD" : "NO GOOD" });
  const kickoffAction = play.details.actions.find((action) => action.type === "kickoff");
  const kickoffPenalty = play.details.penalties.find((penalty) => penalty.phase === "kickoff");
  if (kickoffAction || kickoffPenalty) {
    const result = kickoffPenalty?.type.replace(/^Kickoff\s+/i, "").toUpperCase()
      ?? (kickoffAction?.outcome === "out-of-bounds" || kickoffAction?.boundary === "out-of-bounds" ? "OUT OF BOUNDS" : "KICKED");
    phases.push({ phase: "kickoff", label: "KICKOFF", result, position: kickoffPenalty?.enforcedAt ?? kickoffAction?.endPosition });
  }
  return phases;
}

export function replayFieldView(game: Pick<GameData, "teams">, play?: Play) {
  const base = fieldView(game, play);
  if (!play) return { ...base, mode: "unknown" as ReplayFieldMode, displayFinalPosition: undefined, displayFinalPercent: null, displayMovementYards: null, finalSource: "unknown" as const, noMovement: false, resultLabel: undefined, resultDetail: undefined, phases: [] as ReplayPhaseSummary[], downDistance: undefined, fieldGoal: undefined };

  const action = play.details.actions[play.details.officialActionIndex] ?? play.details.action;
  const touchdownAction = play.details.actions.find((candidate) => candidate.outcome === "touchdown");
  const fieldGoalAction = play.details.actions.find((candidate) => candidate.type === "field-goal") ?? (action.type === "field-goal" ? action : undefined);

  if (touchdownAction || play.kind === "touchdown") {
    const goalAbsolute = base.direction === "right" ? 100 : 0;
    return {
      ...base,
      mode: "touchdown" as const,
      displayFinalPosition: "END ZONE",
      displayFinalPercent: fieldPercent(goalAbsolute),
      displayMovementYards: touchdownAction?.yards ?? null,
      finalSource: "touchdown" as const,
      noMovement: false,
      resultLabel: "TOUCHDOWN",
      resultDetail: touchdownAction?.actor,
      phases: touchdownPhases(play),
      downDistance: downDistance(play),
      fieldGoal: undefined,
    };
  }

  if (fieldGoalAction) {
    const goalAbsolute = base.direction === "right" ? 100 : 0;
    const outcome = fieldGoalAction.outcome === "good" ? "good" as const : "missed" as const;
    return {
      ...base,
      mode: "field-goal" as const,
      displayFinalPosition: "UPRIGHTS",
      displayFinalPercent: fieldPercent(goalAbsolute),
      displayMovementYards: null,
      finalSource: "kick-target" as const,
      noMovement: false,
      resultLabel: outcome === "good" ? "FIELD GOAL · GOOD" : "FIELD GOAL · MISSED",
      resultDetail: fieldGoalAction.yards === undefined ? undefined : `${fieldGoalAction.yards} YDS`,
      phases: [] as ReplayPhaseSummary[],
      downDistance: downDistance(play),
      fieldGoal: { outcome, distance: fieldGoalAction.yards, kicker: fieldGoalAction.actor },
    };
  }

  let displayFinalPosition = base.finalPosition;
  let displayFinalPercent = base.endPercent;
  let finalSource: "explicit" | "state-after" | "unknown" = displayFinalPosition ? "explicit" : "unknown";
  const stateAfterPosition = safeStateAfterPosition(play, action);
  if (stateAfterPosition) {
    displayFinalPosition = stateAfterPosition;
    const stateAfterAbsolute = absoluteYardLine(stateAfterPosition, game);
    displayFinalPercent = stateAfterAbsolute === null ? null : fieldPercent(stateAfterAbsolute);
    finalSource = "state-after";
  }
  const noMovement = base.startPercent !== null && displayFinalPercent !== null && Math.abs(base.startPercent - displayFinalPercent) <= .1;
  const startAbsolute = base.startPosition ? absoluteYardLine(base.startPosition, game) : null;
  const displayFinalAbsolute = displayFinalPosition ? absoluteYardLine(displayFinalPosition, game) : null;
  const displayMovementYards = noMovement ? 0 : startAbsolute !== null && displayFinalAbsolute !== null && base.direction !== "unknown"
    ? Math.round((displayFinalAbsolute - startAbsolute) * (base.direction === "right" ? 1 : -1)) : null;
  const mode: ReplayFieldMode = noMovement ? "no-movement" : displayFinalPosition ? "movement" : "unknown";
  const resultLabel = noMovement ? action.outcome === "incomplete" ? "INCOMPLETE" : "NO GAIN" : undefined;
  return {
    ...base,
    mode,
    displayFinalPosition,
    displayFinalPercent,
    displayMovementYards,
    finalSource,
    noMovement,
    resultLabel,
    resultDetail: noMovement ? `BALL REMAINS AT ${displayFinalPosition}` : undefined,
    phases: [] as ReplayPhaseSummary[],
    downDistance: downDistance(play),
    fieldGoal: undefined,
  };
}
