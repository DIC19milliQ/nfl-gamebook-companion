import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolveNflverseGame } from "../research/identity";
import { alignPlays, MATCHED_CONFIDENCE } from "../src/analytics/nflverse/matcher";
import type { GamebookPlayInput, NflversePlay } from "../src/analytics/nflverse/types";

function gamebook(overrides: Partial<GamebookPlayInput> = {}): GamebookPlayInput {
  return {
    id: "gb-1", sourceIndex: 0, quarter: 1, clock: "10:00", possessionTeam: "DAL",
    down: 1, distance: 10, yardLine: "DAL 25", playType: "pass",
    description: "D.Prescott pass short right to C.Lamb to DAL 35 for 10 yards.",
    ...overrides,
  };
}

function external(overrides: Partial<NflversePlay> = {}): NflversePlay {
  return {
    providerGameId: "2025_01_DAL_PHI", providerPlayId: "100", sourceIndex: 0,
    quarter: 1, clock: "10:00", possessionTeam: "DAL", down: 1, distance: 10,
    yardLine: "DAL 25", playType: "pass",
    description: "(10:00) 4-D.Prescott pass short right to 88-C.Lamb to DAL 35 for 10 yards.",
    flags: {
      noPlay: false, penalty: false, touchdown: false, interception: false, fumbleLost: false,
      kickoff: false, punt: false, fieldGoal: false, extraPoint: false, timeout: false,
    },
    ...overrides,
  };
}

describe("research play alignment matcher", () => {
  it("matches a clear 1:1 play with traceable evidence", () => {
    const result = alignPlays([gamebook()], [external()]);
    expect(result.alignments[0]).toMatchObject({ status: "matched", relationship: "1:1" });
    expect(result.alignments[0].confidence).toBeGreaterThanOrEqual(MATCHED_CONFIDENCE);
    expect(result.alignments[0].evidence.criteria).toMatchObject({
      quarter: { outcome: "match" }, clock: { outcome: "match" }, possession: { outcome: "match" },
      down: { outcome: "match" }, distance: { outcome: "match" }, yardLine: { outcome: "match" },
      playType: { outcome: "match" }, sequence: { outcome: "match" },
    });
  });

  it("uses state and description to disambiguate candidates sharing a clock", () => {
    const wrong = external({ providerPlayId: "99", yardLine: "PHI 20", description: "D.Prescott pass incomplete to J.Ferguson." });
    const right = external({ providerPlayId: "100", sourceIndex: 1 });
    const result = alignPlays([gamebook()], [wrong, right]);
    expect(result.alignments[0].externalPlayRefs.map((item) => item.providerPlayId)).toEqual(["100"]);
    expect(result.alignments[0].evidence.marginToNextCandidate).toBeGreaterThan(0.045);
  });

  it("matches penalty / no-play using more than its clock", () => {
    const description = "D.Prescott pass incomplete. PENALTY on PHI, Defensive Pass Interference, enforced at PHI 1 - No Play.";
    const result = alignPlays([
      gamebook({ description, playType: "penalty", noPlay: true, yardLine: "PHI 1" }),
    ], [external({ description, playType: "no_play", yardLine: "PHI 1", flags: { ...external().flags, noPlay: true, penalty: true } })]);
    expect(result.alignments[0]).toMatchObject({ status: "matched", relationship: "1:1" });
    expect(result.alignments[0].evidence.criteria.playType.outcome).toBe("match");
  });

  it("represents a Gamebook touchdown plus PAT as 1:many", () => {
    const touchdown = gamebook({
      description: "J.Williams left guard for 1 yard, TOUCHDOWN. B.Aubrey extra point is GOOD, Center-T.Sieg, Holder-B.Anger.",
      playType: "touchdown", yardLine: "PHI 1", down: 1, distance: 1,
    });
    const nflTouchdown = external({
      providerPlayId: "200", description: "J.Williams left guard for 1 yard, TOUCHDOWN.",
      playType: "run", yardLine: "PHI 1", down: 1, distance: 1,
    });
    const pat = external({
      providerPlayId: "201", sourceIndex: 1, clock: "09:57", down: undefined, distance: 0,
      yardLine: "PHI 15", playType: "extra_point", description: "B.Aubrey extra point is GOOD, Center-T.Sieg, Holder-B.Anger.",
      flags: { ...external().flags, extraPoint: true },
    });
    const result = alignPlays([touchdown], [nflTouchdown, pat]);
    expect(result.alignments[0]).toMatchObject({ status: "matched", relationship: "1:many" });
    expect(result.alignments[0].externalPlayRefs.map((item) => item.providerPlayId)).toEqual(["200", "201"]);
  });

  it("represents two Gamebook fragments mapped to one nflverse row as many:1", () => {
    const left = gamebook({ id: "gb-1", description: "D.Prescott pass deep right", playType: undefined });
    const right = gamebook({ id: "gb-2", sourceIndex: 1, description: "C.Lamb DAL 35 ten", playType: undefined });
    const one = external({ description: "D.Prescott pass deep right C.Lamb DAL 35 ten", playType: undefined });
    const result = alignPlays([left, right], [one]);
    expect(result.alignments).toHaveLength(1);
    expect(result.alignments[0]).toMatchObject({ status: "matched", relationship: "many:1", gamebookPlayIds: ["gb-1", "gb-2"] });
  });

  it("marks tied same-clock candidates ambiguous and records the reason", () => {
    const result = alignPlays([gamebook()], [external({ providerPlayId: "100" }), external({ providerPlayId: "101", sourceIndex: 1 })]);
    expect(result.alignments[0].status).toBe("ambiguous");
    expect(result.alignments[0].evidence.ambiguityReasons[0]).toContain("Top-two candidate margin");
    expect(result.alignments[0].evidence.alternatives).toHaveLength(1);
  });

  it("marks a play with no plausible candidate unmatched", () => {
    const result = alignPlays([gamebook()], [external({ quarter: 4, clock: "01:00", possessionTeam: "PHI", description: "J.Hurts kneels." })]);
    expect(result.alignments[0]).toMatchObject({ status: "unmatched", externalPlayRefs: [] });
    expect(result.unmatchedExternalPlayIds).toEqual(["100"]);
  });
});

describe("research identity resolution", () => {
  it("uses Center identity fields rather than converting the Center game ID", () => {
    const result = resolveNflverseGame({
      season: 2025, seasonType: "regular", week: 1, kickoffTime: "2025-09-05T00:20:00.000Z",
      awayTeam: { name: "Dallas Cowboys", code: "DAL" }, homeTeam: { name: "Philadelphia Eagles", code: "PHI" },
    }, [{
      gameId: "2025_01_DAL_PHI", season: 2025, gameType: "REG", week: 1,
      gameDay: "2025-09-04", gameTime: "20:20", awayTeam: "DAL", homeTeam: "PHI",
    }]);
    expect(result.game.gameId).toBe("2025_01_DAL_PHI");
    expect(Object.values(result.evidence).every(Boolean)).toBe(true);
  });
});

describe("2025 Week 1 DAL @ PHI research fixture", () => {
  it("reproduces the measured alignment totals", async () => {
    const fixture = JSON.parse(await readFile(new URL("../research/results/2025_01_DAL_PHI.json", import.meta.url), "utf8"));
    const result = alignPlays(fixture.gamebook, fixture.nflverse);
    expect(fixture.gamebook).toHaveLength(133);
    expect(fixture.nflverse).toHaveLength(163);
    expect(result.alignments.filter((item) => item.status === "matched" && item.relationship === "1:1")).toHaveLength(127);
    expect(result.alignments.filter((item) => item.status === "matched" && item.relationship === "1:many")).toHaveLength(6);
    expect(result.alignments.filter((item) => item.status === "matched" && item.relationship === "many:1")).toHaveLength(0);
    expect(result.alignments.filter((item) => item.status === "ambiguous")).toHaveLength(0);
    expect(result.alignments.filter((item) => item.status === "unmatched")).toHaveLength(0);
    expect(result.unmatchedExternalPlayIds).toHaveLength(21);
  });
});
