import type { Play } from "../../types";
import { alignPlays, MATCHED_CONFIDENCE } from "./matcher";
import type { AlignmentRun, GamebookPlayInput, NflversePlay, PlayAlignment } from "./types";

export interface PlayAnalytics {
  epa?: number;
  airYards?: number;
  yardsAfterCatch?: number;
  completePass: boolean;
  homeWinProbability?: number;
  awayWinProbability?: number;
  winProbabilityChangeSide?: "home" | "away";
  winProbabilityAddedPoints?: number;
  providerGameId: string;
  providerPlayId: string;
  matcherVersion: string;
  confidence: number;
}

const WP_TOLERANCE = 0.002;
const WP_CHAIN_TOLERANCE = 0.005;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function probabilityPair(left: unknown, right: unknown) {
  return finite(left) && finite(right) && left >= 0 && left <= 1 && right >= 0 && right <= 1
    && Math.abs(1 - left - right) <= WP_TOLERANCE;
}

function preProbability(play: NflversePlay) {
  return probabilityPair(play.homeWp, play.awayWp);
}

function postProbability(play: NflversePlay) {
  return probabilityPair(play.homeWpPost, play.awayWpPost);
}

function sourceWpaMatches(play: NflversePlay) {
  if (!preProbability(play) || !postProbability(play) || !finite(play.wpa)) return false;
  const homeChange = play.homeWpPost! - play.homeWp!;
  const awayChange = play.awayWpPost! - play.awayWp!;
  return Math.abs(play.wpa - homeChange) <= WP_TOLERANCE || Math.abs(play.wpa - awayChange) <= WP_TOLERANCE;
}

export interface AnalyticsSidecar {
  byPlayId: Map<string, PlayAnalytics>;
  alignment: AlignmentRun;
}

export function toGamebookInputs(plays: Play[]): GamebookPlayInput[] {
  return plays.map((play) => ({
    id: play.id,
    sourceIndex: play.index,
    quarter: play.quarter,
    clock: play.clock,
    possessionTeam: play.possession,
    down: play.down,
    distance: play.distance,
    yardLine: play.yardLine,
    playType: play.kind,
    description: play.description,
    driveId: play.driveId,
    noPlay: play.noPlay,
  }));
}

export function selectPlayAnalytics(alignments: PlayAlignment[], external: NflversePlay[]) {
  const byExternalId = new Map(external.map((play) => [play.providerPlayId, play]));
  const byPlayId = new Map<string, PlayAnalytics>();
  for (const alignment of alignments) {
    if (alignment.status !== "matched" || alignment.confidence < MATCHED_CONFIDENCE || alignment.relationship === "many:1") continue;
    const primaryRef = alignment.externalPlayRefs[0];
    const primary = primaryRef ? byExternalId.get(primaryRef.providerPlayId) : undefined;
    if (!primary) continue;
    const rows = alignment.externalPlayRefs.map((ref) => byExternalId.get(ref.providerPlayId)).filter((play): play is NflversePlay => Boolean(play)).sort((left, right) => left.sourceIndex - right.sourceIndex);
    const allRowsPresent = rows.length === alignment.externalPlayRefs.length;
    const probabilityChainConsistent = allRowsPresent && rows.every((row) => preProbability(row) && postProbability(row))
      && rows.slice(1).every((row, index) => {
        const previous = rows[index];
        return Math.abs(previous.homeWpPost! - row.homeWp!) <= WP_CHAIN_TOLERANCE
          && Math.abs(previous.awayWpPost! - row.awayWp!) <= WP_CHAIN_TOLERANCE;
      });
    // A composite may include administrative attachments (for example a weather
    // suspension) whose model state is not a trustworthy end-of-Gamebook-play WP.
    // Use the last row only when the whole mapped chain is complete; otherwise the
    // primary football row is the conservative, semantically bounded fallback.
    const currentWp = alignment.relationship === "1:many" && !probabilityChainConsistent
      ? (postProbability(primary) ? primary : undefined)
      : [...rows].reverse().find(postProbability);
    const firstWp = rows.find(preProbability);
    const cleanPass = primary.playType === "pass" && primary.flags.passAttempt === true && !primary.flags.noPlay && !primary.flags.penalty;
    const epa = finite(primary.epa) ? primary.epa : undefined;
    const airYards = cleanPass && finite(primary.airYards) ? primary.airYards : undefined;
    const yardsAfterCatch = cleanPass && primary.flags.completePass === true && finite(primary.yardsAfterCatch) ? primary.yardsAfterCatch : undefined;

    let winProbabilityChangeSide: "home" | "away" | undefined;
    let winProbabilityAddedPoints: number | undefined;
    if (firstWp && currentWp && probabilityChainConsistent && rows.every(sourceWpaMatches)) {
      const homeChange = currentWp.homeWpPost! - firstWp.homeWp!;
      const awayChange = currentWp.awayWpPost! - firstWp.awayWp!;
      if (Math.abs(homeChange + awayChange) <= WP_TOLERANCE) {
        if (Math.max(Math.abs(homeChange), Math.abs(awayChange)) < 0.0005) {
          winProbabilityAddedPoints = 0;
        } else {
          winProbabilityChangeSide = homeChange > awayChange ? "home" : "away";
          winProbabilityAddedPoints = Math.max(homeChange, awayChange) * 100;
        }
      }
    }
    if (epa === undefined && airYards === undefined && yardsAfterCatch === undefined && !currentWp) continue;
    for (const gamebookPlayId of alignment.gamebookPlayIds) {
      byPlayId.set(gamebookPlayId, {
        epa,
        airYards,
        yardsAfterCatch,
        completePass: cleanPass && primary.flags.completePass === true,
        homeWinProbability: currentWp?.homeWpPost,
        awayWinProbability: currentWp?.awayWpPost,
        winProbabilityChangeSide,
        winProbabilityAddedPoints,
        providerGameId: primary.providerGameId,
        providerPlayId: primary.providerPlayId,
        matcherVersion: alignment.matcherVersion,
        confidence: alignment.confidence,
      });
    }
  }
  return byPlayId;
}

export function buildAnalyticsSidecar(gamebook: Play[], external: NflversePlay[]): AnalyticsSidecar {
  const alignment = alignPlays(toGamebookInputs(gamebook), external);
  return { byPlayId: selectPlayAnalytics(alignment.alignments, external), alignment };
}
