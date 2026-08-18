import type { Drive, GameData, Play, PlayAction, PlayPhase, TeamId } from "./types";

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
export type ReplayVisualization = "run" | "pass-complete" | "pass-incomplete" | "pass-intercepted" | "sack" | "touchdown" | "field-goal" | "other";
export type ReplayResultState = "positive" | "negative" | "no-gain" | "incomplete" | "touchdown" | "field-goal-good" | "field-goal-missed" | "turnover" | "neutral" | "unknown";

function officialAction(play: Play) {
  return play.details.actions[play.details.officialActionIndex] ?? play.details.action;
}

function schematicLane(direction?: string) {
  if (direction?.includes("left")) return 38;
  if (direction?.includes("right")) return 62;
  return 50;
}

function visualizationFor(play: Play, action: PlayAction): ReplayVisualization {
  if (action.type === "field-goal") return "field-goal";
  if (action.type === "pass") {
    if (action.outcome === "incomplete") return "pass-incomplete";
    if (action.outcome === "interception" || play.details.events.some((event) => event.type === "interception")) return "pass-intercepted";
    return "pass-complete";
  }
  if (["rush", "scramble", "kneel", "advance"].includes(action.type)) return "run";
  if (action.type === "sack") return "sack";
  if (play.details.events.some((event) => event.type === "touchdown") || action.outcome === "touchdown" || play.kind === "touchdown") return "touchdown";
  return "other";
}

function visualizationLabel(visualization: ReplayVisualization, action: PlayAction) {
  if (visualization === "run") return action.type === "scramble" ? "QB SCRAMBLE" : action.type === "kneel" ? "KNEEL" : "RUN";
  if (visualization === "pass-complete") return "PASS COMPLETE";
  if (visualization === "pass-incomplete") return "PASS INCOMPLETE";
  if (visualization === "pass-intercepted") return "PASS INTERCEPTED";
  if (visualization === "sack") return "SACK";
  if (visualization === "touchdown") return "TOUCHDOWN";
  if (visualization === "field-goal") return "FIELD GOAL";
  return "PLAY";
}

function cueLabel(action: PlayAction) {
  return [action.depth, action.direction].filter(Boolean).join(" ").toUpperCase() || undefined;
}

function turnoverLabel(play: Play) {
  if (play.details.events.some((event) => event.type === "interception")) return "INTERCEPTION";
  const recovery = [...play.details.events].reverse().find((event) => event.type === "recovery");
  if (play.details.events.some((event) => event.type === "fumble") && recovery?.teamId && recovery.teamId !== play.possession) return "FUMBLE LOST";
  return undefined;
}

function yardResultLabel(yards: number | null) {
  if (yards === null) return "RESULT NOT ESTIMATED";
  if (yards === 0) return "NO GAIN · 0 YARDS";
  return `${yards > 0 ? "+" : ""}${yards} YARDS`;
}

function resultPresentation(play: Play, action: PlayAction, movementYards: number | null, fieldGoalOutcome?: "good" | "missed") {
  const turnover = turnoverLabel(play);
  if (turnover) return { resultLabel: turnover, resultDetail: movementYards === null ? undefined : yardResultLabel(movementYards), resultState: "turnover" as const };
  if (play.details.events.some((event) => event.type === "touchdown") || action.outcome === "touchdown" || play.kind === "touchdown") return { resultLabel: "TOUCHDOWN", resultDetail: action.actor, resultState: "touchdown" as const };
  if (fieldGoalOutcome) return { resultLabel: fieldGoalOutcome === "good" ? "FIELD GOAL · GOOD" : "FIELD GOAL · MISSED", resultDetail: action.yards === undefined ? undefined : `${action.yards} YARDS`, resultState: fieldGoalOutcome === "good" ? "field-goal-good" as const : "field-goal-missed" as const };
  if (action.outcome === "incomplete") return { resultLabel: `INCOMPLETE · ${movementYards && movementYards !== 0 ? `${movementYards > 0 ? "+" : ""}${movementYards}` : "0"} YARDS`, resultDetail: movementYards && movementYards !== 0 ? "OFFICIAL BALL ADJUSTMENT" : undefined, resultState: movementYards && movementYards < 0 ? "negative" as const : "incomplete" as const };
  if (movementYards === null) return { resultLabel: "RESULT NOT ESTIMATED", resultDetail: undefined, resultState: "unknown" as const };
  if (movementYards > 0) return { resultLabel: yardResultLabel(movementYards), resultDetail: "POSITIVE GAIN", resultState: "positive" as const };
  if (movementYards < 0) return { resultLabel: yardResultLabel(movementYards), resultDetail: "LOSS", resultState: "negative" as const };
  return { resultLabel: yardResultLabel(0), resultDetail: "BALL DID NOT ADVANCE", resultState: "no-gain" as const };
}

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
  if (!play) return { ...base, mode: "unknown" as ReplayFieldMode, visualization: "other" as ReplayVisualization, visualizationLabel: "PLAY", playDirection: undefined, schematicLane: 50, schematicTargetPercent: null, displayFinalPosition: undefined, displayFinalPercent: null, displayMovementYards: null, finalSource: "unknown" as const, noMovement: false, resultLabel: undefined, resultDetail: undefined, resultState: "unknown" as ReplayResultState, turnover: false, phases: [] as ReplayPhaseSummary[], downDistance: undefined, fieldGoal: undefined };

  const action = officialAction(play);
  const touchdownAction = play.details.actions.find((candidate) => candidate.outcome === "touchdown");
  const fieldGoalAction = play.details.actions.find((candidate) => candidate.type === "field-goal") ?? (action.type === "field-goal" ? action : undefined);
  const visualizationAction = touchdownAction ?? action;
  const visualization = visualizationFor(play, visualizationAction);
  const playDirection = cueLabel(visualizationAction);
  const lane = schematicLane(visualizationAction.direction);
  const turnover = Boolean(turnoverLabel(play));

  if (touchdownAction || play.kind === "touchdown") {
    const goalAbsolute = base.direction === "right" ? 100 : 0;
    return {
      ...base,
      mode: "touchdown" as const,
      visualization,
      visualizationLabel: visualizationLabel(visualization, visualizationAction),
      playDirection,
      schematicLane: lane,
      schematicTargetPercent: null,
      displayFinalPosition: "END ZONE",
      displayFinalPercent: fieldPercent(goalAbsolute),
      displayMovementYards: touchdownAction?.yards ?? null,
      finalSource: "touchdown" as const,
      noMovement: false,
      ...resultPresentation(play, touchdownAction ?? action, touchdownAction?.yards ?? null),
      turnover,
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
      visualization,
      visualizationLabel: visualizationLabel(visualization, visualizationAction),
      playDirection,
      schematicLane: lane,
      schematicTargetPercent: null,
      displayFinalPosition: "UPRIGHTS",
      displayFinalPercent: fieldPercent(goalAbsolute),
      displayMovementYards: null,
      finalSource: "kick-target" as const,
      noMovement: false,
      ...resultPresentation(play, fieldGoalAction, null, outcome),
      turnover,
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
  const targetDistance = action.depth === "deep" ? 24 : 14;
  const schematicTargetPercent = visualization === "pass-incomplete" && base.startPercent !== null && base.direction !== "unknown"
    ? clamp(base.startPercent + (base.direction === "right" ? targetDistance : -targetDistance), 12, 88) : null;
  return {
    ...base,
    mode,
    visualization,
    visualizationLabel: visualizationLabel(visualization, visualizationAction),
    playDirection,
    schematicLane: lane,
    schematicTargetPercent,
    displayFinalPosition,
    displayFinalPercent,
    displayMovementYards,
    finalSource,
    noMovement,
    ...resultPresentation(play, action, displayMovementYards),
    turnover,
    phases: [] as ReplayPhaseSummary[],
    downDistance: downDistance(play),
    fieldGoal: undefined,
  };
}

export type DriveResultCategory = "touchdown" | "field-goal-good" | "field-goal-missed" | "fumble" | "interception" | "downs" | "safety" | "punt" | "end" | "other";

export function driveResultView(game: Pick<GameData, "teams">, drive: Drive, play: Play, next?: Play) {
  const raw = drive.result.trim();
  const action = officialAction(play);
  const stateAfter = play.stateAfter;
  const recovery = [...play.details.events].reverse().find((event) => event.type === "recovery" && event.teamId && event.teamId !== drive.teamId);
  const interception = [...play.details.events].reverse().find((event) => event.type === "interception" && event.teamId);
  let category: DriveResultCategory = "other", label = raw.toUpperCase();
  if (/touchdown/i.test(raw)) { category = "touchdown"; label = "TOUCHDOWN"; }
  else if (/missed.*field goal|missed fg/i.test(raw) || action.type === "field-goal" && action.outcome !== "good") { category = "field-goal-missed"; label = "FIELD GOAL MISSED"; }
  else if (/field goal/i.test(raw)) { category = "field-goal-good"; label = "FIELD GOAL GOOD"; }
  else if (/fumble/i.test(raw) || recovery) { category = "fumble"; label = recovery ? "FUMBLE LOST" : "FUMBLE"; }
  else if (/interception/i.test(raw) || interception) { category = "interception"; label = "INTERCEPTION"; }
  else if (/downs/i.test(raw)) { category = "downs"; label = "TURNOVER ON DOWNS"; }
  else if (/safety/i.test(raw)) { category = "safety"; label = "SAFETY"; }
  else if (/punt/i.test(raw)) { category = "punt"; label = "PUNT"; }
  else if (/end of (?:half|game)|half|game/i.test(raw)) { category = "end"; label = raw.toUpperCase(); }

  const knownTeamId = stateAfter?.possession !== drive.teamId ? stateAfter?.possession : recovery?.teamId ?? interception?.teamId
    ?? (next?.index === play.index + 1 && next.possession !== drive.teamId ? next.possession : undefined);
  const knownNext = knownTeamId && next?.index === play.index + 1 && next.possession === knownTeamId ? next : undefined;
  const ballPosition = stateAfter && knownTeamId && stateAfter.possession === knownTeamId ? stateAfter.ballPosition : recovery?.location ?? interception?.location ?? knownNext?.stateBefore.ballPosition;
  const possessionChange = knownTeamId ? {
    teamId: knownTeamId,
    ballPosition,
    downDistance: knownNext ? downDistance(knownNext) : undefined,
  } : undefined;
  return { category, label, teamId: drive.teamId, possessionChange };
}
