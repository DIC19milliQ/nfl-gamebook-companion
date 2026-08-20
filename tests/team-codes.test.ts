import { describe, expect, it } from "vitest";
import { absoluteYardLine, fieldView, replayFieldView } from "../src/field";
import { fieldPosition } from "../src/parser/gamebook";
import { parsePlayDetails } from "../src/parser/playText";
import { normalizeGamebookTeamCode } from "../src/teamCodes";
import type { GameData, Play, Team } from "../src/types";

const alternateCodePairs = [
  ["ARI", "ARZ"],
  ["BAL", "BLT"],
  ["CLE", "CLV"],
  ["HOU", "HST"],
] as const;

function gameWith(visitorId: string, homeId: string) {
  const teams: [Team, Team] = [
    { id: visitorId, name: `${visitorId} visitor`, shortName: visitorId, homeAway: "visitor", score: 0, color: "#111" },
    { id: homeId, name: `${homeId} home`, shortName: homeId, homeAway: "home", score: 0, color: "#222" },
  ];
  return { teams } as GameData;
}

function playFor(game: GameData, possession: string, start: string, description: string, final: string): Play {
  const details = parsePlayDetails(description, possession, game.teams, start);
  return {
    id: "play", index: 0, quarter: 1, clock: "10:00", down: 3, distance: 1,
    yardLine: start, possession, description, rawText: description, kind: "rush", yards: 10,
    noPlay: false, playerIds: [], fieldPosition: fieldPosition(start, possession), details,
    stateBefore: { quarter: 1, clock: "10:00", down: 3, distance: 1, ballPosition: start, possession },
    stateAfter: { quarter: 1, clock: "9:50", down: 1, distance: 10, ballPosition: final, possession },
  } as Play;
}

describe("Gamebook team-code normalization", () => {
  it.each(alternateCodePairs)("normalizes current Gamebook code %s / %s without rewriting normal codes", (internalId, gamebookCode) => {
    expect(normalizeGamebookTeamCode(gamebookCode)).toBe(internalId);
    expect(normalizeGamebookTeamCode(internalId)).toBe(internalId);
  });

  it.each([["LV"], ["TEN"]] as const)("leaves matching current codes unchanged: %s", (code) => {
    expect(normalizeGamebookTeamCode(code)).toBe(code);
  });

  it.each(alternateCodePairs)("maps %s Gamebook positions correctly on either side and at midfield", (internalId, gamebookCode) => {
    const game = gameWith("LV", internalId);
    expect(absoluteYardLine(`${gamebookCode} 25`, game)).toBe(75);
    expect(absoluteYardLine("LV 25", game)).toBe(25);
    expect(absoluteYardLine("50", game)).toBe(50);
    expect(fieldPosition(`${gamebookCode} 25`, internalId)).toBe(25);
    expect(fieldPosition("LV 25", internalId)).toBe(75);
    expect(fieldPosition("50", internalId)).toBe(50);
  });

  it("keeps ARZ source text while rendering the Raiders' ARZ 46 to ARZ 36 gain", () => {
    const game = gameWith("LV", "ARI");
    const start = "ARZ 46", final = "ARZ 36";
    const play = playFor(game, "LV", start, "A.Jeanty left guard to ARZ 36 for 10 yards.", final);
    const watchAlong = fieldView(game, play);
    const replay = replayFieldView(game, play);

    expect(play.yardLine).toBe(start);
    expect(play.stateBefore.ballPosition).toBe(start);
    expect(play.details.action.endPosition).toBe(final);
    expect(play.details.officialEndPosition).toBe(final);
    expect(watchAlong).toMatchObject({ startPosition: start, finalPosition: final, movementYards: 10 });
    expect(replay).toMatchObject({ startPosition: start, displayFinalPosition: final, displayMovementYards: 10 });
    expect(watchAlong.startPercent).toBeLessThan(watchAlong.endPercent!);
    expect(replay.displayFinalPercent).toBeGreaterThan(replay.startPercent!);
  });

  it("normalizes alias codes used in action, spot, recovery, and enforcement locations without changing their text", () => {
    const game = gameWith("LV", "HOU");
    const play = playFor(game, "LV", "HST 40", "A.Runner left guard to HST 30 for 10 yards. PENALTY on HST-D.Player, Offside, 5 yards, enforced at HST 35. A.Runner FUMBLES, RECOVERED by HST-D.Player at HST 30.", "HST 35");
    const view = replayFieldView(game, play);

    expect(play.details.actions[0].endPosition).toBe("HST 30");
    expect(play.details.penalties[0].enforcedAt).toBe("HST 35");
    expect(play.details.events).toContainEqual(expect.objectContaining({ type: "recovery", teamId: "HOU", location: "HST 30" }));
    expect(play.details.spots.map((spot) => spot.position)).toEqual(expect.arrayContaining(["HST 40", "HST 30", "HST 35"]));
    expect(view.displayFinalPosition).toBe("HST 35");
    expect(view.displayFinalPercent).toBeGreaterThan(view.startPercent!);
  });

  it("uses an HST stateAfter ball position for a no-movement replay without rewriting it", () => {
    const game = gameWith("LV", "HOU");
    const play = playFor(game, "LV", "HST 18", "A.Runner pass incomplete.", "HST 18");
    const view = replayFieldView(game, play);

    expect(play.stateBefore.ballPosition).toBe("HST 18");
    expect(play.stateAfter?.ballPosition).toBe("HST 18");
    expect(view).toMatchObject({ finalSource: "state-after", displayFinalPosition: "HST 18", displayMovementYards: 0 });
  });
});
