export type TeamId = "IND" | "NE" | string;

export interface PositionedText {
  text: string;
  x: number;
  y: number;
  width: number;
}

export interface PdfLine {
  page: number;
  y: number;
  text: string;
  items: PositionedText[];
}

export interface RawPage {
  page: number;
  width: number;
  height: number;
  text: string;
  lines: PdfLine[];
}

export interface Team {
  id: TeamId;
  name: string;
  shortName: string;
  homeAway: "visitor" | "home";
  score: number;
  color: string;
}

export interface ScoringPlay {
  id: string;
  teamId: TeamId;
  quarter: number;
  clock: string;
  description: string;
  visitorScore: number;
  homeScore: number;
  playIndex: number;
}

export type PlayActionType =
  | "pass"
  | "rush"
  | "advance"
  | "return"
  | "scramble"
  | "sack"
  | "kneel"
  | "spike"
  | "punt"
  | "kickoff"
  | "field-goal"
  | "extra-point"
  | "timeout"
  | "penalty"
  | "replay"
  | "other";

export type PlayParticipantRole =
  | "passer"
  | "target"
  | "receiver"
  | "rusher"
  | "tackler"
  | "defender"
  | "qb-hit"
  | "sacker"
  | "interceptor"
  | "forced-fumble"
  | "recovery"
  | "blocker"
  | "kicker"
  | "punter"
  | "returner"
  | "holder"
  | "snapper"
  | "penalized"
  | "other";

export interface PlayParticipant {
  name: string;
  role: PlayParticipantRole;
  teamId?: TeamId;
  playerId?: string;
  source: "main" | "parenthetical" | "bracket" | "penalty" | "annotation";
  rawText?: string;
}

export interface PlayPenalty {
  teamId?: TeamId;
  playerName?: string;
  type: string;
  yards?: number;
  enforcement?: "enforced" | "placed" | "between-downs";
  enforcedAt?: string;
  status: "accepted" | "declined" | "offsetting" | "unknown";
  noPlay: boolean;
  automaticFirstDown: boolean;
  rawText: string;
  phase?: PlayPhase;
  occurrences?: { rawText: string; sourceStart: number; ruling: PlayRuling }[];
  repeatedAfterReview?: boolean;
}

export interface PlayAnnotation {
  kind: "formation" | "tacklers" | "defensive-involvement" | "qb-hit" | "fumble" | "replay" | "injury" | "official-marker" | "kick-crew" | "unknown";
  rawText: string;
  participantNames: string[];
}

export interface PlayAction {
  type: PlayActionType;
  actor?: string;
  target?: string;
  direction?: string;
  depth?: "short" | "deep";
  outcome?: "complete" | "incomplete" | "gain" | "loss" | "no-gain" | "touchdown" | "interception" | "fumble" | "good" | "no-good" | "blocked" | "fair-catch" | "out-of-bounds" | "no-play";
  boundary?: "out-of-bounds";
  teamId?: TeamId;
  startPosition?: string;
  endPosition?: string;
  yards?: number;
  rawText: string;
  formation?: string[];
}

export type PlayPhase = "scrimmage" | "try" | "kickoff" | "administrative";
export type PlayRuling = "provisional" | "final" | "official";

export interface PlayReviewDetails {
  source: "team-challenge" | "replay-official";
  teamId?: TeamId;
  subject?: string;
  result?: "upheld" | "reversed" | "confirmed";
  ruling?: "stands" | "changed";
  timeoutNumber?: number;
  rawText: string;
}

export interface PlayInjuryUpdate {
  teamId?: TeamId;
  player?: string;
  status: string;
  rawText: string;
}

export interface PlaySpot {
  kind: "start" | "action-end" | "interception" | "fumble" | "recovery" | "enforcement" | "official-final";
  position: string;
  phase: PlayPhase;
  order: number;
  certain: boolean;
}

export type PlaySequenceType =
  | "action"
  | "defense"
  | "fumble"
  | "recovery"
  | "block"
  | "possession-change"
  | "penalty"
  | "touchdown"
  | "review"
  | "review-result"
  | "timeout"
  | "injury-update"
  | "scoring"
  | "drive-summary"
  | "official-marker"
  | "kick-crew"
  | "administrative"
  | "raw";

export interface PlaySequenceEvent {
  id: string;
  order: number;
  sourceStart: number;
  sourceEnd: number;
  type: PlaySequenceType;
  phase: PlayPhase;
  ruling: PlayRuling;
  rawText: string;
  actionIndex?: number;
  penaltyIndex?: number;
  review?: PlayReviewDetails;
  injury?: PlayInjuryUpdate;
  participantNames?: string[];
  teamId?: TeamId;
  location?: string;
  result?: string;
}

export interface PlayEvent {
  type: "fumble" | "recovery" | "interception" | "block" | "possession-change" | "touchdown" | "first-down" | "replay" | "injury";
  actor?: string;
  teamId?: TeamId;
  location?: string;
  result?: string;
  rawText: string;
}

export interface PlayScoringDetails {
  extraPoint?: { kicker: string; result: "good" | "no-good"; rawText: string };
  score?: { visitor: number; home: number };
  drive?: { plays: number; yards: number; penalties?: number; possessionTime: string; elapsed?: string };
  rawText: string;
}

export interface PlayState {
  quarter: number;
  clock: string;
  down: number;
  distance: number | "Goal";
  ballPosition: string;
  possession: TeamId;
}

export interface PlayDetails {
  formation: string[];
  action: PlayAction;
  actions: PlayAction[];
  officialActionIndex: number;
  participants: PlayParticipant[];
  penalties: PlayPenalty[];
  events: PlayEvent[];
  sequence: PlaySequenceEvent[];
  reviews: PlayReviewDetails[];
  injuryUpdates: PlayInjuryUpdate[];
  spots: PlaySpot[];
  officialEndPosition?: string;
  annotations: PlayAnnotation[];
  scoring?: PlayScoringDetails;
  parseStatus: "structured" | "partial" | "raw";
  unparsedText: string[];
}

export type PlayKind =
  | "pass"
  | "rush"
  | "sack"
  | "punt"
  | "field-goal"
  | "touchdown"
  | "turnover"
  | "penalty"
  | "other";

export interface Play {
  id: string;
  index: number;
  quarter: number;
  clock: string;
  down: number;
  distance: number | "Goal";
  yardLine: string;
  possession: TeamId;
  description: string;
  rawText: string;
  kind: PlayKind;
  yards: number | null;
  noPlay: boolean;
  driveId?: string;
  playerIds: string[];
  fieldPosition: number | null;
  details: PlayDetails;
  stateBefore: PlayState;
  stateAfter?: PlayState;
}

export interface Drive {
  id: string;
  teamId: TeamId;
  teamDriveNumber: number;
  quarter: number;
  startClock: string;
  endClock: string;
  possessionTime: string;
  obtained: string;
  startPosition: string;
  endPosition: string;
  plays: number;
  grossYards: number;
  penaltyYards: number;
  netYards: number;
  firstDowns: number;
  result: string;
  playIds: string[];
  firstPlayIndex: number;
  lastPlayIndex: number;
}

export interface PassingStats {
  attempts: number;
  completions: number;
  yards: number;
  sacks: string;
  touchdowns: number;
  long: number;
  interceptions: number;
  rating: number;
}

export interface RushingStats {
  attempts: number;
  yards: number;
  average: number;
  long: number;
  touchdowns: number;
}

export interface ReceivingStats {
  targets: number;
  receptions: number;
  yards: number;
  average: number;
  long: number;
  touchdowns: number;
}

export interface DefensiveStats {
  tackles: number;
  assists: number;
  combined: number;
  sacks: number;
  sackYards: number;
  tacklesForLoss: number;
  quarterbackHits: number;
  interceptions: number;
  passesDefended: number;
  forcedFumbles: number;
  fumbleRecoveries: number;
}

export interface SnapUnit {
  count: number;
  percentage: number;
}

export interface Player {
  id: string;
  name: string;
  teamId: TeamId;
  position?: string;
  starter: boolean;
  passing?: PassingStats;
  rushing?: RushingStats;
  receiving?: ReceivingStats;
  defense?: DefensiveStats;
  snaps?: {
    offense?: SnapUnit;
    defense?: SnapUnit;
    specialTeams?: SnapUnit;
  };
  playIds: string[];
}

export interface TeamStat {
  label: string;
  visitor: string;
  home: string;
}

export type ParseIssueSeverity = "warning" | "error";

export interface ParseValidationIssue {
  code: string;
  severity: ParseIssueSeverity;
  message: string;
  section?: "game" | "team-stats" | "players" | "snaps" | "drives" | "play-by-play";
  teamId?: TeamId;
}

export interface ParseValidation {
  status: "complete" | "partial";
  issues: ParseValidationIssue[];
  metrics: {
    playerCountByTeam: Record<TeamId, number>;
    positionCoverageByTeam: Record<TeamId, number>;
    snapCountByTeam: Record<TeamId, number>;
    teamStatValueCountByTeam: Record<TeamId, number>;
    structuredPlayCount: number;
    rawPlayCount: number;
    penaltyEventCount: number;
  };
}

export interface GameData {
  source: {
    fileName: string;
    pageCount: number;
    parsedAt: string;
    rawPages: RawPage[];
    sections: {
      scoring: boolean;
      teamStats: boolean;
      individualStats: boolean;
      defensiveStats: boolean;
      driveChart: boolean;
      playByPlay: boolean;
      playtimePercentage: boolean;
      roster: boolean;
    };
  };
  game: {
    title: string;
    date: string;
    venue: string;
    location: string;
    startTime: string;
    weather: string;
    attendance: string;
    duration: string;
  };
  teams: [Team, Team];
  scoring: ScoringPlay[];
  teamStats: TeamStat[];
  drives: Drive[];
  plays: Play[];
  players: Player[];
  validation: ParseValidation;
  warnings: string[];
}
