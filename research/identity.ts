import type { NflverseScheduleGame, ResearchGameIdentity } from "./types";

const GAME_TYPE: Record<ResearchGameIdentity["seasonType"], string[]> = {
  regular: ["REG"],
  postseason: ["WC", "DIV", "CON", "SB"],
};

export interface IdentityEvidence {
  season: boolean;
  seasonType: boolean;
  week: boolean | "not-applicable";
  awayTeam: boolean;
  homeTeam: boolean;
  kickoff: boolean | "not-compared";
}

export interface IdentityResolution {
  game: NflverseScheduleGame;
  evidence: IdentityEvidence;
}

function kickoffMatches(identity: ResearchGameIdentity, game: NflverseScheduleGame) {
  if (!identity.kickoffTime || !game.gameDay || !game.gameTime) return "not-compared" as const;
  const kickoff = new Date(identity.kickoffTime);
  if (!Number.isFinite(kickoff.getTime())) return false;
  // nflverse schedule stores US/Eastern local date/time without an offset.
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(kickoff).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return game.gameDay === date && game.gameTime?.padStart(5, "0") === time;
}

export function resolveNflverseGame(
  identity: ResearchGameIdentity,
  schedule: NflverseScheduleGame[],
): IdentityResolution {
  const candidates = schedule.filter((game) =>
    game.season === identity.season
    && GAME_TYPE[identity.seasonType].includes(game.gameType)
    && (identity.week === undefined || game.week === identity.week)
    && game.awayTeam === identity.awayTeam.code
    && game.homeTeam === identity.homeTeam.code,
  );

  const kickoffCandidates = candidates.filter((game) => kickoffMatches(identity, game) !== false);
  const resolved = kickoffCandidates.length === 1 ? kickoffCandidates : candidates;
  if (resolved.length !== 1) {
    throw new Error(`Expected one nflverse schedule match; found ${resolved.length}.`);
  }
  const game = resolved[0];
  return {
    game,
    evidence: {
      season: game.season === identity.season,
      seasonType: GAME_TYPE[identity.seasonType].includes(game.gameType),
      week: identity.week === undefined ? "not-applicable" : game.week === identity.week,
      awayTeam: game.awayTeam === identity.awayTeam.code,
      homeTeam: game.homeTeam === identity.homeTeam.code,
      kickoff: kickoffMatches(identity, game),
    },
  };
}
