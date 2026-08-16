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

export interface GameData {
  source: {
    fileName: string;
    pageCount: number;
    parsedAt: string;
    rawPages: RawPage[];
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
  warnings: string[];
}
