import type { Play } from "../../types";
import { alignPlays, MATCHED_CONFIDENCE } from "./matcher";
import type { AlignmentRun, GamebookPlayInput, NflversePlay, PlayAlignment } from "./types";

export interface PlayAnalytics {
  epa: number;
  providerGameId: string;
  providerPlayId: string;
  matcherVersion: string;
  confidence: number;
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
    if (!primary || typeof primary.epa !== "number" || !Number.isFinite(primary.epa)) continue;
    for (const gamebookPlayId of alignment.gamebookPlayIds) {
      byPlayId.set(gamebookPlayId, {
        epa: primary.epa,
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
