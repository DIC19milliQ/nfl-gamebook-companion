import { MATCHED_CONFIDENCE, MATCHER_VERSION } from "./matcher";
import type { AlignmentRun, GamebookPlayInput, NflversePlay } from "./types";

export interface AlignmentCounts {
  oneToOne: number;
  oneToMany: number;
  manyToOne: number;
  ambiguous: number;
  unmatchedGamebook: number;
  unmatchedNflverse: number;
}

export interface ConfidenceSummary {
  minimum: number | null;
  median: number | null;
  bins: Record<string, number>;
}

export interface GameEvaluationSummary {
  gameId: string;
  matcherVersion: string;
  gamebookPlays: number;
  nflverseRows: number;
  counts: AlignmentCounts;
  highConfidence: { numerator: number; denominator: number; rate: number };
  externalReference: { numerator: number; denominator: number; rate: number };
  confidence: ConfidenceSummary;
}

export interface BatchSuccess<T> { ok: true; id: string; value: T }
export interface BatchFailure { ok: false; id: string; error: string }
export type BatchOutcome<T> = BatchSuccess<T> | BatchFailure;

export async function runIndependentBatch<TInput extends { id: string }, TOutput>(
  inputs: TInput[],
  runOne: (input: TInput) => Promise<TOutput>,
): Promise<BatchOutcome<TOutput>[]> {
  const outcomes: BatchOutcome<TOutput>[] = [];
  for (const input of inputs) {
    try {
      outcomes.push({ ok: true, id: input.id, value: await runOne(input) });
    } catch (error) {
      outcomes.push({ ok: false, id: input.id, error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
  }
  return outcomes;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeGame(gameId: string, gamebook: GamebookPlayInput[], external: NflversePlay[], run: AlignmentRun): GameEvaluationSummary {
  const matched = run.alignments.filter((item) => item.status === "matched");
  const confidences = matched.map((item) => item.confidence);
  const referenced = new Set(run.alignments.flatMap((item) => item.externalPlayRefs.map((ref) => ref.providerPlayId)));
  const highConfidenceCount = matched.reduce((sum, item) => sum + (item.confidence >= MATCHED_CONFIDENCE ? item.gamebookPlayIds.length : 0), 0);
  return {
    gameId,
    matcherVersion: MATCHER_VERSION,
    gamebookPlays: gamebook.length,
    nflverseRows: external.length,
    counts: {
      oneToOne: matched.filter((item) => item.relationship === "1:1").length,
      oneToMany: matched.filter((item) => item.relationship === "1:many").length,
      manyToOne: matched.filter((item) => item.relationship === "many:1").length,
      ambiguous: run.alignments.reduce((sum, item) => sum + (item.status === "ambiguous" ? item.gamebookPlayIds.length : 0), 0),
      unmatchedGamebook: run.alignments.reduce((sum, item) => sum + (item.status === "unmatched" ? item.gamebookPlayIds.length : 0), 0),
      unmatchedNflverse: run.unmatchedExternalPlayIds.length,
    },
    highConfidence: { numerator: highConfidenceCount, denominator: gamebook.length, rate: gamebook.length ? highConfidenceCount / gamebook.length : 0 },
    externalReference: { numerator: referenced.size, denominator: external.length, rate: external.length ? referenced.size / external.length : 0 },
    confidence: {
      minimum: confidences.length ? Math.min(...confidences) : null,
      median: median(confidences),
      bins: {
        "0.95-1.00": confidences.filter((value) => value >= 0.95).length,
        "0.90-0.95": confidences.filter((value) => value >= 0.90 && value < 0.95).length,
        "0.85-0.90": confidences.filter((value) => value >= 0.85 && value < 0.90).length,
        "0.80-0.85": confidences.filter((value) => value >= 0.80 && value < 0.85).length,
        "0.75-0.80": confidences.filter((value) => value >= 0.75 && value < 0.80).length,
      },
    },
  };
}

export function aggregateSummaries(games: GameEvaluationSummary[]) {
  if (games.some((game) => game.matcherVersion !== MATCHER_VERSION)) throw new Error("Batch contains a matcher version other than research-0.1.0.");
  const total = games.reduce((acc, game) => {
    acc.gamebookPlays += game.gamebookPlays;
    acc.nflverseRows += game.nflverseRows;
    acc.highConfidence += game.highConfidence.numerator;
    acc.referencedRows += game.externalReference.numerator;
    acc.ambiguous += game.counts.ambiguous;
    acc.unmatchedGamebook += game.counts.unmatchedGamebook;
    for (const [bin, count] of Object.entries(game.confidence.bins)) acc.bins[bin] = (acc.bins[bin] ?? 0) + count;
    return acc;
  }, { gamebookPlays: 0, nflverseRows: 0, highConfidence: 0, referencedRows: 0, ambiguous: 0, unmatchedGamebook: 0, bins: {} as Record<string, number> });
  return {
    matcherVersion: MATCHER_VERSION,
    games: games.length,
    totals: total,
    coverage: total.gamebookPlays ? total.highConfidence / total.gamebookPlays : 0,
    ambiguousRate: total.gamebookPlays ? total.ambiguous / total.gamebookPlays : 0,
    unmatchedGamebookRate: total.gamebookPlays ? total.unmatchedGamebook / total.gamebookPlays : 0,
    externalReferenceRate: total.nflverseRows ? total.referencedRows / total.nflverseRows : 0,
  };
}
