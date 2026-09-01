import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CENTER_PBP_ENDPOINT, CENTER_PBP_REQUEST_ENDPOINT, fetchNflversePbp, requestNflversePbp, validateCenterPbpDto } from "../src/analytics/nflverse/loader";

const centerGameId = "cowboys-at-eagles-2025-reg-1";
const nflverseGameId = "2025_01_DAL_PHI";
const flags = {
  noPlay: false, penalty: false, touchdown: false, interception: false, fumbleLost: false,
  kickoff: false, punt: false, fieldGoal: false, extraPoint: false, timeout: false,
};

function dto(epa: number | null = -0.42, playOverrides: Record<string, unknown> = {}, schemaVersion: 1 | 2 = 2) {
  const plays = [{
    gameId: nflverseGameId, playId: "100", quarter: 1, clock: "10:00", possessionTeam: "DAL",
    down: 1, distance: 10, yardLine: "DAL 25", playType: "pass", description: "Pass complete.", sequence: 0, epa,
    ...playOverrides,
    flags: { ...flags, ...(playOverrides.flags as Record<string, unknown> | undefined) },
  }];
  const payloadHash = `sha256:${createHash("sha256").update(JSON.stringify({ plays })).digest("hex")}`;
  return {
    schemaVersion, centerGameId, nflverseGameId,
    provenance: {
      datasetVersion: "etag-v1", datasetHash: `sha256:${"a".repeat(64)}`,
      sourceUpdatedAt: "2025-09-06T00:00:00.000Z", fetchedAt: "2026-08-24T00:00:00.000Z",
      checkedAt: "2026-08-24T00:00:00.000Z", payloadHash,
    },
    plays,
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("Center nflverse PBP loader", () => {
  it("validates identity and integrity before mapping a negative EPA", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(dto()));
    const result = await fetchNflversePbp(centerGameId, { fetcher });
    expect(result.centerGameId).toBe(centerGameId);
    expect(result.nflverseGameId).toBe(nflverseGameId);
    expect(result.plays[0]).toMatchObject({ providerGameId: nflverseGameId, providerPlayId: "100", sourceIndex: 0, epa: -0.42 });
    expect(fetcher).toHaveBeenCalledWith(new URL(`${CENTER_PBP_ENDPOINT}?game=${centerGameId}`), expect.objectContaining({ cache: "no-store" }));
  });

  it("preserves missing EPA instead of converting it to zero", async () => {
    const result = await fetchNflversePbp(centerGameId, { fetcher: vi.fn().mockResolvedValue(jsonResponse(dto(null))) });
    expect(result.plays[0].epa).toBeUndefined();
  });

  it("accepts additive v2 pass and win-probability fields while retaining v1 compatibility", async () => {
    const analytics = await fetchNflversePbp(centerGameId, { fetcher: vi.fn().mockResolvedValue(jsonResponse(dto(0.7, {
      airYards: -2, yardsAfterCatch: 8, homeWp: 0.44, awayWp: 0.56,
      homeWpPost: 0.51, awayWpPost: 0.49, wpa: 0.07,
      flags: { passAttempt: true, completePass: true },
    }))) });
    expect(analytics.plays[0]).toMatchObject({
      airYards: -2, yardsAfterCatch: 8, homeWp: 0.44, awayWp: 0.56,
      homeWpPost: 0.51, awayWpPost: 0.49, wpa: 0.07,
      flags: expect.objectContaining({ passAttempt: true, completePass: true }),
    });
    expect(validateCenterPbpDto(dto(-0.2, {}, 1), centerGameId)).not.toBeNull();
  });

  it("distinguishes a cache miss from invalid DTO and payload tampering", async () => {
    await expect(fetchNflversePbp(centerGameId, { fetcher: vi.fn().mockResolvedValue(jsonResponse({ error: "PBP_NOT_READY" }, 404)) })).rejects.toThrow("being prepared");
    expect(validateCenterPbpDto({ ...dto(), centerGameId: "another-game" }, centerGameId)).toBeNull();
    const tampered = dto();
    tampered.plays[0].description = "changed after hashing";
    await expect(fetchNflversePbp(centerGameId, { fetcher: vi.fn().mockResolvedValue(jsonResponse(tampered)) })).rejects.toThrow("integrity");
  });

  it("registers demand only through the bounded JSON request endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ status: "preparing", game: centerGameId }, 202));
    await expect(requestNflversePbp(centerGameId, { fetcher })).resolves.toBe("preparing");
    expect(fetcher).toHaveBeenCalledWith(CENTER_PBP_REQUEST_ENDPOINT, expect.objectContaining({
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ game: centerGameId }),
    }));
  });

  it("rejects invalid game IDs before making a request", async () => {
    const fetcher = vi.fn();
    await expect(fetchNflversePbp("../admin", { fetcher })).rejects.toThrow("invalid NFL game ID");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
