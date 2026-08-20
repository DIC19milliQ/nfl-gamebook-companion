import type { TeamId } from "./types";

/**
 * NFL Gamebook's current Team Abbreviation Codes that differ from the
 * identifiers used by Gamebook Center / Companion.
 */
export const CURRENT_GAMEBOOK_TEAM_CODE_TO_INTERNAL_ID: Record<string, TeamId> = {
  ARZ: "ARI",
  BLT: "BAL",
  CLV: "CLE",
  HST: "HOU",
};

/**
 * Alternate codes retained for older Gamebooks and other NFL data sources.
 * These are deliberately separate from the current NFL Gamebook-code map.
 */
export const LEGACY_OR_ALTERNATE_TEAM_CODE_TO_INTERNAL_ID: Record<string, TeamId> = {
  LA: "LAR",
  JAC: "JAX",
  WSH: "WAS",
};

/**
 * Converts a source team code to the internal TeamId used by the app.
 * It only normalizes codes for identity comparisons; callers keep their
 * original Gamebook strings for all displayed text and stored positions.
 */
export function normalizeGamebookTeamCode(code: string): TeamId {
  const normalized = code.trim().toUpperCase();
  return CURRENT_GAMEBOOK_TEAM_CODE_TO_INTERNAL_ID[normalized]
    ?? LEGACY_OR_ALTERNATE_TEAM_CODE_TO_INTERNAL_ID[normalized]
    ?? normalized;
}

export function isSameTeamCode(sourceCode: string, teamId: TeamId) {
  return normalizeGamebookTeamCode(sourceCode) === normalizeGamebookTeamCode(teamId);
}
