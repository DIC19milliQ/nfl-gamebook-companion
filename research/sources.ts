import type { Play } from "../src/types";
import { readCsv } from "./csv";
import type {
  GamebookPlayInput,
  NflversePlay,
  NflverseScheduleGame,
  ResearchGameIdentity,
} from "./types";

function optionalNumber(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function flag(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

export async function loadSchedule(path: string) {
  const games: NflverseScheduleGame[] = [];
  for await (const row of readCsv(path)) {
    games.push({
      gameId: row.game_id,
      season: Number(row.season),
      gameType: row.game_type,
      week: optionalNumber(row.week),
      gameDay: row.gameday || undefined,
      gameTime: row.gametime || undefined,
      awayTeam: row.away_team,
      homeTeam: row.home_team,
    });
  }
  return games;
}

export async function loadNflverseGame(path: string, gameId: string) {
  const plays: NflversePlay[] = [];
  let sourceIndex = 0;
  for await (const row of readCsv(path, path.endsWith(".gz"))) {
    if (row.game_id !== gameId) continue;
    plays.push({
      providerGameId: row.game_id,
      providerPlayId: row.play_id,
      sourceIndex,
      quarter: optionalNumber(row.qtr),
      clock: row.time || undefined,
      possessionTeam: row.posteam || undefined,
      down: optionalNumber(row.down),
      distance: optionalNumber(row.ydstogo),
      yardLine: row.yrdln || undefined,
      playType: row.play_type || undefined,
      description: row.desc || undefined,
      drive: optionalNumber(row.drive),
      epa: optionalNumber(row.epa),
      wp: optionalNumber(row.wp),
      returnYards: optionalNumber(row.return_yards),
      replayResult: row.replay_or_challenge_result || undefined,
      fieldGoalResult: row.field_goal_result || undefined,
      penaltyType: row.penalty_type || undefined,
      flags: {
        noPlay: row.play_type === "no_play" || flag(row.no_play),
        penalty: flag(row.penalty),
        touchdown: flag(row.touchdown),
        interception: flag(row.interception),
        fumbleLost: flag(row.fumble_lost),
        kickoff: row.play_type === "kickoff" || flag(row.kickoff_attempt),
        punt: row.play_type === "punt" || flag(row.punt_attempt),
        fieldGoal: row.play_type === "field_goal" || flag(row.field_goal_attempt),
        extraPoint: row.play_type === "extra_point" || flag(row.extra_point_attempt),
        timeout: flag(row.timeout) || /^Timeout /i.test(row.desc),
        interceptionReturn: flag(row.interception) && (optionalNumber(row.return_yards) ?? 0) !== 0,
        fumble: flag(row.fumble),
        fumbleReturn: flag(row.fumble) && (
          (optionalNumber(row.fumble_recovery_1_yards) ?? 0) !== 0
          || (optionalNumber(row.fumble_recovery_2_yards) ?? 0) !== 0
        ),
        replay: flag(row.replay_or_challenge),
        replayReversal: flag(row.replay_or_challenge) && /reversed|overturned/i.test(`${row.replay_or_challenge_result} ${row.desc}`),
        blockedFieldGoal: flag(row.field_goal_attempt) && /block/i.test(`${row.field_goal_result} ${row.desc}`),
        blockedPunt: flag(row.punt_blocked),
        safety: flag(row.safety),
        offsettingPenalty: /offset/i.test(row.desc),
        kickoffPenalty: flag(row.kickoff_attempt) && flag(row.penalty),
      },
    });
    sourceIndex += 1;
  }
  return plays;
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

export interface CenterMetadata {
  gameId: string;
  gamebookUrl: string;
  schemaVersion: 1;
  identity: ResearchGameIdentity & {
    providerIds: { nflGameCenter: string };
    roundKey?: string;
  };
}
