import type { NflversePlay } from "./types";

export const CENTER_PBP_ENDPOINT = "https://spoiler-free-nfl-gamebooks.dic19.chatgpt.site/api/companion/pbp";
export const MAX_PBP_RESPONSE_BYTES = 2 * 1024 * 1024;

const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface NflverseProvenance {
  datasetVersion: string;
  datasetHash: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  checkedAt: string;
  payloadHash: string;
}

export interface NflverseGamePayload {
  centerGameId: string;
  nflverseGameId: string;
  provenance: NflverseProvenance;
  plays: NflversePlay[];
}

interface CenterPlayDto {
  gameId: string;
  playId: string;
  quarter: number | null;
  clock: string | null;
  possessionTeam: string | null;
  down: number | null;
  distance: number | null;
  yardLine: string | null;
  playType: string | null;
  description: string | null;
  sequence: number;
  epa: number | null;
  flags: NflversePlay["flags"];
}

interface CenterPbpDto {
  schemaVersion: 1;
  centerGameId: string;
  nflverseGameId: string;
  provenance: NflverseProvenance;
  plays: CenterPlayDto[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nullableString(value: unknown, max: number) {
  return value === null || (typeof value === "string" && value.length <= max);
}

function nullableNumber(value: unknown) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

const FLAG_KEYS: (keyof NflversePlay["flags"])[] = [
  "noPlay", "penalty", "touchdown", "interception", "fumbleLost",
  "kickoff", "punt", "fieldGoal", "extraPoint", "timeout",
];

export function validateCenterPbpDto(value: unknown, requestedGameId: string): CenterPbpDto | null {
  const dto = record(value);
  const provenance = record(dto?.provenance);
  if (!dto || dto.schemaVersion !== 1 || dto.centerGameId !== requestedGameId) return null;
  if (typeof dto.nflverseGameId !== "string" || dto.nflverseGameId.length > 80) return null;
  if (!provenance
    || typeof provenance.datasetVersion !== "string" || !provenance.datasetVersion || provenance.datasetVersion.length > 300
    || typeof provenance.datasetHash !== "string" || !SHA256_PATTERN.test(provenance.datasetHash)
    || !(provenance.sourceUpdatedAt === null || validTimestamp(provenance.sourceUpdatedAt))
    || !validTimestamp(provenance.fetchedAt) || !validTimestamp(provenance.checkedAt)
    || typeof provenance.payloadHash !== "string" || !SHA256_PATTERN.test(provenance.payloadHash)
    || !Array.isArray(dto.plays) || dto.plays.length > 500) return null;

  const ids = new Set<string>();
  for (const candidate of dto.plays) {
    const play = record(candidate);
    const flags = record(play?.flags);
    if (!play || play.gameId !== dto.nflverseGameId
      || typeof play.playId !== "string" || !play.playId || play.playId.length > 80 || ids.has(play.playId)
      || !(play.quarter === null || (Number.isInteger(play.quarter) && Number(play.quarter) >= 0 && Number(play.quarter) <= 10))
      || !nullableString(play.clock, 12) || !nullableString(play.possessionTeam, 8)
      || !(play.down === null || (Number.isInteger(play.down) && Number(play.down) >= 0 && Number(play.down) <= 4))
      || !(play.distance === null || (Number.isFinite(play.distance) && Number(play.distance) >= 0 && Number(play.distance) <= 100))
      || !nullableString(play.yardLine, 32) || !nullableString(play.playType, 64)
      || !nullableString(play.description, 12_000)
      || !Number.isInteger(play.sequence) || Number(play.sequence) < 0
      || !nullableNumber(play.epa) || !flags
      || FLAG_KEYS.some((key) => typeof flags[key] !== "boolean")) return null;
    ids.add(play.playId);
  }
  return value as CenterPbpDto;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchNflversePbp(gameId: string, options: { fetcher?: Fetcher } = {}): Promise<NflverseGamePayload> {
  if (gameId.length > 120 || !GAME_ID_PATTERN.test(gameId)) throw new Error("The link contains an invalid NFL game ID.");
  const url = new URL(CENTER_PBP_ENDPOINT);
  url.searchParams.set("game", gameId);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, { cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    throw new Error("nflverse analytics are unavailable.");
  }
  if (!response.ok) throw new Error("nflverse analytics are unavailable.");
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) throw new Error("nflverse analytics returned an invalid response.");
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PBP_RESPONSE_BYTES) throw new Error("nflverse analytics response is too large.");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PBP_RESPONSE_BYTES) throw new Error("nflverse analytics response is too large.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("nflverse analytics returned unreadable JSON."); }
  const dto = validateCenterPbpDto(parsed, gameId);
  if (!dto) throw new Error("nflverse analytics returned an invalid DTO.");
  const actualHash = `sha256:${await sha256(JSON.stringify({ plays: dto.plays }))}`;
  if (actualHash !== dto.provenance.payloadHash) throw new Error("nflverse analytics payload integrity check failed.");
  return {
    centerGameId: dto.centerGameId,
    nflverseGameId: dto.nflverseGameId,
    provenance: dto.provenance,
    plays: dto.plays.map((play) => ({
      providerGameId: play.gameId,
      providerPlayId: play.playId,
      sourceIndex: play.sequence,
      quarter: play.quarter ?? undefined,
      clock: play.clock ?? undefined,
      possessionTeam: play.possessionTeam ?? undefined,
      down: play.down ?? undefined,
      distance: play.distance ?? undefined,
      yardLine: play.yardLine ?? undefined,
      playType: play.playType ?? undefined,
      description: play.description ?? undefined,
      epa: play.epa ?? undefined,
      flags: play.flags,
    })),
  };
}
