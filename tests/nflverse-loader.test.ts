import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CENTER_PBP_ENDPOINT, fetchNflversePbp, validateCenterPbpDto } from "../src/analytics/nflverse/loader";

const centerGameId = "cowboys-at-eagles-2025-reg-1";
const nflverseGameId = "2025_01_DAL_PHI";
const flags = {
  noPlay: false, penalty: false, touchdown: false, interception: false, fumbleLost: false,
  kickoff: false, punt: false, fieldGoal: false, extraPoint: false, timeout: false,
};

function dto(epa: number | null = -0.42) {
  const plays = [{
    gameId: nflverseGameId, playId: "100", quarter: 1, clock: "10:00", possessionTeam: "DAL",
    down: 1, distance: 10, yardLine: "DAL 25", playType: "pass", description: "Pass complete.", sequence: 0, epa, flags,
  }];
  const payloadHash = `sha256:${createHash("sha256").update(JSON.stringify({ plays })).digest("hex")}`;
  return {
    schemaVersion: 1, centerGameId, nflverseGameId,
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

  it("treats unavailable, invalid DTO, and payload tampering as optional failures", async () => {
    await expect(fetchNflversePbp(centerGameId, { fetcher: vi.fn().mockResolvedValue(jsonResponse({ error: "PBP_NOT_READY" }, 404)) })).rejects.toThrow("unavailable");
    expect(validateCenterPbpDto({ ...dto(), centerGameId: "another-game" }, centerGameId)).toBeNull();
    const tampered = dto();
    tampered.plays[0].description = "changed after hashing";
    await expect(fetchNflversePbp(centerGameId, { fetcher: vi.fn().mockResolvedValue(jsonResponse(tampered)) })).rejects.toThrow("integrity");
  });

  it("rejects invalid game IDs before making a request", async () => {
    const fetcher = vi.fn();
    await expect(fetchNflversePbp("../admin", { fetcher })).rejects.toThrow("invalid NFL game ID");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
