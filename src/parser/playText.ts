import type {
  PlayAction,
  PlayAnnotation,
  PlayDetails,
  PlayEvent,
  PlayParticipant,
  PlayParticipantRole,
  PlayPenalty,
  PlayScoringDetails,
  Team,
  TeamId,
} from "../types";

const PLAYER_SOURCE = "[A-Z][a-z]?\\.[A-Z][A-Za-z'-]*";
const PLAYER_RE = new RegExp(`\\b${PLAYER_SOURCE}`, "g");
const POSITION_SOURCE = "(?:[A-Z]{2,3} \\d+|50)";
const DIRECTIONS = "left end|left tackle|left guard|up the middle|right guard|right tackle|right end";
const FORMATIONS = /^(Shotgun|No Huddle|Run formation|Punt formation|Field Goal formation)$/i;

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function playerNames(text: string) {
  return unique(text.match(PLAYER_RE) ?? []);
}

function teamId(code: string | undefined, teams: [Team, Team]) {
  return teams.find((team) => team.id === code)?.id;
}

function opposingTeam(possession: TeamId, teams: [Team, Team]) {
  return teams.find((team) => team.id !== possession)?.id;
}

function resultFromText(text: string) {
  if (/for no gain/i.test(text)) return { outcome: "no-gain" as const, yards: 0 };
  const match = text.match(/for (-?\d+) yards?/i);
  if (!match) return {};
  const yards = Number(match[1]);
  return { outcome: yards < 0 ? "loss" as const : yards === 0 ? "no-gain" as const : "gain" as const, yards };
}

function passDepth(value: string | undefined): "short" | "deep" | undefined {
  return value?.toLowerCase() === "short" ? "short" : value?.toLowerCase() === "deep" ? "deep" : undefined;
}

function addParticipant(list: PlayParticipant[], name: string | undefined, role: PlayParticipantRole, source: PlayParticipant["source"], rawText?: string, participantTeam?: TeamId) {
  if (!name) return;
  if (list.some((participant) => participant.name === name && participant.role === role && participant.source === source)) return;
  list.push({ name, role, source, rawText, teamId: participantTeam });
}

function parsePenaltyMatches(description: string, teams: [Team, Team]) {
  const penalties: PlayPenalty[] = [];
  const pattern = new RegExp(
    `\\bPENALTY on ([A-Z]{2,3})(?:-\\s*(${PLAYER_SOURCE}))?,\\s*([^,.]+?)(?:,\\s*(\\d+) yards?)?(?:,\\s*(enforced at|placed at)\\s*(${POSITION_SOURCE}))?(?:,\\s*(declined|offsetting))?(?:\\s*-\\s*No Play)?(?=\\.|$)`,
    "gi",
  );
  for (const match of description.matchAll(pattern)) {
    const rawText = match[0];
    const disposition = match[7]?.toLowerCase();
    const status = disposition === "declined" ? "declined" : disposition === "offsetting" ? "offsetting" : match[4] || match[5] ? "accepted" : "unknown";
    penalties.push({
      teamId: teamId(match[1].toUpperCase(), teams),
      playerName: match[2],
      type: match[3].trim(),
      yards: match[4] ? Number(match[4]) : undefined,
      enforcement: match[5]?.toLowerCase().startsWith("placed") ? "placed" : match[5] ? "enforced" : undefined,
      enforcedAt: match[6],
      status,
      noPlay: /No Play/i.test(rawText),
      automaticFirstDown: /automatic first down/i.test(rawText),
      rawText,
    });
  }
  return penalties;
}

function parseAction(description: string) {
  const replaySegment = /\bREVERSED\./i.test(description) ? description.slice(description.toUpperCase().lastIndexOf("REVERSED.") + "REVERSED.".length).trim() : description.trim();
  let rest = replaySegment;
  const formation: string[] = [];
  while (rest.startsWith("(")) {
    const match = rest.match(/^\(([^)]+)\)\s*/);
    if (!match || !FORMATIONS.test(match[1])) break;
    formation.push(match[1]);
    rest = rest.slice(match[0].length);
  }

  const passIncomplete = rest.match(new RegExp(`^(${PLAYER_SOURCE}) pass incomplete(?: (short|deep) (left|middle|right))?(?: (?:to|intended for) (${PLAYER_SOURCE}))?`, "i"));
  if (passIncomplete) return { formation, action: { type: "pass", actor: passIncomplete[1], target: passIncomplete[4], depth: passDepth(passIncomplete[2]), direction: passIncomplete[3]?.toLowerCase(), outcome: "incomplete", rawText: passIncomplete[0] } satisfies PlayAction };

  const intercepted = rest.match(new RegExp(`^(${PLAYER_SOURCE}) pass(?: (short|deep) (left|middle|right))?(?: intended for (${PLAYER_SOURCE}) )?INTERCEPTED by (${PLAYER_SOURCE})(?: \\[[^\\]]+\\])? at (${POSITION_SOURCE})`, "i"));
  if (intercepted) return { formation, action: { type: "pass", actor: intercepted[1], target: intercepted[4], depth: passDepth(intercepted[2]), direction: intercepted[3]?.toLowerCase(), outcome: "interception", endPosition: intercepted[6], rawText: intercepted[0] } satisfies PlayAction, interceptor: intercepted[5] };

  const pass = rest.match(new RegExp(`^(${PLAYER_SOURCE}) pass(?: (short|deep) (left|middle|right))? to (${PLAYER_SOURCE})(?: ((?:ran|pushed) ob))?(?: (?:to|at) (${POSITION_SOURCE}))?(?: for (no gain|-?\\d+ yards?))?`, "i"));
  if (pass) {
    const result = resultFromText(pass[0]);
    return { formation, action: { type: "pass", actor: pass[1], target: pass[4], depth: passDepth(pass[2]), direction: pass[3]?.toLowerCase(), outcome: /TOUCHDOWN/i.test(description) ? "touchdown" : "complete", boundary: pass[5] ? "out-of-bounds" : undefined, endPosition: pass[6], yards: result.yards, rawText: pass[0] } satisfies PlayAction };
  }

  const scramble = rest.match(new RegExp(`^(${PLAYER_SOURCE}) scrambles(?: (${DIRECTIONS}))?(?: ((?:ran|pushed) ob))?(?: (?:to|at) (${POSITION_SOURCE}))?(?: for (no gain|-?\\d+ yards?))?`, "i"));
  if (scramble) {
    const result = resultFromText(scramble[0]);
    return { formation, action: { type: "scramble", actor: scramble[1], direction: scramble[2]?.toLowerCase(), outcome: /TOUCHDOWN/i.test(description) ? "touchdown" : result.outcome, boundary: scramble[3] ? "out-of-bounds" : undefined, endPosition: scramble[4], yards: result.yards, rawText: scramble[0] } satisfies PlayAction };
  }

  const rush = rest.match(new RegExp(`^(${PLAYER_SOURCE}) (${DIRECTIONS})(?: ((?:ran|pushed) ob))?(?: (?:to|at) (${POSITION_SOURCE}))?(?: for (no gain|-?\\d+ yards?))?`, "i"));
  if (rush) {
    const result = resultFromText(rush[0]);
    return { formation, action: { type: "rush", actor: rush[1], direction: rush[2].toLowerCase(), outcome: /TOUCHDOWN/i.test(description) ? "touchdown" : result.outcome, boundary: rush[3] ? "out-of-bounds" : undefined, endPosition: rush[4], yards: result.yards, rawText: rush[0] } satisfies PlayAction };
  }

  const kneel = rest.match(new RegExp(`^(${PLAYER_SOURCE}) kneels?(?: to (${POSITION_SOURCE}))?(?: for (no gain|-?\\d+ yards?))?`, "i"));
  if (kneel) { const result = resultFromText(kneel[0]); return { formation, action: { type: "kneel", actor: kneel[1], endPosition: kneel[2], outcome: result.outcome, yards: result.yards, rawText: kneel[0] } satisfies PlayAction }; }
  const spike = rest.match(new RegExp(`^(${PLAYER_SOURCE}) spiked`, "i"));
  if (spike) return { formation, action: { type: "spike", actor: spike[1], outcome: "incomplete", rawText: spike[0] } satisfies PlayAction };
  const sack = rest.match(new RegExp(`^(${PLAYER_SOURCE}) sacked at (${POSITION_SOURCE}) for (-?\\d+) yards?`, "i"));
  if (sack) return { formation, action: { type: "sack", actor: sack[1], outcome: "loss", endPosition: sack[2], yards: Number(sack[3]), rawText: sack[0] } satisfies PlayAction };

  const fieldGoal = rest.match(new RegExp(`^(${PLAYER_SOURCE}) (\\d+) yard field goal is (GOOD|No Good)`, "i"));
  if (fieldGoal) return { formation, action: { type: "field-goal", actor: fieldGoal[1], outcome: fieldGoal[3].toUpperCase() === "GOOD" ? "good" : "no-good", yards: Number(fieldGoal[2]), rawText: fieldGoal[0] } satisfies PlayAction };
  const extraPoint = rest.match(new RegExp(`^(${PLAYER_SOURCE}) extra point is (GOOD|No Good)`, "i"));
  if (extraPoint) return { formation, action: { type: "extra-point", actor: extraPoint[1], outcome: extraPoint[2].toUpperCase() === "GOOD" ? "good" : "no-good", rawText: extraPoint[0] } satisfies PlayAction };
  const punt = rest.match(new RegExp(`^(${PLAYER_SOURCE}) punts (\\d+) yards? to (${POSITION_SOURCE})`, "i"));
  if (punt) return { formation, action: { type: "punt", actor: punt[1], outcome: /fair catch/i.test(description) ? "fair-catch" : undefined, endPosition: punt[3], yards: Number(punt[2]), rawText: punt[0] } satisfies PlayAction };
  const kickoff = rest.match(new RegExp(`^(${PLAYER_SOURCE}) kicks (\\d+) yards? from (${POSITION_SOURCE}) to (${POSITION_SOURCE}|end zone)`, "i"));
  if (kickoff) return { formation, action: { type: "kickoff", actor: kickoff[1], endPosition: kickoff[4], yards: Number(kickoff[2]), rawText: kickoff[0] } satisfies PlayAction };
  const timeout = rest.match(/^Timeout #?(\d+)? by ([A-Z]{2,3})/i);
  if (timeout) return { formation, action: { type: "timeout", actor: timeout[2], rawText: timeout[0] } satisfies PlayAction };
  if (/^Two-Minute Warning/i.test(rest)) return { formation, action: { type: "timeout", rawText: "Two-Minute Warning" } satisfies PlayAction };
  if (/^PENALTY on/i.test(rest)) return { formation, action: { type: "penalty", outcome: /No Play/i.test(description) ? "no-play" : undefined, rawText: rest.match(/^.*?(?=\.|$)/)?.[0] ?? rest } satisfies PlayAction };
  if (/Replay Official|reviewed the/i.test(rest)) return { formation, action: { type: "replay", rawText: rest } satisfies PlayAction };
  return { formation, action: { type: "other", rawText: rest } satisfies PlayAction };
}

function parseScoring(description: string): PlayScoringDetails | undefined {
  const score = description.match(/\b([A-Z]{2,3}) (\d+) ([A-Z]{2,3}) (\d+),\s*(\d+) plays?,\s*(-?\d+) yards?,(?:\s*(\d+) penalties?,)?\s*(\d+:\d+) drive(?:,\s*(\d+:\d+) elapsed)?/i);
  const extra = description.match(new RegExp(`(${PLAYER_SOURCE}) extra point is (GOOD|No Good)`, "i"));
  if (!score && !extra) return undefined;
  const start = Math.min(...[score?.index, extra?.index].filter((value): value is number => value !== undefined));
  return {
    extraPoint: extra ? { kicker: extra[1], result: extra[2].toUpperCase() === "GOOD" ? "good" : "no-good", rawText: extra[0] } : undefined,
    score: score ? { visitor: Number(score[2]), home: Number(score[4]) } : undefined,
    drive: score ? { plays: Number(score[5]), yards: Number(score[6]), penalties: score[7] ? Number(score[7]) : undefined, possessionTime: score[8], elapsed: score[9] } : undefined,
    rawText: description.slice(start),
  };
}

export function parsePlayDetails(description: string, possession: TeamId, teams: [Team, Team]): PlayDetails {
  const normalized = description.replace(/\s+/g, " ").trim();
  const { formation, action, interceptor } = parseAction(normalized);
  const penalties = parsePenaltyMatches(normalized, teams);
  const participants: PlayParticipant[] = [];
  const annotations: PlayAnnotation[] = formation.map((rawText) => ({ kind: "formation", rawText, participantNames: [] }));
  const events: PlayEvent[] = [];
  const defense = opposingTeam(possession, teams);

  if (action.type === "pass") {
    addParticipant(participants, action.actor, "passer", "main", action.rawText, possession);
    addParticipant(participants, action.target, action.outcome === "complete" || action.outcome === "touchdown" ? "receiver" : "target", "main", action.rawText, possession);
  } else if (["rush", "scramble", "kneel"].includes(action.type)) addParticipant(participants, action.actor, "rusher", "main", action.rawText, possession);
  else if (action.type === "sack") addParticipant(participants, action.actor, "passer", "main", action.rawText, possession);
  else if (["field-goal", "extra-point", "kickoff"].includes(action.type)) addParticipant(participants, action.actor, "kicker", "main", action.rawText, possession);
  else if (action.type === "punt") addParticipant(participants, action.actor, "punter", "main", action.rawText, possession);

  if (interceptor) {
    addParticipant(participants, interceptor, "interceptor", "main", action.rawText, defense);
    events.push({ type: "interception", actor: interceptor, teamId: defense, location: action.endPosition, rawText: action.rawText });
  }
  if (/TOUCHDOWN/i.test(normalized) && !/NULLIFIED/i.test(normalized)) events.push({ type: "touchdown", actor: action.target ?? action.actor, teamId: possession, rawText: normalized.match(/[^.]*TOUCHDOWN[^.]*/i)?.[0] ?? "TOUCHDOWN" });

  for (const match of normalized.matchAll(/\(([^)]+)\)/g)) {
    if (FORMATIONS.test(match[1])) continue;
    const names = playerNames(match[1]);
    if (!names.length) { annotations.push({ kind: "unknown", rawText: match[0], participantNames: [] }); continue; }
    const prefix = normalized.slice(Math.max(0, (match.index ?? 0) - 18), match.index);
    const forced = /FUMBLES?\s*$/i.test(prefix);
    const role: PlayParticipantRole = forced ? "forced-fumble" : action.outcome === "incomplete" ? "defender" : "tackler";
    const kind: PlayAnnotation["kind"] = forced ? "fumble" : action.outcome === "incomplete" ? "defensive-involvement" : "tacklers";
    names.forEach((name) => addParticipant(participants, name, role, "parenthetical", match[0], defense));
    annotations.push({ kind, rawText: match[0], participantNames: names });
  }
  for (const match of normalized.matchAll(/\[([^\]]+)\]/g)) {
    const names = playerNames(match[1]);
    names.forEach((name) => addParticipant(participants, name, "qb-hit", "bracket", match[0], defense));
    annotations.push({ kind: "qb-hit", rawText: match[0], participantNames: names });
  }

  for (const penalty of penalties) addParticipant(participants, penalty.playerName, "penalized", "penalty", penalty.rawText, penalty.teamId);
  for (const match of normalized.matchAll(new RegExp(`Center-(${PLAYER_SOURCE})`, "gi"))) addParticipant(participants, match[1], "snapper", "annotation", match[0], possession);
  for (const match of normalized.matchAll(new RegExp(`Holder-(${PLAYER_SOURCE})`, "gi"))) addParticipant(participants, match[1], "holder", "annotation", match[0], possession);
  for (const match of normalized.matchAll(new RegExp(`fair catch by (${PLAYER_SOURCE})`, "gi"))) addParticipant(participants, match[1], "returner", "annotation", match[0], defense);

  for (const match of normalized.matchAll(new RegExp(`FUMBLES(?: \\((?:${PLAYER_SOURCE})\\))?`, "gi"))) events.push({ type: "fumble", actor: action.actor ?? action.target, teamId: possession, rawText: match[0] });
  for (const match of normalized.matchAll(new RegExp(`RECOVERED by ([A-Z]{2,3})-\\s*(${PLAYER_SOURCE}) at (${POSITION_SOURCE})`, "gi"))) {
    const recoveryTeam = teamId(match[1].toUpperCase(), teams);
    addParticipant(participants, match[2], "recovery", "annotation", match[0], recoveryTeam);
    events.push({ type: "recovery", actor: match[2], teamId: recoveryTeam, location: match[3], rawText: match[0] });
  }
  const replay = normalized.match(/The Replay Official[^]*?(?:REVERSED|upheld|confirmed)\.?/i);
  if (replay) { annotations.push({ kind: "replay", rawText: replay[0], participantNames: [] }); events.push({ type: "replay", result: /REVERSED/i.test(replay[0]) ? "reversed" : /upheld/i.test(replay[0]) ? "upheld" : "confirmed", rawText: replay[0] }); }
  for (const match of normalized.matchAll(/\b(?:P|R|X)\d+\b/g)) annotations.push({ kind: "official-marker", rawText: match[0], participantNames: [] });
  const injury = normalized.match(/[^.]*injur[^.]*/i);
  if (injury) { annotations.push({ kind: "injury", rawText: injury[0], participantNames: playerNames(injury[0]) }); events.push({ type: "injury", actor: playerNames(injury[0])[0], rawText: injury[0] }); }

  return {
    formation,
    action,
    participants,
    penalties,
    events,
    annotations,
    scoring: parseScoring(normalized),
    parseStatus: action.type === "other" ? "raw" : replay ? "partial" : "structured",
    unparsedText: action.type === "other" ? [normalized] : [],
  };
}
