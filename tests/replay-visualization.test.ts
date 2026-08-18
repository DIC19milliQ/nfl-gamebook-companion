import { describe, expect, it } from "vitest";
import { driveResultView, fieldPercent, replayFieldView } from "../src/field";
import { parsePlayDetails } from "../src/parser/playText";
import type { Drive, GameData, Play, Team } from "../src/types";

const teams: [Team, Team] = [
  { id: "TEN", name: "Tennessee Titans", shortName: "Titans", homeAway: "visitor", score: 0, color: "#4b92db" },
  { id: "SF", name: "San Francisco 49ers", shortName: "49ers", homeAway: "home", score: 0, color: "#c9243f" },
];
const game = { teams } as GameData;

function makePlay(description: string, { possession = "TEN", ballPosition = "TEN 47", down = 2, distance = 10, stateAfter = ballPosition }: { possession?: "TEN" | "SF"; ballPosition?: string; down?: number; distance?: number; stateAfter?: string } = {}) {
  const details = parsePlayDetails(description, possession, teams);
  const kind = details.events.some((event) => event.type === "touchdown") ? "touchdown" : details.action.type === "field-goal" ? "field-goal" : details.action.type === "pass" ? "pass" : details.action.type === "sack" ? "sack" : details.action.type === "rush" ? "rush" : "other";
  return {
    id: "p", index: 0, quarter: 1, clock: "6:57", down, distance, yardLine: ballPosition, possession, description, rawText: description, kind,
    yards: details.action.yards ?? null, noPlay: details.penalties.some((penalty) => penalty.noPlay), playerIds: [], fieldPosition: 47, details,
    stateBefore: { quarter: 1, clock: "6:57", down, distance, ballPosition, possession },
    stateAfter: { quarter: 1, clock: "6:50", down: down + 1, distance, ballPosition: stateAfter, possession },
  } as Play;
}

describe("GAMEBOOK REPLAY field visualization model", () => {
  it("uses a safely-known stateAfter spot for an uncomplicated incomplete pass", () => {
    const view = replayFieldView(game, makePlay("(Shotgun) C.Ward pass incomplete short left to W.Robinson."));
    expect(view).toMatchObject({ mode: "no-movement", visualization: "pass-incomplete", finalSource: "state-after", startPosition: "TEN 47", displayFinalPosition: "TEN 47", noMovement: true, displayMovementYards: 0, resultLabel: "INCOMPLETE · 0 YARDS", resultState: "incomplete", playDirection: "SHORT LEFT" });
    expect(view.startPercent).toBe(view.displayFinalPercent);
    expect(view.schematicTargetPercent).toBeGreaterThan(view.startPercent!);
  });

  it("renders no gain with the same no-movement grammar", () => {
    const view = replayFieldView(game, makePlay("T.Pollard up the middle to TEN 47 for no gain."));
    expect(view).toMatchObject({ mode: "no-movement", visualization: "run", visualizationLabel: "RUN", playDirection: "UP THE MIDDLE", resultLabel: "NO GAIN · 0 YARDS", resultState: "no-gain", displayFinalPosition: "TEN 47", displayMovementYards: 0 });
  });

  it("does not use the no-penalty fallback when an incomplete pass has enforcement", () => {
    const play = makePlay("C.Ward pass incomplete short right. PENALTY on TEN-C.Ward, Intentional Grounding, 16 yards, enforced at TEN 19.", { ballPosition: "TEN 19", stateAfter: "TEN 3" });
    const view = replayFieldView(game, play);
    expect(view).toMatchObject({ mode: "movement", finalSource: "state-after", displayFinalPosition: "TEN 3", noMovement: false, displayMovementYards: -16 });
  });

  it("preserves normal visitor-team gain visualization", () => {
    const view = replayFieldView(game, makePlay("C.Ward pass short right to W.Robinson to SF 45 for 8 yards.", { stateAfter: "SF 45" }));
    expect(view).toMatchObject({ mode: "movement", visualization: "pass-complete", visualizationLabel: "PASS COMPLETE", playDirection: "SHORT RIGHT", direction: "right", displayFinalPosition: "SF 45", displayMovementYards: 8, resultLabel: "+8 YARDS", resultState: "positive", downDistance: "2ND & 10" });
    expect(view.displayFinalPercent).toBeGreaterThan(view.startPercent!);
  });

  it("keeps a touchdown main phase at the end zone and separates XP and kickoff placement", () => {
    const description = "T.Pollard up the middle for 5 yards, TOUCHDOWN. R6 J.Slye extra point is GOOD, Center-M.Cox, Holder-T.Townsend. TEN 7 SF 0, 11 plays, 95 yards, 1 penalty, 5:10 drive, 10:18 elapsed PENALTY on TEN-J.Slye, Kickoff Out of Bounds, placed at SF 40.";
    const view = replayFieldView(game, makePlay(description, { ballPosition: "SF 5", down: 3, distance: 3, stateAfter: "SF 40" }));
    expect(view).toMatchObject({ mode: "touchdown", visualization: "run", displayFinalPosition: "END ZONE", displayFinalPercent: fieldPercent(100), displayMovementYards: 5, resultLabel: "TOUCHDOWN", resultState: "touchdown" });
    expect(view.phases).toEqual([
      { phase: "scrimmage", label: "SCRIMMAGE", result: "TOUCHDOWN" },
      { phase: "try", label: "XP", result: "GOOD" },
      { phase: "kickoff", label: "KICKOFF", result: "OUT OF BOUNDS", position: "SF 40" },
    ]);
  });

  it.each([
    ["E.Pineiro 41 yard field goal is GOOD.", "good", "FIELD GOAL · GOOD"],
    ["E.Pineiro 61 yard field goal is No Good, Short.", "missed", "FIELD GOAL · MISSED"],
  ] as const)("models field-goal outcome without treating it as a final ball spot: %s", (description, outcome, resultLabel) => {
    const view = replayFieldView(game, makePlay(description, { possession: "SF", ballPosition: "TEN 23", down: 4, distance: 6, stateAfter: "SF 49" }));
    expect(view).toMatchObject({ mode: "field-goal", visualization: "field-goal", direction: "left", displayFinalPosition: "UPRIGHTS", displayFinalPercent: fieldPercent(0), resultLabel, resultState: outcome === "good" ? "field-goal-good" : "field-goal-missed", fieldGoal: { outcome } });
    expect(view.displayMovementYards).toBeNull();
  });

  it("provides team, direction, and down-distance data for both possessions", () => {
    const visitor = replayFieldView(game, makePlay("C.Ward pass incomplete.", { possession: "TEN", down: 3, distance: 4 }));
    const home = replayFieldView(game, makePlay("K.Rourke pass incomplete.", { possession: "SF", ballPosition: "SF 32", down: 2, distance: 10 }));
    expect(visitor).toMatchObject({ direction: "right", downDistance: "3RD & 4" });
    expect(home).toMatchObject({ direction: "left", downDistance: "2ND & 10" });
  });

  it("uses a solid run grammar and exposes positive and negative semantic results", () => {
    const run = replayFieldView(game, makePlay("T.Pollard right tackle to SF 45 for 8 yards.", { stateAfter: "SF 45" }));
    const sack = replayFieldView(game, makePlay("C.Ward sacked at TEN 39 for -8 yards (N.Bosa).", { stateAfter: "TEN 39" }));
    expect(run).toMatchObject({ visualization: "run", playDirection: "RIGHT TACKLE", schematicLane: 62, resultState: "positive", resultLabel: "+8 YARDS" });
    expect(sack).toMatchObject({ visualization: "sack", resultState: "negative", resultLabel: "-8 YARDS" });
  });

  it("models a drive-ending lost fumble with the recovered team's possession", () => {
    const play = makePlay("T.Pollard up the middle to TEN 47 for no gain. T.Pollard FUMBLES (F.Warner), RECOVERED by SF-F.Warner at TEN 47.");
    const drive = { id: "d1", teamId: "TEN", result: "Fumble", plays: 5, netYards: 18, possessionTime: "2:41", endPosition: "TEN 47", firstPlayIndex: 0, lastPlayIndex: 0 } as Drive;
    expect(replayFieldView(game, play)).toMatchObject({ visualization: "run", turnover: true, resultLabel: "FUMBLE LOST", resultState: "turnover" });
    expect(driveResultView(game, drive, play)).toMatchObject({ category: "fumble", label: "FUMBLE LOST", possessionChange: { teamId: "SF", ballPosition: "TEN 47" } });
  });

  it("models an interception and safely uses only the revealed event for possession change", () => {
    const play = makePlay("C.Ward pass short right intended for W.Robinson INTERCEPTED by F.Warner at SF 45.", { stateAfter: "SF 45" });
    const drive = { id: "d2", teamId: "TEN", result: "Interception", plays: 3, netYards: 12, possessionTime: "1:51", endPosition: "SF 45", firstPlayIndex: 0, lastPlayIndex: 0 } as Drive;
    expect(replayFieldView(game, play)).toMatchObject({ visualization: "pass-intercepted", turnover: true, resultLabel: "INTERCEPTION", resultState: "turnover" });
    expect(driveResultView(game, drive, play)).toMatchObject({ category: "interception", label: "INTERCEPTION", possessionChange: { teamId: "SF", ballPosition: "SF 45" } });
  });
});
