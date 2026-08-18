export type ReplayLabelLane = "top" | "bottom";

interface LayoutInput {
  visualization: string;
  visualizationLabel: string;
  playDirection?: string;
  direction: "left" | "right" | "unknown";
  startPercent: number | null;
  primaryEndPercent: number | null;
  displayFinalPercent: number | null;
  actionEndPercent: number | null;
  firstDownPercent: number | null;
  noMovement: boolean;
  turnover: boolean;
}

interface Placement {
  x: number;
  lane: ReplayLabelLane;
}

export interface ReplayFieldLayout {
  pathY: number;
  passApexY: number;
  situation: Placement;
  identity: Placement;
  start: Placement;
  final: Placement;
  playEnd: Placement;
  turnover: Placement;
  los: Placement;
  firstDown: Placement;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Candidate extends Placement {
  rect: Rect;
  preference: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function rectAt(x: number, lane: ReplayLabelLane, width: number, band: "rail" | "near" = "rail"): Rect {
  const [top, bottom] = band === "near"
    ? lane === "top" ? [25, 39] : [61, 75]
    : lane === "top" ? [3, 22] : [78, 97];
  return { left: x - width / 2, right: x + width / 2, top, bottom };
}

function overlap(a: Rect, b: Rect) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function choose(candidates: Candidate[], occupied: Rect[]) {
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const overflow = Math.max(0, -candidate.rect.left) + Math.max(0, candidate.rect.right - 100);
    const collision = occupied.reduce((total, item) => total + overlap(candidate.rect, item), 0);
    const score = collision * 40 + overflow * 500 + candidate.preference;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  occupied.push(best.rect);
  return { placement: { x: best.x, lane: best.lane }, score: bestScore };
}

function candidates(xs: number[], lanes: ReplayLabelLane[], width: number, preferredLane: ReplayLabelLane, band: "rail" | "near" = "rail") {
  return xs.flatMap((x, xIndex) => lanes.map((lane) => ({
    x,
    lane,
    rect: rectAt(x, lane, width, band),
    preference: xIndex * 4 + (lane === preferredLane ? 0 : 3),
  })));
}

function pathRects(start: number, end: number, apexY: number, isPass: boolean) {
  const rects: Rect[] = [];
  const samples = Math.max(8, Math.ceil(Math.abs(end - start) / 4));
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const x = start + (end - start) * t;
    const y = isPass ? 50 * (1 - t) ** 2 + 2 * apexY * (1 - t) * t + 50 * t ** 2 : 50;
    rects.push({ left: x - 1.8, right: x + 1.8, top: y - 3.5, bottom: y + 3.5 });
  }
  return rects;
}

function buildLayout(input: LayoutInput, passApexY: number) {
  const start = input.startPercent ?? 50;
  const end = input.primaryEndPercent ?? start;
  const isPass = input.visualization.startsWith("pass-");
  const occupied = pathRects(start, end, passApexY, isPass);
  let score = 0;

  const startXs = [clamp(start, 11, 89), clamp(start + (start < 50 ? 5 : -5), 11, 89)];
  const finalAnchor = input.displayFinalPercent ?? start;
  const finalXs = [clamp(finalAnchor, 11, 89), clamp(finalAnchor + (finalAnchor < 50 ? 5 : -5), 11, 89)];
  const actionAnchor = input.actionEndPercent ?? finalAnchor;
  const actionXs = [clamp(actionAnchor, 11, 89), clamp(actionAnchor + (actionAnchor < 50 ? 5 : -5), 11, 89)];
  const oppositeArc: ReplayLabelLane = passApexY < 50 ? "bottom" : "top";

  const placedStart = choose(candidates(startXs, [oppositeArc, oppositeArc === "top" ? "bottom" : "top"], 20, oppositeArc), occupied);
  score += placedStart.score;
  const placedFinal = input.noMovement || input.displayFinalPercent === null
    ? placedStart
    : choose(candidates(finalXs, ["bottom", "top"], 20, "bottom"), occupied);
  if (!input.noMovement && input.displayFinalPercent !== null) score += placedFinal.score;

  const hasDistinctPlayEnd = input.actionEndPercent !== null && Math.abs(actionAnchor - finalAnchor) > .1;
  const placedPlayEnd = hasDistinctPlayEnd
    ? choose(candidates(actionXs, ["top", "bottom"], 20, "top"), occupied)
    : { placement: { x: actionXs[0], lane: "top" as const }, score: 0 };
  score += placedPlayEnd.score;

  const upstream = input.direction === "right" ? -1 : input.direction === "left" ? 1 : start < 50 ? -1 : 1;
  const situationXs = [clamp(start + upstream * 12, 15, 85), clamp(start, 15, 85), clamp(start - upstream * 12, 15, 85)];
  const placedSituation = choose(candidates(situationXs, [oppositeArc, oppositeArc === "top" ? "bottom" : "top"], 28, oppositeArc, "near"), occupied);
  score += placedSituation.score;

  const pathMidpoint = (start + end) / 2;
  const identityXs = pathMidpoint < 50 ? [76, 50, 24] : [24, 50, 76];
  const identityWidth = clamp(18 + (input.visualizationLabel.length + (input.playDirection?.length ?? 0)) * .55, 24, 38);
  const placedIdentity = choose(candidates(identityXs, [oppositeArc, oppositeArc === "top" ? "bottom" : "top"], identityWidth, oppositeArc), occupied);
  score += placedIdentity.score;

  const turnoverXs = [clamp(finalAnchor, 12, 88), clamp(finalAnchor + (finalAnchor < 50 ? 10 : -10), 12, 88)];
  const placedTurnover = input.turnover
    ? choose(candidates(turnoverXs, [oppositeArc, oppositeArc === "top" ? "bottom" : "top"], 18, oppositeArc, "near"), occupied)
    : { placement: { x: turnoverXs[0], lane: oppositeArc }, score: 0 };
  score += placedTurnover.score;

  const los = choose(candidates(
    [clamp(start - 4, 4, 96), clamp(start + 4, 4, 96), clamp(start, 4, 96)],
    ["bottom", "top"], 7, "bottom",
  ), occupied).placement;
  const firstDownAnchor = input.firstDownPercent ?? 50;
  let firstDown = input.firstDownPercent === null
    ? { x: firstDownAnchor, lane: "top" as const }
    : choose(candidates(
      [clamp(firstDownAnchor + 4, 4, 96), clamp(firstDownAnchor - 4, 4, 96), clamp(firstDownAnchor, 4, 96)],
      ["top", "bottom"], 7, "top",
    ), occupied).placement;
  if (firstDown.lane === los.lane && Math.abs(firstDown.x - los.x) < 8) {
    firstDown = { ...firstDown, lane: los.lane === "top" ? "bottom" : "top" };
  }

  return {
    layout: {
      pathY: 50,
      passApexY,
      situation: placedSituation.placement,
      identity: placedIdentity.placement,
      start: placedStart.placement,
      final: placedFinal.placement,
      playEnd: placedPlayEnd.placement,
      turnover: placedTurnover.placement,
      los,
      firstDown,
    } satisfies ReplayFieldLayout,
    score,
  };
}

/**
 * Plans annotations around the play instead of assigning fixed screen coordinates.
 * The route is always joined to the START/FINAL centerline. Labels are placed from
 * a small set of broadcast-like rails and scored against the route and one another.
 */
export function planReplayFieldLayout(input: LayoutInput): ReplayFieldLayout {
  if (!input.visualization.startsWith("pass-")) return buildLayout(input, 50).layout;
  const upper = buildLayout(input, 27);
  const lower = buildLayout(input, 73);
  return upper.score <= lower.score ? upper.layout : lower.layout;
}
