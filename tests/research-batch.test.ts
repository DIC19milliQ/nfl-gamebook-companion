import { describe, expect, it } from "vitest";
import { aggregateSummaries, runIndependentBatch, type GameEvaluationSummary } from "../research/batch";
import { MATCHER_VERSION } from "../research/matcher";

function summary(overrides: Partial<GameEvaluationSummary> = {}): GameEvaluationSummary {
  return {
    gameId: "game-1", matcherVersion: MATCHER_VERSION, gamebookPlays: 10, nflverseRows: 12,
    counts: { oneToOne: 8, oneToMany: 1, manyToOne: 0, ambiguous: 1, unmatchedGamebook: 0, unmatchedNflverse: 2 },
    highConfidence: { numerator: 9, denominator: 10, rate: 0.9 },
    externalReference: { numerator: 10, denominator: 12, rate: 10 / 12 },
    confidence: { minimum: 0.8, median: 0.95, bins: { "0.95-1.00": 5, "0.90-0.95": 3, "0.85-0.90": 1, "0.80-0.85": 0, "0.75-0.80": 0 } },
    ...overrides,
  };
}

describe("Phase 3 research batch", () => {
  it("processes games independently and preserves later results after one failure", async () => {
    const visited: string[] = [];
    const outcomes = await runIndependentBatch([{ id: "a" }, { id: "bad" }, { id: "c" }], async ({ id }) => {
      visited.push(id);
      if (id === "bad") throw new Error("fixture failure");
      return `${id}-result`;
    });
    expect(visited).toEqual(["a", "bad", "c"]);
    expect(outcomes).toEqual([
      { ok: true, id: "a", value: "a-result" },
      expect.objectContaining({ ok: false, id: "bad", error: expect.stringContaining("fixture failure") }),
      { ok: true, id: "c", value: "c-result" },
    ]);
  });

  it("aggregates exact per-game numerators, denominators, rates, and bins", () => {
    const result = aggregateSummaries([
      summary(),
      summary({ gameId: "game-2", gamebookPlays: 20, nflverseRows: 30,
        counts: { oneToOne: 17, oneToMany: 1, manyToOne: 0, ambiguous: 0, unmatchedGamebook: 2, unmatchedNflverse: 10 },
        highConfidence: { numerator: 18, denominator: 20, rate: 0.9 },
        externalReference: { numerator: 20, denominator: 30, rate: 2 / 3 },
        confidence: { minimum: 0.75, median: 0.9, bins: { "0.95-1.00": 6, "0.90-0.95": 5, "0.85-0.90": 4, "0.80-0.85": 2, "0.75-0.80": 1 } } }),
    ]);
    expect(result.totals).toMatchObject({ gamebookPlays: 30, nflverseRows: 42, highConfidence: 27, referencedRows: 30, ambiguous: 1, unmatchedGamebook: 2 });
    expect(result.coverage).toBe(0.9);
    expect(result.ambiguousRate).toBe(1 / 30);
    expect(result.unmatchedGamebookRate).toBe(2 / 30);
    expect(result.externalReferenceRate).toBe(30 / 42);
    expect(result.totals.bins["0.95-1.00"]).toBe(11);
  });

  it("rejects matcher-version drift across games", () => {
    expect(() => aggregateSummaries([summary(), summary({ gameId: "game-2", matcherVersion: "research-0.2.0" })]))
      .toThrow("matcher version");
  });
});
