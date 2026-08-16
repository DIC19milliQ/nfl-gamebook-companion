import { describe, expect, it } from "vitest";
import { absoluteYardLine, attackDirection, fieldPercent, fieldView } from "../src/field";
import type { GameData, Play, Team } from "../src/types";

const teams: [Team, Team] = [
  { id: "DAL", name: "Dallas Cowboys", shortName: "Cowboys", homeAway: "visitor", score: 0, color: "#57a" },
  { id: "SEA", name: "Seattle Seahawks", shortName: "Seahawks", homeAway: "home", score: 0, color: "#596" },
];
const game = { teams } as GameData;
const base = { quarter: 1, clock: "10:00", down: 1, distance: 6, possession: "SEA", description: "", rawText: "", kind: "rush", yards: 0, noPlay: false, playerIds: [], details: { formation: [], action: { type: "other", rawText: "" }, participants: [], penalties: [], events: [], annotations: [], parseStatus: "raw", unparsedText: [] }, stateBefore: { quarter: 1, clock: "10:00", down: 1, distance: 6, ballPosition: "DAL 4", possession: "SEA" } } as const;

describe("fixed-team field model", () => {
  it("keeps visitor territory on the left and home territory on the right", () => {
    expect(absoluteYardLine("DAL 4", game)).toBe(4);
    expect(absoluteYardLine("SEA 4", game)).toBe(96);
    expect(fieldPercent(4)).toBeCloseTo(13.2);
  });

  it("reverses attack direction with possession and places first-down marker accordingly", () => {
    const seaPlay = { ...base, id: "p1", index: 0, yardLine: "DAL 4", fieldPosition: 96 } as unknown as Play;
    const dalPlay = { ...base, id: "p2", index: 1, possession: "DAL", yardLine: "SEA 20", fieldPosition: 80, stateBefore: { ...base.stateBefore, possession: "DAL", ballPosition: "SEA 20" } } as unknown as Play;
    expect(attackDirection("SEA", game)).toBe("left");
    expect(attackDirection("DAL", game)).toBe("right");
    expect(fieldView(game, seaPlay)).toMatchObject({ direction: "left", ballPercent: 13.2, firstDownPercent: 10 });
    expect(fieldView(game, dalPlay)).toMatchObject({ direction: "right", ballPercent: 74, firstDownPercent: 78.8 });
  });
});
