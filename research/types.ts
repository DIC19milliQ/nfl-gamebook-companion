export interface ResearchGameIdentity {
  season: number;
  seasonType: "regular" | "postseason";
  week?: number;
  kickoffTime?: string;
  awayTeam: { name: string; code: string };
  homeTeam: { name: string; code: string };
}

export interface NflverseScheduleGame {
  gameId: string;
  season: number;
  gameType: string;
  week?: number;
  gameDay?: string;
  gameTime?: string;
  awayTeam: string;
  homeTeam: string;
}

export interface NflversePlay {
  providerGameId: string;
  providerPlayId: string;
  sourceIndex: number;
  quarter?: number;
  clock?: string;
  possessionTeam?: string;
  down?: number;
  distance?: number;
  yardLine?: string;
  playType?: string;
  description?: string;
  drive?: number;
  epa?: number;
  wp?: number;
  flags: {
    noPlay: boolean;
    penalty: boolean;
    touchdown: boolean;
    interception: boolean;
    fumbleLost: boolean;
    kickoff: boolean;
    punt: boolean;
    fieldGoal: boolean;
    extraPoint: boolean;
    timeout: boolean;
  };
}

export interface GamebookPlayInput {
  id: string;
  sourceIndex: number;
  quarter?: number;
  clock?: string;
  possessionTeam?: string;
  down?: number;
  distance?: number | "Goal";
  yardLine?: string;
  playType?: string;
  description: string;
  driveId?: string;
  noPlay?: boolean;
}

export type EvidenceOutcome = "match" | "partial" | "mismatch" | "missing" | "not-applicable";

export interface CriterionEvidence {
  outcome: EvidenceOutcome;
  weight: number;
  earned: number;
  detail: string;
}

export interface MatchCandidateEvidence {
  externalPlayIds: string[];
  confidence: number;
  descriptionSimilarity: number;
}

export interface MatchEvidence {
  criteria: {
    quarter: CriterionEvidence;
    clock: CriterionEvidence;
    possession: CriterionEvidence;
    down: CriterionEvidence;
    distance: CriterionEvidence;
    yardLine: CriterionEvidence;
    playType: CriterionEvidence;
    description: CriterionEvidence;
    sequence: CriterionEvidence;
  };
  baseConfidence: number;
  marginToNextCandidate?: number;
  alternatives: MatchCandidateEvidence[];
  compositeReasons: string[];
  ambiguityReasons: string[];
}

export interface ExternalPlayRef {
  provider: "nflverse";
  providerGameId: string;
  providerPlayId: string;
}

export interface PlayAlignment {
  gamebookPlayIds: string[];
  externalPlayRefs: ExternalPlayRef[];
  status: "matched" | "ambiguous" | "unmatched";
  relationship: "1:1" | "1:many" | "many:1";
  confidence: number;
  matcherVersion: string;
  evidence: MatchEvidence;
}

export interface AlignmentRun {
  alignments: PlayAlignment[];
  unmatchedExternalPlayIds: string[];
}
