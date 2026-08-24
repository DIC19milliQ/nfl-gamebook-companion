import type {
  AlignmentRun,
  CriterionEvidence,
  GamebookPlayInput,
  MatchEvidence,
  NflversePlay,
  PlayAlignment,
} from "./types";

export const MATCHER_VERSION = "research-0.1.0";
export const MATCHED_CONFIDENCE = 0.75;
const AMBIGUOUS_CONFIDENCE = 0.58;
const AMBIGUOUS_MARGIN = 0.045;

const WEIGHTS = {
  quarter: 0.14,
  clock: 0.14,
  possession: 0.10,
  down: 0.08,
  distance: 0.07,
  yardLine: 0.08,
  playType: 0.10,
  description: 0.24,
  sequence: 0.05,
} as const;

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "center", "for", "from", "holder", "is", "of", "on", "the", "to", "was",
]);

function cleanDescription(value = "") {
  return value
    .toLowerCase()
    .replace(/^\(?\d{0,2}:\d{2}\)?\s*/, "")
    .replace(/\b[a-z]{2,3}-\d{1,2}-/g, "")
    .replace(/\b\d{1,2}-([a-z]\.[a-z'-]+)/g, "$1")
    .replace(/\b[prx]\d+\b/g, "")
    .replace(/\bmid\s+50\b/g, "50")
    .replace(/\b(no huddle|shotgun)\b/g, "")
    .replace(/[^a-z0-9.'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value = "") {
  return cleanDescription(value).split(" ").filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function descriptionSimilarity(left = "", right = "") {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function normalizeYardLine(value?: string) {
  return value?.toUpperCase().replace(/^MID\s+/, "").replace(/\s+/g, " ").trim();
}

function normalizeClock(value?: string) {
  if (!value) return value;
  const [minutes, seconds] = value.split(":");
  return `${Number(minutes)}:${seconds}`;
}

function inferredGamebookType(play: GamebookPlayInput) {
  const text = play.description.toLowerCase();
  if (/kneels?/.test(text)) return "qb_kneel";
  if (/spikes?/.test(text)) return "qb_spike";
  if (/punts?/.test(text)) return "punt";
  if (/field goal/.test(text)) return "field_goal";
  if (/extra point/.test(text) && !/touchdown/.test(text)) return "extra_point";
  if (/pass|sacked|intercepted/.test(text)) return play.noPlay ? "no_play" : "pass";
  if (/left|right|middle|scrambles?|kneels?/.test(text)) return play.noPlay ? "no_play" : "run";
  if (/penalty/.test(text)) return "no_play";
  return play.playType?.replaceAll("-", "_");
}

function typeCompatibility(gamebook: GamebookPlayInput, external: NflversePlay) {
  const expected = inferredGamebookType(gamebook);
  const actual = external.playType;
  if (!expected || !actual) return 0;
  if (expected === actual) return 1;
  if (gamebook.noPlay && actual === "no_play") return 1;
  if (gamebook.playType === "touchdown" && ["run", "pass"].includes(actual)) return 1;
  if (gamebook.playType === "turnover" && ["run", "pass"].includes(actual)) return 0.8;
  if (gamebook.playType === "penalty" && ["run", "pass", "no_play"].includes(actual)) return 0.75;
  return 0;
}

function criterion(weight: number, left: unknown, right: unknown, label: string): CriterionEvidence {
  if (left === undefined || left === null || left === "" || right === undefined || right === null || right === "") {
    return { outcome: "missing", weight, earned: 0, detail: `${label}: missing on one source` };
  }
  const match = left === right;
  return {
    outcome: match ? "match" : "mismatch",
    weight,
    earned: match ? weight : 0,
    detail: `${label}: ${String(left)} ${match ? "=" : "!="} ${String(right)}`,
  };
}

function scoreCandidate(gamebook: GamebookPlayInput, external: NflversePlay): MatchEvidence {
  const quarter = criterion(WEIGHTS.quarter, gamebook.quarter, external.quarter, "quarter");
  const clock = criterion(WEIGHTS.clock, normalizeClock(gamebook.clock), normalizeClock(external.clock), "clock");
  const possession = criterion(WEIGHTS.possession, gamebook.possessionTeam, external.possessionTeam, "possession");
  const down = criterion(WEIGHTS.down, gamebook.down, external.down, "down");
  const gameDistance = gamebook.distance === "Goal" ? external.distance : gamebook.distance;
  const distance = gamebook.distance === "Goal"
    ? { outcome: "partial", weight: WEIGHTS.distance, earned: WEIGHTS.distance * 0.7, detail: "distance: Goal represented numerically by nflverse" } satisfies CriterionEvidence
    : criterion(WEIGHTS.distance, gameDistance, external.distance, "distance");
  const yardLine = criterion(WEIGHTS.yardLine, normalizeYardLine(gamebook.yardLine), normalizeYardLine(external.yardLine), "yardLine");
  const gamebookType = inferredGamebookType(gamebook);
  const typeScore = typeCompatibility(gamebook, external);
  const playType: CriterionEvidence = !gamebookType || !external.playType
    ? { outcome: "missing", weight: WEIGHTS.playType, earned: 0, detail: "playType: missing on one source" }
    : {
      outcome: typeScore === 1 ? "match" : typeScore > 0 ? "partial" : "mismatch",
      weight: WEIGHTS.playType,
      earned: WEIGHTS.playType * typeScore,
      detail: `playType: ${gamebookType} vs ${external.playType}`,
    };
  const similarity = descriptionSimilarity(gamebook.description, external.description);
  const description: CriterionEvidence = {
    outcome: similarity >= 0.72 ? "match" : similarity >= 0.35 ? "partial" : "mismatch",
    weight: WEIGHTS.description,
    earned: WEIGHTS.description * similarity,
    detail: `description Dice similarity: ${similarity.toFixed(3)}`,
  };
  const sequence: CriterionEvidence = {
    outcome: "not-applicable",
    weight: WEIGHTS.sequence,
    earned: 0,
    detail: "sequence evaluated after candidate assignment",
  };
  const criteria = { quarter, clock, possession, down, distance, yardLine, playType, description, sequence };
  const applicable = Object.values(criteria).filter((item) => item.outcome !== "missing" && item.outcome !== "not-applicable");
  const earned = applicable.reduce((sum, item) => sum + item.earned, 0);
  const possible = applicable.reduce((sum, item) => sum + item.weight, 0);
  return {
    criteria,
    baseConfidence: possible ? earned / possible : 0,
    alternatives: [],
    compositeReasons: [],
    ambiguityReasons: [],
  };
}

function candidatePool(gamebook: GamebookPlayInput, external: NflversePlay[]) {
  return external.filter((play) => {
    if (gamebook.quarter !== undefined && play.quarter !== gamebook.quarter) return false;
    const sameClock = Boolean(gamebook.clock && play.clock === gamebook.clock);
    const sameDefined = (left: unknown, right: unknown) => left !== undefined && right !== undefined && left === right;
    const sameState = [
      sameDefined(gamebook.possessionTeam, play.possessionTeam),
      sameDefined(gamebook.down, play.down),
      sameDefined(gamebook.distance, play.distance),
      sameDefined(normalizeYardLine(gamebook.yardLine), normalizeYardLine(play.yardLine)),
    ].filter(Boolean).length;
    return sameClock || sameState >= 3 || descriptionSimilarity(gamebook.description, play.description) >= 0.48;
  });
}

function ref(play: NflversePlay) {
  return { provider: "nflverse" as const, providerGameId: play.providerGameId, providerPlayId: play.providerPlayId };
}

function emptyEvidence(reason: string): MatchEvidence {
  const missing = (weight: number, label: string): CriterionEvidence => ({ outcome: "missing", weight, earned: 0, detail: label });
  return {
    criteria: {
      quarter: missing(WEIGHTS.quarter, reason), clock: missing(WEIGHTS.clock, reason),
      possession: missing(WEIGHTS.possession, reason), down: missing(WEIGHTS.down, reason),
      distance: missing(WEIGHTS.distance, reason), yardLine: missing(WEIGHTS.yardLine, reason),
      playType: missing(WEIGHTS.playType, reason), description: missing(WEIGHTS.description, reason),
      sequence: missing(WEIGHTS.sequence, reason),
    },
    baseConfidence: 0,
    alternatives: [],
    compositeReasons: [],
    ambiguityReasons: [reason],
  };
}

function compositeAttachments(
  gamebook: GamebookPlayInput,
  primary: NflversePlay,
  external: NflversePlay[],
  claimed: Set<string>,
) {
  const attachments: { play: NflversePlay; reason: string }[] = [];
  const text = gamebook.description.toLowerCase();
  const nearby = external.filter((play) =>
    !claimed.has(play.providerPlayId)
    && play.quarter === primary.quarter
    && play.sourceIndex > primary.sourceIndex
    && play.sourceIndex <= primary.sourceIndex + 4,
  );
  for (const play of nearby) {
    const extText = play.description?.toLowerCase() ?? "";
    if (play.flags.extraPoint && /extra point/.test(text)) {
      attachments.push({ play, reason: "Gamebook scoring line contains the following nflverse extra-point row." });
      continue;
    }
    if (
      play.flags.kickoff
      && /touchdown|field goal is good|extra point/.test(text)
      && /penalty on/.test(text)
      && descriptionSimilarity(gamebook.description, play.description) >= 0.22
    ) {
      attachments.push({ play, reason: "Gamebook scoring line contains penalty/injury text from the following nflverse kickoff row." });
      continue;
    }
    if (!play.playType && extText && text.includes(cleanDescription(extText))) {
      attachments.push({ play, reason: "Gamebook play contains an adjacent nflverse administrative row verbatim." });
    }
  }
  return attachments;
}

function applySequenceEvidence(alignments: PlayAlignment[], externalById: Map<string, NflversePlay>) {
  const matched = alignments.filter((alignment) => alignment.externalPlayRefs.length > 0);
  let previousMax = -1;
  for (const alignment of matched) {
    const indices = alignment.externalPlayRefs.map((item) => externalById.get(item.providerPlayId)?.sourceIndex ?? -1);
    const currentMin = Math.min(...indices);
    const currentMax = Math.max(...indices);
    const consistent = currentMin > previousMax;
    const evidence = alignment.evidence.criteria.sequence;
    evidence.outcome = consistent ? "match" : "mismatch";
    evidence.earned = consistent ? evidence.weight : 0;
    evidence.detail = consistent ? "external row order is monotonic with Gamebook order" : "external row order conflicts with Gamebook order";
    const baseWeight = 1 - evidence.weight;
    alignment.confidence = Number(Math.min(1, alignment.evidence.baseConfidence * baseWeight + evidence.earned).toFixed(4));
    if (alignment.status === "ambiguous" && alignment.evidence.ambiguityReasons.length === 0 && alignment.confidence >= MATCHED_CONFIDENCE) {
      alignment.status = "matched";
    }
    previousMax = Math.max(previousMax, currentMax);
  }
}

export function alignPlays(gamebook: GamebookPlayInput[], external: NflversePlay[]): AlignmentRun {
  const claimed = new Set<string>();
  const alignments: PlayAlignment[] = [];
  const prealignedManyToOne = new Map<string, PlayAlignment>();
  const consumedGamebookIds = new Set<string>();

  for (let index = 0; index < gamebook.length - 1; index += 1) {
    const left = gamebook[index];
    const right = gamebook[index + 1];
    if (consumedGamebookIds.has(left.id) || consumedGamebookIds.has(right.id)) continue;
    if (left.quarter !== right.quarter || left.clock !== right.clock) continue;
    const combined: GamebookPlayInput = { ...left, description: `${left.description} ${right.description}` };
    const candidates = candidatePool(combined, external)
      .filter((candidate) => !claimed.has(candidate.providerPlayId))
      .map((candidate) => ({ candidate, evidence: scoreCandidate(combined, candidate) }))
      .filter(({ candidate, evidence }) =>
        evidence.baseConfidence >= MATCHED_CONFIDENCE
        && descriptionSimilarity(combined.description, candidate.description) >= 0.78
        && descriptionSimilarity(left.description, candidate.description) < 0.72
        && descriptionSimilarity(right.description, candidate.description) < 0.72,
      )
      .sort((a, b) => b.evidence.baseConfidence - a.evidence.baseConfidence);
    const best = candidates[0];
    const margin = best && candidates[1] ? best.evidence.baseConfidence - candidates[1].evidence.baseConfidence : 1;
    if (!best || margin < AMBIGUOUS_MARGIN) continue;
    best.evidence.compositeReasons.push("Two consecutive Gamebook rows jointly describe one nflverse row.");
    const alignment: PlayAlignment = {
      gamebookPlayIds: [left.id, right.id], externalPlayRefs: [ref(best.candidate)], status: "matched", relationship: "many:1",
      confidence: Number(best.evidence.baseConfidence.toFixed(4)), matcherVersion: MATCHER_VERSION, evidence: best.evidence,
    };
    prealignedManyToOne.set(left.id, alignment);
    consumedGamebookIds.add(right.id);
    claimed.add(best.candidate.providerPlayId);
  }

  for (const play of gamebook) {
    const prealigned = prealignedManyToOne.get(play.id);
    if (prealigned) {
      alignments.push(prealigned);
      continue;
    }
    if (consumedGamebookIds.has(play.id)) continue;
    const candidates = candidatePool(play, external)
      .filter((candidate) => !claimed.has(candidate.providerPlayId))
      .map((candidate) => ({ candidate, evidence: scoreCandidate(play, candidate) }))
      .sort((a, b) => b.evidence.baseConfidence - a.evidence.baseConfidence);
    const best = candidates[0];
    const second = candidates[1];
    if (!best || best.evidence.baseConfidence < AMBIGUOUS_CONFIDENCE) {
      const evidence = best?.evidence ?? emptyEvidence("No candidate passed the minimum candidate threshold.");
      evidence.alternatives = candidates.slice(0, 3).map(({ candidate, evidence: item }) => ({
        externalPlayIds: [candidate.providerPlayId],
        confidence: item.baseConfidence,
        descriptionSimilarity: descriptionSimilarity(play.description, candidate.description),
      }));
      alignments.push({
        gamebookPlayIds: [play.id], externalPlayRefs: [], status: "unmatched", relationship: "1:1",
        confidence: 0, matcherVersion: MATCHER_VERSION, evidence,
      });
      continue;
    }

    const margin = second ? best.evidence.baseConfidence - second.evidence.baseConfidence : 1;
    best.evidence.marginToNextCandidate = margin;
    best.evidence.alternatives = candidates.slice(1, 4).map(({ candidate, evidence }) => ({
      externalPlayIds: [candidate.providerPlayId],
      confidence: evidence.baseConfidence,
      descriptionSimilarity: descriptionSimilarity(play.description, candidate.description),
    }));
    if (margin < AMBIGUOUS_MARGIN) {
      best.evidence.ambiguityReasons.push(`Top-two candidate margin ${margin.toFixed(3)} is below ${AMBIGUOUS_MARGIN}.`);
      alignments.push({
        gamebookPlayIds: [play.id], externalPlayRefs: [ref(best.candidate)], status: "ambiguous", relationship: "1:1",
        confidence: Number(best.evidence.baseConfidence.toFixed(4)), matcherVersion: MATCHER_VERSION, evidence: best.evidence,
      });
      continue;
    }

    claimed.add(best.candidate.providerPlayId);
    const attachments = compositeAttachments(play, best.candidate, external, claimed);
    for (const attachment of attachments) {
      claimed.add(attachment.play.providerPlayId);
      best.evidence.compositeReasons.push(attachment.reason);
    }
    const refs = [best.candidate, ...attachments.map(({ play: item }) => item)].map(ref);
    alignments.push({
      gamebookPlayIds: [play.id],
      externalPlayRefs: refs,
      status: best.evidence.baseConfidence >= MATCHED_CONFIDENCE ? "matched" : "ambiguous",
      relationship: refs.length > 1 ? "1:many" : "1:1",
      confidence: Number(best.evidence.baseConfidence.toFixed(4)),
      matcherVersion: MATCHER_VERSION,
      evidence: best.evidence,
    });
  }

  // A conservative second pass represents many:1 without stealing an already
  // confident assignment. It is mainly for sources that split a single action
  // across two consecutive Gamebook rows.
  for (let index = 0; index < alignments.length - 1; index += 1) {
    const first = alignments[index];
    const second = alignments[index + 1];
    if (first.status === "matched" || second.status === "matched") continue;
    const left = gamebook.find((play) => play.id === first.gamebookPlayIds[0]);
    const right = gamebook.find((play) => play.id === second.gamebookPlayIds[0]);
    if (!left || !right || right.sourceIndex !== left.sourceIndex + 1) continue;
    const combined: GamebookPlayInput = { ...left, description: `${left.description} ${right.description}` };
    const candidates = candidatePool(combined, external)
      .filter((candidate) => !claimed.has(candidate.providerPlayId))
      .map((candidate) => ({ candidate, evidence: scoreCandidate(combined, candidate) }))
      .sort((a, b) => b.evidence.baseConfidence - a.evidence.baseConfidence);
    const best = candidates[0];
    const margin = best && candidates[1] ? best.evidence.baseConfidence - candidates[1].evidence.baseConfidence : 1;
    if (!best || best.evidence.baseConfidence < MATCHED_CONFIDENCE || margin < AMBIGUOUS_MARGIN) continue;
    claimed.add(best.candidate.providerPlayId);
    best.evidence.compositeReasons.push("Two consecutive Gamebook rows jointly describe one nflverse row.");
    alignments.splice(index, 2, {
      gamebookPlayIds: [left.id, right.id], externalPlayRefs: [ref(best.candidate)], status: "matched", relationship: "many:1",
      confidence: Number(best.evidence.baseConfidence.toFixed(4)), matcherVersion: MATCHER_VERSION, evidence: best.evidence,
    });
  }

  const externalById = new Map(external.map((play) => [play.providerPlayId, play]));
  applySequenceEvidence(alignments, externalById);
  return {
    alignments,
    unmatchedExternalPlayIds: external.filter((play) => !claimed.has(play.providerPlayId)).map((play) => play.providerPlayId),
  };
}
