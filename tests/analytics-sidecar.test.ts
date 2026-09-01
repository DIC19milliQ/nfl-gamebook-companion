import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { alignPlays, MATCHED_CONFIDENCE, MATCHER_VERSION } from "../src/analytics/nflverse/matcher";
import { buildAnalyticsSidecar, selectPlayAnalytics } from "../src/analytics/nflverse/sidecar";
import type { GamebookPlayInput, NflversePlay, PlayAlignment } from "../src/analytics/nflverse/types";
import type { Play } from "../src/types";

function external(overrides: Partial<NflversePlay> = {}): NflversePlay {
  return {
    providerGameId: "2025_01_DAL_PHI", providerPlayId: "100", sourceIndex: 0,
    quarter: 1, clock: "10:00", possessionTeam: "DAL", down: 1, distance: 10,
    yardLine: "DAL 25", playType: "pass", description: "D.Prescott pass complete to C.Lamb for 10 yards.", epa: 1.24,
    flags: { noPlay: false, penalty: false, touchdown: false, interception: false, fumbleLost: false, kickoff: false, punt: false, fieldGoal: false, extraPoint: false, timeout: false, passAttempt: true, completePass: true },
    ...overrides,
  };
}

function alignment(overrides: Partial<PlayAlignment> = {}): PlayAlignment {
  return {
    gamebookPlayIds: ["gb-1"], externalPlayRefs: [{ provider: "nflverse", providerGameId: "2025_01_DAL_PHI", providerPlayId: "100" }],
    status: "matched", relationship: "1:1", confidence: MATCHED_CONFIDENCE, matcherVersion: MATCHER_VERSION,
    evidence: {} as PlayAlignment["evidence"], ...overrides,
  };
}

describe("EPA analytics sidecar safety rules", () => {
  it("attaches finite primary-row EPA only to high-confidence matched plays", () => {
    const selected = selectPlayAnalytics([alignment()], [external()]);
    expect(selected.get("gb-1")).toMatchObject({ epa: 1.24, providerPlayId: "100", matcherVersion: "research-0.1.0" });
  });

  it("does not attach EPA to ambiguous, unmatched, low-confidence, many:1, or missing-EPA cases", () => {
    for (const candidate of [
      alignment({ status: "ambiguous" }), alignment({ status: "unmatched", externalPlayRefs: [] }),
      alignment({ confidence: MATCHED_CONFIDENCE - 0.0001 }), alignment({ relationship: "many:1", gamebookPlayIds: ["gb-1", "gb-2"] }),
    ]) expect(selectPlayAnalytics([candidate], [external()]).size).toBe(0);
    expect(selectPlayAnalytics([alignment()], [external({ epa: undefined })]).size).toBe(0);
  });

  it("uses only the primary row for 1:many and never sums attachment EPA", () => {
    const composite = alignment({
      relationship: "1:many",
      externalPlayRefs: [
        { provider: "nflverse", providerGameId: "2025_01_DAL_PHI", providerPlayId: "100" },
        { provider: "nflverse", providerGameId: "2025_01_DAL_PHI", providerPlayId: "101" },
      ],
    });
    expect(selectPlayAnalytics([composite], [external({ epa: 1.2 }), external({ providerPlayId: "101", sourceIndex: 1, epa: 0.9 })]).get("gb-1")?.epa).toBe(1.2);
  });

  it("runs the production matcher from Gamebook Play into the external sidecar", () => {
    const play = {
      id: "gb-1", index: 0, quarter: 1, clock: "10:00", possession: "DAL", down: 1, distance: 10,
      yardLine: "DAL 25", kind: "pass", description: "D.Prescott pass complete to C.Lamb for 10 yards.", noPlay: false,
    } as unknown as Play;
    const result = buildAnalyticsSidecar([play], [external()]);
    expect(result.alignment.alignments[0].status).toBe("matched");
    expect(result.byPlayId.get("gb-1")?.epa).toBe(1.24);
  });
});

describe("pass travel and win-probability sidecar safety rules", () => {
  it("keeps negative air yards and completion YAC from the primary pass row", () => {
    const selected = selectPlayAnalytics([alignment()], [external({ airYards: -2, yardsAfterCatch: 8 })]).get("gb-1");
    expect(selected).toMatchObject({ airYards: -2, yardsAfterCatch: 8, completePass: true });
  });

  it("shows target air on incompletions but never invents YAC", () => {
    const row = external({ airYards: 18, yardsAfterCatch: 0, flags: { ...external().flags, completePass: false } });
    const selected = selectPlayAnalytics([alignment()], [row]).get("gb-1");
    expect(selected?.airYards).toBe(18);
    expect(selected?.yardsAfterCatch).toBeUndefined();
    expect(selected?.completePass).toBe(false);
  });

  it("suppresses Air/YAC on penalties, no-plays, and sacks", () => {
    const cases = [
      external({ flags: { ...external().flags, penalty: true }, airYards: 12, yardsAfterCatch: 4 }),
      external({ flags: { ...external().flags, noPlay: true }, airYards: 12, yardsAfterCatch: 4 }),
      external({ playType: "sack", airYards: 12, yardsAfterCatch: 4 }),
    ];
    for (const row of cases) {
      const selected = selectPlayAnalytics([alignment()], [row]).get("gb-1");
      expect(selected?.airYards).toBeUndefined();
      expect(selected?.yardsAfterCatch).toBeUndefined();
    }
  });

  it("keeps the intended Air distance on an interception but never labels it YAC", () => {
    const row = external({ flags: { ...external().flags, interception: true, completePass: false }, airYards: 23, yardsAfterCatch: 4 });
    const selected = selectPlayAnalytics([alignment()], [row]).get("gb-1");
    expect(selected?.airYards).toBe(23);
    expect(selected?.yardsAfterCatch).toBeUndefined();
  });

  it("uses post-play home/away WP and names the gaining side in percentage points", () => {
    const selected = selectPlayAnalytics([alignment()], [external({
      possessionTeam: "PHI", homeWp: 0.4, awayWp: 0.6, homeWpPost: 0.55, awayWpPost: 0.45, wpa: 0.15,
    })]).get("gb-1");
    expect(selected).toMatchObject({
      homeWinProbability: 0.55, awayWinProbability: 0.45,
      winProbabilityChangeSide: "home",
    });
    expect(selected?.winProbabilityAddedPoints).toBeCloseTo(15, 8);
  });

  it("keeps safe current WP but hides WPA when the provider WPA cannot validate", () => {
    const selected = selectPlayAnalytics([alignment()], [external({
      homeWp: 0.4, awayWp: 0.6, homeWpPost: 0.55, awayWpPost: 0.45, wpa: 0.05,
    })]).get("gb-1");
    expect(selected).toMatchObject({ homeWinProbability: 0.55, awayWinProbability: 0.45 });
    expect(selected?.winProbabilityAddedPoints).toBeUndefined();
    expect(selected?.winProbabilityChangeSide).toBeUndefined();
  });

  it("uses first pre-WP and last chronological post-WP for a validated 1:many play", () => {
    const composite = alignment({ relationship: "1:many", externalPlayRefs: [
      { provider: "nflverse", providerGameId: "2025_01_DAL_PHI", providerPlayId: "100" },
      { provider: "nflverse", providerGameId: "2025_01_DAL_PHI", providerPlayId: "101" },
    ] });
    const selected = selectPlayAnalytics([composite], [
      external({ homeWp: 0.5, awayWp: 0.5, homeWpPost: 0.6, awayWpPost: 0.4, wpa: 0.1 }),
      external({ providerPlayId: "101", sourceIndex: 1, homeWp: 0.6, awayWp: 0.4, homeWpPost: 0.65, awayWpPost: 0.35, wpa: 0.05 }),
    ]).get("gb-1");
    expect(selected).toMatchObject({ homeWinProbability: 0.65, awayWinProbability: 0.35, winProbabilityChangeSide: "home" });
    expect(selected?.winProbabilityAddedPoints).toBeCloseTo(15, 8);
  });
});

describe("real 2025 Week 1 DAL @ PHI sidecar regression", () => {
  it("covers ordinary, scoring composite, turnover, and penalty/no-play without changing alignment", async () => {
    const fixture = JSON.parse(await readFile(new URL("../research/results/2025_01_DAL_PHI.json", import.meta.url), "utf8")) as {
      gamebook: GamebookPlayInput[]; nflverse: NflversePlay[]; alignments: PlayAlignment[];
    };
    const run = alignPlays(fixture.gamebook, fixture.nflverse);
    expect(run.alignments).toEqual(fixture.alignments);
    const analytics = selectPlayAnalytics(run.alignments, fixture.nflverse);
    const externalById = new Map(fixture.nflverse.map((play) => [play.providerPlayId, play]));
    const matched = run.alignments.filter((item) => item.status === "matched");
    const ordinary = matched.find((item) => ["run", "pass"].includes(externalById.get(item.externalPlayRefs[0].providerPlayId)?.playType ?? "") && item.relationship === "1:1");
    const scoring = matched.find((item) => item.relationship === "1:many" && externalById.get(item.externalPlayRefs[0].providerPlayId)?.flags.touchdown);
    const turnover = matched.find((item) => { const row = externalById.get(item.externalPlayRefs[0].providerPlayId); return row?.flags.interception || row?.flags.fumbleLost; });
    const noPlay = matched.find((item) => externalById.get(item.externalPlayRefs[0].providerPlayId)?.flags.noPlay);
    for (const item of [ordinary, scoring, turnover, noPlay]) {
      expect(item).toBeDefined();
      const primary = externalById.get(item!.externalPlayRefs[0].providerPlayId)!;
      if (typeof primary.epa === "number") expect(analytics.get(item!.gamebookPlayIds[0])?.epa).toBe(primary.epa);
      else expect(analytics.has(item!.gamebookPlayIds[0])).toBe(false);
    }
  });
});
