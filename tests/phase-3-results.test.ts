import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MATCHER_VERSION } from "../research/matcher";

async function json(path: string) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

describe("committed Phase 3 blind-validation artifacts", () => {
  it("keeps every selected game on research-0.1.0 and identity-resolved", async () => {
    const manifest = await json("../research/phase-3-games.json");
    const games = await Promise.all(manifest.map(({ id }: { id: string }) => json(`../research/results/phase-3/${id}.json`)));
    expect(games).toHaveLength(6);
    for (const game of games) {
      expect(game.matcherVersion).toBe(MATCHER_VERSION);
      expect(game.nflverseGameId).toBe(game.summary.gameId);
      expect(Object.values(game.identityEvidence).every(Boolean)).toBe(true);
    }
  });

  it("keeps aggregate metrics equal to the sum of per-game results", async () => {
    const aggregate = await json("../research/results/phase-3/aggregate.json");
    const games = await Promise.all(aggregate.games.map(({ gameId }: { gameId: string }) => json(`../research/results/phase-3/${gameId}.json`)));
    const gamebook = games.reduce((sum, game) => sum + game.summary.gamebookPlays, 0);
    const nflverse = games.reduce((sum, game) => sum + game.summary.nflverseRows, 0);
    const highConfidence = games.reduce((sum, game) => sum + game.summary.highConfidence.numerator, 0);
    const referenced = games.reduce((sum, game) => sum + game.summary.externalReference.numerator, 0);
    expect(aggregate.metrics.gamebookHighConfidenceCoverage).toMatchObject({ numerator: highConfidence, denominator: gamebook });
    expect(aggregate.metrics.externalRowReferenceRate).toMatchObject({ numerator: referenced, denominator: nflverse });
    expect(aggregate.metrics.gamebookHighConfidenceCoverage.rate).toBe(highConfidence / gamebook);
    expect(aggregate.metrics.externalRowReferenceRate.rate).toBe(referenced / nflverse);
  });

  it("records the frozen matcher hash and zero audited false matches", async () => {
    const aggregate = await json("../research/results/phase-3/aggregate.json");
    expect(aggregate.matcherSha256).toBe("5d09bee7bf4009783f2d85660aa459bb0a34b3f8184ebcb43285b800539dc2e4");
    expect(aggregate.metrics.falseMatchRate).toEqual({ numerator: 0, denominator: 899, rate: 0 });
  });
});
