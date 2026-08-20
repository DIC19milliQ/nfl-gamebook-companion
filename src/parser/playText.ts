import type {
  PlayAction, PlayAnnotation, PlayDetails, PlayEvent, PlayInjuryUpdate, PlayParticipant,
  PlayParticipantRole, PlayPenalty, PlayPhase, PlayReviewDetails, PlayRuling,
  PlayScoringDetails, PlaySequenceEvent, PlaySequenceType, PlaySpot, Team, TeamId,
} from "../types";
import { normalizeGamebookTeamCode } from "../teamCodes";

const PLAYER_SOURCE = "(?:[A-Z][a-z]?\\.){1,2}[A-Z][A-Za-z'-]*";
const PLAYER_RE = new RegExp(`\\b${PLAYER_SOURCE}`, "g");
const POSITION_SOURCE = "(?:[A-Z]{2,3} \\d+|50|end zone)";
const DIRECTIONS = "left end|left tackle|left guard|up the middle|right guard|right tackle|right end";
const FORMATION_NAMES = new Set(["shotgun", "no huddle", "run formation", "punt formation", "field goal formation"]);

interface Candidate {
  sourceStart: number; sourceEnd: number; type: PlaySequenceType; phase: PlayPhase;
  ruling: PlayRuling; rawText: string; actionIndex?: number; penaltyIndex?: number;
  review?: PlayReviewDetails; injury?: PlayInjuryUpdate; participantNames?: string[];
  location?: string; result?: string; teamId?: TeamId;
}
interface ParsedAction { action: PlayAction; start: number; end: number; formation: string[]; interceptor?: string }

const unique = <T,>(values: T[]) => [...new Set(values)];
const playerNames = (text: string) => unique(text.match(PLAYER_RE) ?? []);
const cleanText = (text: string) => text.replace(/^[\s,.;:*-]+|[\s,.;:*-]+$/g, "").trim();
function teamId(code: string | undefined, teams: [Team, Team]) {
  if (!code) return undefined;
  const direct = teams.find((team) => team.id === code);
  if (direct) return direct.id;
  const normalized = normalizeGamebookTeamCode(code);
  return teams.find((team) => team.id === normalized)?.id;
}
function teamFromName(value: string, teams: [Team, Team]) {
  const needle = value.trim().toLowerCase();
  return teams.find((team) => team.name.toLowerCase().startsWith(needle) || team.shortName.toLowerCase().startsWith(needle))?.id;
}
function opposingTeam(possession: TeamId, teams: [Team, Team]) { return teams.find((team) => team.id !== possession)?.id; }
function resultFromText(text: string) {
  if (/for no gain/i.test(text)) return { outcome: "no-gain" as const, yards: 0 };
  const match = text.match(/for (-?\d+) yards?/i);
  if (!match) return {};
  const yards = Number(match[1]);
  return { outcome: yards < 0 ? "loss" as const : yards === 0 ? "no-gain" as const : "gain" as const, yards };
}
function passDepth(value: string | undefined): "short" | "deep" | undefined { return value?.toLowerCase() === "short" ? "short" : value?.toLowerCase() === "deep" ? "deep" : undefined; }
function parseFormation(value: string) {
  const modifiers = value.split(/\s*,\s*/).map((item) => item.trim()).filter(Boolean);
  return modifiers.length && modifiers.every((item) => FORMATION_NAMES.has(item.toLowerCase())) ? modifiers.map((item) => item.replace(/\b\w/g, (letter) => letter.toUpperCase())) : [];
}

function actionAt(description: string, start: number): ParsedAction | undefined {
  let rest = description.slice(start), prefixLength = 0, formation: string[] = [];
  const formationMatch = rest.match(/^\(([^)]+)\)\s*/);
  if (formationMatch) {
    formation = parseFormation(formationMatch[1]);
    if (!formation.length) return undefined;
    prefixLength = formationMatch[0].length; rest = rest.slice(prefixLength);
  }
  const make = (match: RegExpMatchArray, action: Omit<PlayAction, "rawText" | "formation">, interceptor?: string): ParsedAction => {
    const end = start + prefixLength + match[0].length;
    return { start, end, formation, interceptor, action: { ...action, formation, rawText: description.slice(start, end).trim() } };
  };
  let match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) pass incomplete(?: (short|deep) (left|middle|right))?(?: (?:to|intended for) (${PLAYER_SOURCE}))?`, "i"));
  if (match) return make(match, { type: "pass", actor: match[1], target: match[4], depth: passDepth(match[2]), direction: match[3]?.toLowerCase(), outcome: "incomplete" });
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) pass(?: (short|deep) (left|middle|right))?(?: intended for (${PLAYER_SOURCE}) )?INTERCEPTED by (${PLAYER_SOURCE})(?:\\s*(?:\\([^)]*\\)|\\[[^\\]]+\\]))* at (${POSITION_SOURCE})`, "i"));
  if (match) return make(match, { type: "pass", actor: match[1], target: match[4], depth: passDepth(match[2]), direction: match[3]?.toLowerCase(), outcome: "interception", endPosition: match[6] }, match[5]);
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) pass(?: (short|deep) (left|middle|right))? to (${PLAYER_SOURCE})(?: ((?:ran|pushed) ob))?(?: (?:to|at) (${POSITION_SOURCE}))?(?: for (no gain|-?\\d+ yards?))?(?:, TOUCHDOWN(?: NULLIFIED by Penalty)?)?`, "i"));
  if (match) {
    const result = resultFromText(match[0]), touchdown = /TOUCHDOWN/i.test(match[0]) && !/NULLIFIED/i.test(match[0]);
    return make(match, { type: "pass", actor: match[1], target: match[4], depth: passDepth(match[2]), direction: match[3]?.toLowerCase(), outcome: touchdown ? "touchdown" : "complete", boundary: match[5] ? "out-of-bounds" : undefined, endPosition: match[6]?.toLowerCase() === "end zone" ? undefined : match[6], yards: result.yards });
  }
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) scrambles(?: (${DIRECTIONS}))?(?: ((?:ran|pushed) ob))?(?: (?:to|at) (${POSITION_SOURCE}))?(?: for (no gain|-?\\d+ yards?))?(?:, TOUCHDOWN)?`, "i"));
  if (match) { const result = resultFromText(match[0]); return make(match, { type: "scramble", actor: match[1], direction: match[2]?.toLowerCase(), outcome: /TOUCHDOWN/i.test(match[0]) ? "touchdown" : result.outcome, boundary: match[3] ? "out-of-bounds" : undefined, endPosition: match[4], yards: result.yards }); }
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) (${DIRECTIONS})(?: ((?:ran|pushed) ob))?(?: (?:to|at) (${POSITION_SOURCE}))?(?: for (no gain|-?\\d+ yards?))?(?:, TOUCHDOWN)?`, "i"));
  if (match) { const result = resultFromText(match[0]); return make(match, { type: "rush", actor: match[1], direction: match[2].toLowerCase(), outcome: /TOUCHDOWN/i.test(match[0]) ? "touchdown" : result.outcome, boundary: match[3] ? "out-of-bounds" : undefined, endPosition: match[4], yards: result.yards }); }
  match = rest.match(new RegExp(`^Handoff to (${PLAYER_SOURCE})(?: (?:to|at) (${POSITION_SOURCE}))?(?: for (no gain|-?\\d+ yards?))?`, "i"));
  if (match) { const result = resultFromText(match[0]); return make(match, { type: "rush", actor: match[1], endPosition: match[2], outcome: result.outcome, yards: result.yards }); }
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) kneels?(?: to (${POSITION_SOURCE}))?(?: for (no gain|-?\\d+ yards?))?`, "i"));
  if (match) { const result = resultFromText(match[0]); return make(match, { type: "kneel", actor: match[1], endPosition: match[2], outcome: result.outcome, yards: result.yards }); }
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) spiked`, "i"));
  if (match) return make(match, { type: "spike", actor: match[1], outcome: "incomplete" });
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) sacked(?: (ob))? at (${POSITION_SOURCE}) for (-?\\d+) yards?`, "i"));
  if (match) return make(match, { type: "sack", actor: match[1], outcome: "loss", boundary: match[2] ? "out-of-bounds" : undefined, endPosition: match[3], yards: Number(match[4]) });
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) (\\d+) yard field goal is (GOOD|No Good|BLOCKED)`, "i"));
  if (match) return make(match, { type: "field-goal", actor: match[1], outcome: match[3].toUpperCase() === "GOOD" ? "good" : match[3].toUpperCase() === "BLOCKED" ? "blocked" : "no-good", yards: Number(match[2]) });
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) extra point is (GOOD|No Good)`, "i"));
  if (match) return make(match, { type: "extra-point", actor: match[1], outcome: match[2].toUpperCase() === "GOOD" ? "good" : "no-good" });
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) punts (\\d+) yards? to (${POSITION_SOURCE})`, "i"));
  if (match) return make(match, { type: "punt", actor: match[1], outcome: /fair catch/i.test(description.slice(start, start + prefixLength + match[0].length + 100)) ? "fair-catch" : undefined, endPosition: match[3], yards: Number(match[2]) });
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE}) kicks (\\d+) yards? from (${POSITION_SOURCE}) to (${POSITION_SOURCE})`, "i"));
  if (match) return make(match, { type: "kickoff", actor: match[1], endPosition: match[4].toLowerCase() === "end zone" ? undefined : match[4], yards: Number(match[2]) });
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE})(?: ((?:ran|pushed) ob))?(?: (?:to|at) (${POSITION_SOURCE}))? for (no gain|-?\\d+ yards?)(?:, TOUCHDOWN)?`, "i"));
  if (match) { const result = resultFromText(match[0]); return make(match, { type: "advance", actor: match[1], boundary: match[2] ? "out-of-bounds" : undefined, endPosition: match[3], outcome: /TOUCHDOWN/i.test(match[0]) ? "touchdown" : result.outcome, yards: result.yards }); }
  match = rest.match(new RegExp(`^(${PLAYER_SOURCE})(?: FUMBLES \\(Aborted\\) at| to) (${POSITION_SOURCE})(?: for (no gain|-?\\d+ yards?))?`, "i"));
  if (match) { const result = resultFromText(match[0]); return make(match, { type: "advance", actor: match[1], endPosition: match[2], outcome: result.outcome, yards: result.yards }); }
  return undefined;
}
function findActions(description: string) {
  const starts = new Set<number>();
  for (const match of description.matchAll(new RegExp(PLAYER_SOURCE, "g"))) {
    let start = match.index ?? 0;
    const formation = description.slice(Math.max(0, start - 50), start).match(/\(([^)]+)\)\s*$/);
    if (formation && parseFormation(formation[1]).length) start -= formation[0].length;
    starts.add(start);
  }
  for (const match of description.matchAll(/\bHandoff to /gi)) starts.add(match.index ?? 0);
  return [...starts].sort((a, b) => a - b).map((start) => actionAt(description, start)).filter((value): value is ParsedAction => Boolean(value)).filter((value, index, list) => !list.slice(0, index).some((prior) => value.start >= prior.start && value.end <= prior.end));
}
function addParticipant(list: PlayParticipant[], name: string | undefined, role: PlayParticipantRole, source: PlayParticipant["source"], rawText?: string, participantTeam?: TeamId) {
  if (!name || list.some((participant) => participant.name === name && participant.role === role && participant.source === source)) return;
  list.push({ name, role, source, rawText, teamId: participantTeam });
}
function penaltyKey(penalty: PlayPenalty) { return [penalty.teamId, penalty.playerName, penalty.type.toLowerCase(), penalty.yards, penalty.enforcement, penalty.enforcedAt, penalty.status, penalty.noPlay].join("|"); }
function penaltyOccurrences(description: string, teams: [Team, Team]) {
  const output: { penalty: PlayPenalty; start: number; end: number }[] = [];
  const pattern = new RegExp(`\\bPENALTY on ([A-Z]{2,3})(?:-\\s*(${PLAYER_SOURCE}))?,\\s*([^,.]+?)(?:,\\s*(\\d+) yards?)?(?:,\\s*(declined|offsetting))?(?:(?:,\\s*(enforced at|placed at)\\s*(${POSITION_SOURCE}))|(?:,\\s*(enforced between downs)))?(?:,\\s*(declined|offsetting))?(?:\\s*-\\s*No Play)?(?=\\.|$)`, "gi");
  for (const match of description.matchAll(pattern)) {
    const rawText = match[0], disposition = (match[5] ?? match[9])?.toLowerCase();
    const status = disposition === "declined" ? "declined" : disposition === "offsetting" ? "offsetting" : match[4] || match[6] || match[8] ? "accepted" : "unknown";
    output.push({ start: match.index ?? 0, end: (match.index ?? 0) + rawText.length, penalty: { teamId: teamId(match[1].toUpperCase(), teams), playerName: match[2], type: match[3].trim(), yards: match[4] ? Number(match[4]) : undefined, enforcement: match[8] ? "between-downs" : match[6]?.toLowerCase().startsWith("placed") ? "placed" : match[6] ? "enforced" : undefined, enforcedAt: match[7], status, noPlay: /No Play/i.test(rawText), automaticFirstDown: /automatic first down/i.test(rawText), rawText } });
  }
  return output;
}
function scoringDetails(description: string): PlayScoringDetails | undefined {
  const score = description.match(/\b([A-Z]{2,3}) (\d+) ([A-Z]{2,3}) (\d+),\s*(\d+) plays?,\s*(-?\d+) yards?,(?:\s*(\d+) penalt(?:y|ies),)?\s*(\d+:\d+) drive(?:\s*,\s*(\d+:\d+) elapsed)?/i);
  const extra = description.match(new RegExp(`(${PLAYER_SOURCE}) extra point is (GOOD|No Good)`, "i"));
  if (!score && !extra) return undefined;
  const starts = [score?.index, extra?.index].filter((value): value is number => value !== undefined);
  return { extraPoint: extra ? { kicker: extra[1], result: extra[2].toUpperCase() === "GOOD" ? "good" : "no-good", rawText: extra[0] } : undefined, score: score ? { visitor: Number(score[2]), home: Number(score[4]) } : undefined, drive: score ? { plays: Number(score[5]), yards: Number(score[6]), penalties: score[7] ? Number(score[7]) : undefined, possessionTime: score[8], elapsed: score[9] } : undefined, rawText: description.slice(Math.min(...starts)) };
}
function rulingFor(start: number, reviewResultIndex: number, reversed: boolean): PlayRuling { return !reversed ? "official" : start < reviewResultIndex ? "provisional" : "final"; }
function phaseForAction(action: PlayAction): PlayPhase { return action.type === "extra-point" ? "try" : action.type === "kickoff" ? "kickoff" : action.type === "timeout" ? "administrative" : "scrimmage"; }
function meaningfulRaw(text: string) { const cleaned = cleanText(text); return cleaned && !/^(?:and|the|at|to|for)$/i.test(cleaned) ? text.trim().replace(/^[,.;:\s-]+/, "") : ""; }
function rawGaps(description: string, covered: { sourceStart: number; sourceEnd: number }[]) {
  const intervals = covered.map(({ sourceStart, sourceEnd }) => [sourceStart, sourceEnd] as const).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of intervals) { const last = merged.at(-1); if (last && start <= last[1]) last[1] = Math.max(last[1], end); else merged.push([start, end]); }
  const gaps: { start: number; end: number; text: string }[] = []; let cursor = 0;
  for (const [start, end] of merged) { const text = meaningfulRaw(description.slice(cursor, start)); if (text) gaps.push({ start: cursor, end: start, text }); cursor = Math.max(cursor, end); }
  const text = meaningfulRaw(description.slice(cursor)); if (text) gaps.push({ start: cursor, end: description.length, text }); return gaps;
}

export function parsePlayDetails(description: string, possession: TeamId, teams: [Team, Team], startPosition?: string): PlayDetails {
  const normalized = description.replace(/\s+/g, " ").trim();
  const parsedActions = findActions(normalized);
  const reviewResultMatches = [...normalized.matchAll(/(?:and\s+)?the play was (REVERSED|Upheld|confirmed)/gi)];
  const reversedMatch = reviewResultMatches.find((match) => /reversed/i.test(match[1]));
  const reviewResultIndex = reversedMatch?.index ?? Number.POSITIVE_INFINITY, reversed = Boolean(reversedMatch);
  const actions = parsedActions.map(({ action }) => action), candidates: Candidate[] = [], participants: PlayParticipant[] = [], annotations: PlayAnnotation[] = [], events: PlayEvent[] = [], reviews: PlayReviewDetails[] = [], injuryUpdates: PlayInjuryUpdate[] = [];
  const defense = opposingTeam(possession, teams);
  parsedActions.forEach((parsed, actionIndex) => {
    const phase = phaseForAction(parsed.action);
    candidates.push({ sourceStart: parsed.start, sourceEnd: parsed.end, type: "action", phase, ruling: rulingFor(parsed.start, reviewResultIndex, reversed), rawText: parsed.action.rawText, actionIndex });
    parsed.formation.forEach((rawText) => annotations.push({ kind: "formation", rawText, participantNames: [] }));
    const action = parsed.action;
    if (parsed.interceptor) {
      addParticipant(participants, parsed.interceptor, "interceptor", "main", action.rawText, defense);
      events.push({ type: "interception", actor: parsed.interceptor, teamId: defense, location: action.endPosition, rawText: action.rawText });
      candidates.push({ sourceStart: parsed.end, sourceEnd: parsed.end, type: "possession-change", phase, ruling: rulingFor(parsed.start, reviewResultIndex, reversed), rawText: "", participantNames: [parsed.interceptor], location: action.endPosition, teamId: defense, result: "interception" });
    } else if (["punt", "kickoff"].includes(action.type)) {
      candidates.push({ sourceStart: parsed.end, sourceEnd: parsed.end, type: "possession-change", phase, ruling: rulingFor(parsed.start, reviewResultIndex, reversed), rawText: "", location: action.endPosition, teamId: defense, result: action.type });
    }
  });
  for (const match of normalized.matchAll(new RegExp(`\\bis BLOCKED \\((${PLAYER_SOURCE})\\)`, "gi"))) {
    const start = match.index ?? 0;
    addParticipant(participants, match[1], "blocker", "parenthetical", match[0], defense);
    candidates.push({ sourceStart: start, sourceEnd: start + match[0].length, type: "block", phase: "scrimmage", ruling: rulingFor(start, reviewResultIndex, reversed), rawText: match[0], participantNames: [match[1]], teamId: defense, result: normalized.slice(Math.max(0, start - 24), start).match(/field goal/i) ? "field-goal" : "kick" });
    events.push({ type: "block", actor: match[1], teamId: defense, result: normalized.slice(Math.max(0, start - 24), start).match(/field goal/i) ? "field-goal" : "kick", rawText: match[0] });
  }
  for (const match of normalized.matchAll(/\bTOUCHDOWN(?! NULLIFIED)/gi)) { const start = match.index ?? 0, nearest = [...parsedActions].reverse().find((item) => item.start <= start); candidates.push({ sourceStart: start, sourceEnd: start + match[0].length, type: "touchdown", phase: nearest ? phaseForAction(nearest.action) : "scrimmage", ruling: rulingFor(start, reviewResultIndex, reversed), rawText: match[0] }); events.push({ type: "touchdown", actor: nearest?.action.target ?? nearest?.action.actor, teamId: possession, rawText: match[0] }); }
  for (const match of normalized.matchAll(new RegExp(`FUMBLES(?: \\((?:${PLAYER_SOURCE}|Aborted)\\))?`, "gi"))) { const start = match.index ?? 0, nearest = [...parsedActions].reverse().find((item) => item.start <= start); candidates.push({ sourceStart: start, sourceEnd: start + match[0].length, type: "fumble", phase: "scrimmage", ruling: rulingFor(start, reviewResultIndex, reversed), rawText: match[0] }); events.push({ type: "fumble", actor: nearest?.action.actor ?? nearest?.action.target, teamId: possession, rawText: match[0] }); }
  for (const match of normalized.matchAll(new RegExp(`(?:RECOVERED|recovered) by ([A-Z]{2,3})-\\s*(${PLAYER_SOURCE}) at (${POSITION_SOURCE})`, "g"))) {
    const start = match.index ?? 0, end = start + match[0].length, recoveryTeam = teamId(match[1].toUpperCase(), teams);
    addParticipant(participants, match[2], "recovery", "annotation", match[0], recoveryTeam);
    candidates.push({ sourceStart: start, sourceEnd: end, type: "recovery", phase: "scrimmage", ruling: rulingFor(start, reviewResultIndex, reversed), rawText: match[0], participantNames: [match[2]], location: match[3], teamId: recoveryTeam });
    events.push({ type: "recovery", actor: match[2], teamId: recoveryTeam, location: match[3], rawText: match[0] });
    if (recoveryTeam && recoveryTeam !== possession) {
      candidates.push({ sourceStart: end, sourceEnd: end, type: "possession-change", phase: "scrimmage", ruling: rulingFor(start, reviewResultIndex, reversed), rawText: "", participantNames: [match[2]], location: match[3], teamId: recoveryTeam, result: "recovery" });
      events.push({ type: "possession-change", actor: match[2], teamId: recoveryTeam, location: match[3], result: "recovery", rawText: match[0] });
    }
  }
  for (const match of normalized.matchAll(/\b([A-Z][A-Za-z]+) challenged the (.+?) ruling/gi)) { const review: PlayReviewDetails = { source: "team-challenge", teamId: teamFromName(match[1], teams), subject: match[2], rawText: match[0] }; reviews.push(review); candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "review", phase: "administrative", ruling: "official", rawText: match[0], review }); }
  for (const match of normalized.matchAll(/The Replay Official reviewed the (.+?) ruling/gi)) { const review: PlayReviewDetails = { source: "replay-official", subject: match[1], rawText: match[0] }; reviews.push(review); candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "review", phase: "administrative", ruling: "official", rawText: match[0], review }); }
  for (const match of reviewResultMatches) { const result = match[1].toLowerCase() === "reversed" ? "reversed" : match[1].toLowerCase() === "upheld" ? "upheld" : "confirmed", review = reviews.at(-1); if (review) review.result = result; candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "review-result", phase: "administrative", ruling: "official", rawText: match[0], review, result }); events.push({ type: "replay", result, rawText: match[0] }); }
  for (const match of normalized.matchAll(/The ruling on the field stands\.?/gi)) { const review = reviews.at(-1); if (review) review.ruling = "stands"; candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "review-result", phase: "administrative", ruling: "official", rawText: match[0], review, result: "stands" }); }
  for (const match of normalized.matchAll(/\(?Timeout #?(\d+)?(?: by ([A-Z]{2,3}))?\.?\)?/gi)) { const priorReview = [...reviews].reverse().find((review) => normalized.indexOf(review.rawText) < (match.index ?? 0)); if (priorReview && match[1]) priorReview.timeoutNumber = Number(match[1]); candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "timeout", phase: "administrative", ruling: "official", rawText: match[0], result: match[2] }); }
  for (const match of normalized.matchAll(/\b10-second runoff\.?/gi)) candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "administrative", phase: "administrative", ruling: "official", rawText: match[0], result: "10-second runoff" });
  for (const match of normalized.matchAll(new RegExp(`Incomplete Pass by (?:\\d+-)?(${PLAYER_SOURCE}) after Blocked Kick Recovery\\.?`, "gi"))) candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "administrative", phase: "administrative", ruling: "official", rawText: match[0], participantNames: [match[1]], result: "blocked-kick-incomplete-pass" });
  for (const match of normalized.matchAll(/\*\* Injury Update:\s*([A-Z]{2,3})-((?:[A-Z]\.){1,2}[A-Z][A-Za-z'-]*)\s+(.+?)(?=(?:\s+(?:PENALTY|Penalty) on\b)|(?:\s+\b(?:P|R|X)\d+\b)|$)/gi)) { const rawText = match[0].trim(), player = match[2], injury: PlayInjuryUpdate = { teamId: teamId(match[1].toUpperCase(), teams), player, status: match[3].replace(/[.]$/, "").trim(), rawText }; injuryUpdates.push(injury); addParticipant(participants, player, "other", "annotation", rawText, injury.teamId); annotations.push({ kind: "injury", rawText, participantNames: [player] }); candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "injury-update", phase: "administrative", ruling: "official", rawText, injury }); events.push({ type: "injury", actor: player, teamId: injury.teamId, result: injury.status, rawText }); }
  const penaltyMatches = penaltyOccurrences(normalized, teams), penalties: PlayPenalty[] = [], keyToIndex = new Map<string, number>();
  for (const occurrence of penaltyMatches) {
    const precedingAction = [...parsedActions].reverse().find((item) => item.start <= occurrence.start);
    occurrence.penalty.phase = /kickoff/i.test(occurrence.penalty.type) ? "kickoff" : precedingAction ? phaseForAction(precedingAction.action) : "scrimmage";
    const key = penaltyKey(occurrence.penalty), existingIndex = keyToIndex.get(key);
    const crossesReview = existingIndex !== undefined && Number.isFinite(reviewResultIndex) && (penalties[existingIndex].occurrences?.[0].sourceStart ?? Infinity) < reviewResultIndex && occurrence.start > reviewResultIndex;
    let penaltyIndex: number, repeatedAfterReview = false;
    if (existingIndex !== undefined && crossesReview) { penaltyIndex = existingIndex; repeatedAfterReview = true; penalties[penaltyIndex].repeatedAfterReview = true; penalties[penaltyIndex].occurrences!.push({ rawText: occurrence.penalty.rawText, sourceStart: occurrence.start, ruling: "final" }); }
    else { penaltyIndex = penalties.length; occurrence.penalty.occurrences = [{ rawText: occurrence.penalty.rawText, sourceStart: occurrence.start, ruling: rulingFor(occurrence.start, reviewResultIndex, reversed) }]; penalties.push(occurrence.penalty); if (existingIndex === undefined) keyToIndex.set(key, penaltyIndex); }
    candidates.push({ sourceStart: occurrence.start, sourceEnd: occurrence.end, type: "penalty", phase: occurrence.penalty.phase, ruling: rulingFor(occurrence.start, reviewResultIndex, reversed), rawText: occurrence.penalty.rawText, penaltyIndex, result: repeatedAfterReview ? "restated-after-review" : undefined });
  }
  penalties.forEach((penalty) => addParticipant(participants, penalty.playerName, "penalized", "penalty", penalty.rawText, penalty.teamId));
  for (const match of normalized.matchAll(/\(([^)]+)\)/g)) {
    const start = match.index ?? 0; if (parseFormation(match[1]).length || /^Timeout/i.test(match[1]) || /^Aborted$/i.test(match[1]) || /is BLOCKED\s*$/i.test(normalized.slice(Math.max(0, start - 16), start))) continue;
    const names = playerNames(match[1]); if (!names.length) continue;
    const previousAction = [...parsedActions].reverse().find((item) => item.start < start), prefix = normalized.slice(Math.max(0, start - 18), start), forced = /FUMBLES?\s*$/i.test(prefix), sack = previousAction?.action.type === "sack", incomplete = previousAction?.action.outcome === "incomplete";
    const role: PlayParticipantRole = forced ? "forced-fumble" : sack ? "sacker" : incomplete ? "defender" : "tackler", kind: PlayAnnotation["kind"] = forced ? "fumble" : incomplete ? "defensive-involvement" : "tacklers";
    names.forEach((name) => addParticipant(participants, name, role, "parenthetical", match[0], defense)); annotations.push({ kind, rawText: match[0], participantNames: names }); candidates.push({ sourceStart: start, sourceEnd: start + match[0].length, type: "defense", phase: previousAction ? phaseForAction(previousAction.action) : "scrimmage", ruling: rulingFor(start, reviewResultIndex, reversed), rawText: match[0], participantNames: names, result: role });
  }
  for (const match of normalized.matchAll(/\[([^\]]+)\]/g)) { const names = playerNames(match[1]); names.forEach((name) => addParticipant(participants, name, "qb-hit", "bracket", match[0], defense)); annotations.push({ kind: "qb-hit", rawText: match[0], participantNames: names }); candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "defense", phase: "scrimmage", ruling: rulingFor(match.index ?? 0, reviewResultIndex, reversed), rawText: match[0], participantNames: names, result: "qb-hit" }); }
  for (const match of normalized.matchAll(new RegExp(`Center-(${PLAYER_SOURCE}),\\s*Holder-(${PLAYER_SOURCE})`, "gi"))) { const start = match.index ?? 0, priorAction = [...parsedActions].reverse().find((item) => item.start < start); addParticipant(participants, match[1], "snapper", "annotation", match[0], possession); addParticipant(participants, match[2], "holder", "annotation", match[0], possession); annotations.push({ kind: "kick-crew", rawText: match[0], participantNames: [match[1], match[2]] }); candidates.push({ sourceStart: start, sourceEnd: start + match[0].length, type: "kick-crew", phase: priorAction ? phaseForAction(priorAction.action) : "scrimmage", ruling: "official", rawText: match[0], participantNames: [match[1], match[2]] }); }
  for (const match of normalized.matchAll(new RegExp(`fair catch by (${PLAYER_SOURCE})`, "gi"))) addParticipant(participants, match[1], "returner", "annotation", match[0], defense);
  for (const match of normalized.matchAll(/\b(?:P|R|X)\d+\b/g)) { annotations.push({ kind: "official-marker", rawText: match[0], participantNames: [] }); candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "official-marker", phase: "administrative", ruling: rulingFor(match.index ?? 0, reviewResultIndex, reversed), rawText: match[0] }); }
  for (const match of normalized.matchAll(/\b[A-Z]{2,3} \d+ [A-Z]{2,3} \d+,\s*\d+ plays?,\s*-?\d+ yards?,(?:\s*\d+ penalt(?:y|ies),)?\s*\d+:\d+ drive(?:\s*,\s*\d+:\d+ elapsed)?/gi)) candidates.push({ sourceStart: match.index ?? 0, sourceEnd: (match.index ?? 0) + match[0].length, type: "drive-summary", phase: "try", ruling: "official", rawText: match[0] });
  const controlEvents = candidates.filter((candidate) => candidate.type === "possession-change" && candidate.teamId).sort((a, b) => a.sourceStart - b.sourceStart);
  parsedActions.forEach((parsed) => {
    const priorControl = [...controlEvents].reverse().find((event) => event.sourceStart <= parsed.start);
    const actionTeam = priorControl?.teamId ?? possession;
    parsed.action.teamId = actionTeam;
    if (priorControl?.location && ["advance", "return"].includes(parsed.action.type)) parsed.action.startPosition = priorControl.location;
    if (parsed.action.type === "advance" && actionTeam !== possession) parsed.action.type = "return";
    if (parsed.action.type === "advance" && priorControl?.result === "punt") parsed.action.type = "return";
  });
  parsedActions.forEach(({ action }) => {
    const actionTeam = action.teamId ?? possession;
    if (action.type === "pass") { addParticipant(participants, action.actor, "passer", "main", action.rawText, actionTeam); addParticipant(participants, action.target, action.outcome === "complete" || action.outcome === "touchdown" ? "receiver" : "target", "main", action.rawText, actionTeam); }
    else if (["rush", "scramble", "kneel", "advance"].includes(action.type)) addParticipant(participants, action.actor, "rusher", "main", action.rawText, actionTeam);
    else if (action.type === "return") addParticipant(participants, action.actor, "returner", "main", action.rawText, actionTeam);
    else if (action.type === "sack") addParticipant(participants, action.actor, "passer", "main", action.rawText, actionTeam);
    else if (["field-goal", "extra-point", "kickoff"].includes(action.type)) addParticipant(participants, action.actor, "kicker", "main", action.rawText, actionTeam);
    else if (action.type === "punt") addParticipant(participants, action.actor, "punter", "main", action.rawText, actionTeam);
  });
  events.filter((event) => event.type === "touchdown").forEach((event) => {
    const touchdownIndex = normalized.indexOf(event.rawText);
    event.teamId = [...parsedActions].reverse().find((parsed) => parsed.start <= touchdownIndex)?.action.teamId ?? possession;
  });
  const structured = [...candidates]; for (const gap of rawGaps(normalized, structured)) candidates.push({ sourceStart: gap.start, sourceEnd: gap.end, type: "raw", phase: "administrative", ruling: rulingFor(gap.start, reviewResultIndex, reversed), rawText: gap.text });
  const priorities: Record<PlaySequenceType, number> = { action: 1, touchdown: 2, fumble: 2, recovery: 2, block: 2, "possession-change": 3, defense: 4, penalty: 5, review: 6, "review-result": 7, timeout: 8, "injury-update": 9, scoring: 10, "drive-summary": 11, "official-marker": 12, "kick-crew": 13, administrative: 14, raw: 99 };
  candidates.sort((a, b) => a.sourceStart - b.sourceStart || priorities[a.type] - priorities[b.type] || a.sourceEnd - b.sourceEnd);
  const sequence: PlaySequenceEvent[] = candidates.map((candidate, order) => ({ id: `event-${order + 1}`, order, ...candidate }));
  const officialCandidates = sequence.filter((event) => event.type === "action" && event.ruling !== "provisional" && event.actionIndex !== undefined), officialActionIndex = officialCandidates.at(-1)?.actionIndex ?? (actions.length ? actions.length - 1 : -1);
  const timeout = sequence.find((event) => event.type === "timeout");
  const action = officialActionIndex >= 0 ? actions[officialActionIndex] : { type: penalties.length ? "penalty" : reviews.length ? "replay" : timeout ? "timeout" : "other", actor: timeout?.result, rawText: normalized } satisfies PlayAction;
  const formation = action.formation ?? parsedActions[0]?.formation ?? [], spots: PlaySpot[] = [];
  if (startPosition) spots.push({ kind: "start", position: startPosition, phase: "scrimmage", order: -1, certain: true });
  sequence.forEach((event) => { if (event.type === "action" && event.actionIndex !== undefined) { const currentAction = actions[event.actionIndex], endPosition = currentAction.endPosition; if (endPosition) spots.push({ kind: currentAction.outcome === "interception" ? "interception" : "action-end", position: endPosition, phase: event.phase, order: event.order, certain: true }); } if (event.type === "recovery" && event.location) spots.push({ kind: "recovery", position: event.location, phase: event.phase, order: event.order, certain: true }); });
  penalties.forEach((penalty, index) => { if (penalty.enforcedAt) spots.push({ kind: "enforcement", position: penalty.enforcedAt, phase: penalty.phase ?? "scrimmage", order: sequence.find((event) => event.penaltyIndex === index)?.order ?? 0, certain: true }); });
  const accepted = [...penalties].reverse().find((penalty) => penalty.status === "accepted" && penalty.enforcedAt), lastRecovery = [...events].reverse().find((event) => event.type === "recovery" && event.location), officialAction = officialActionIndex >= 0 ? actions[officialActionIndex] : undefined;
  const officialEndPosition = accepted?.enforcedAt ?? officialAction?.endPosition ?? lastRecovery?.location;
  if (officialEndPosition) spots.push({ kind: "official-final", position: officialEndPosition, phase: accepted?.phase ?? phaseForAction(action), order: sequence.length, certain: true });
  const unparsedText = sequence.filter((event) => event.type === "raw").map((event) => event.rawText), hasStructured = sequence.some((event) => event.type !== "raw" && event.type !== "official-marker");
  return { formation, action, actions, officialActionIndex, participants, penalties, events, sequence, reviews, injuryUpdates, spots, officialEndPosition, annotations, scoring: scoringDetails(normalized), parseStatus: !hasStructured ? "raw" : unparsedText.length ? "partial" : "structured", unparsedText };
}
