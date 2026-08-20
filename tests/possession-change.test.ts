import { describe, expect, it } from "vitest";
import { parsePlayDetails } from "../src/parser/playText";
import { renderPlayDescription, renderPlaySections } from "../src/playDescription";
import { fieldPercent, replayFieldView } from "../src/field";
import type { GameData, Play, Team } from "../src/types";

function teams(visitor: string, home: string): [Team, Team] {
  return [
    { id: visitor, name: visitor, shortName: visitor, homeAway: "visitor", score: 0, color: "#3b82f6" },
    { id: home, name: home, shortName: home, homeAway: "home", score: 0, color: "#ef4444" },
  ];
}

function play(description: string, possession: string, ballPosition: string, pair: [Team, Team]): Play {
  const details = parsePlayDetails(description, possession, pair, ballPosition);
  return {
    id: "target", index: 0, quarter: 4, clock: "0:03", down: 4, distance: 3, yardLine: ballPosition, possession,
    description, rawText: description, kind: details.events.some((event) => event.type === "touchdown") ? "touchdown" : details.action.type === "field-goal" ? "field-goal" : "turnover",
    yards: details.action.yards ?? null, noPlay: false, playerIds: [], fieldPosition: null, details,
    stateBefore: { quarter: 4, clock: "0:03", down: 4, distance: 3, ballPosition, possession },
  };
}

describe("multi-phase possession change plays", () => {
  it("structures an interception spot, possession change, and 35-yard return", () => {
    const pair = teams("SEA", "NE");
    const item = play("(No Huddle, Shotgun) D.Maye pass deep middle intended for K.Williams INTERCEPTED by J.Love at SEA 27. J.Love pushed ob at NE 38 for 35 yards (T.Henderson).", "NE", "NE 44", pair);
    expect(item.details.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "pass", outcome: "interception", endPosition: "SEA 27", teamId: "NE" }),
      expect.objectContaining({ type: "return", actor: "J.Love", teamId: "SEA", startPosition: "SEA 27", endPosition: "NE 38", yards: 35 }),
    ]));
    expect(item.details.sequence).toContainEqual(expect.objectContaining({ type: "possession-change", teamId: "SEA", location: "SEA 27" }));
    expect(item.details.parseStatus).toBe("structured");
    expect(renderPlayDescription(item, "ja")).toContain("35ヤード獲得");
    expect(renderPlaySections(item, "ja").some((section) => section.raw)).toBe(false);
    const view = replayFieldView({ teams: pair } as GameData, item);
    expect(view).toMatchObject({ visualization: "pass-intercepted", resultLabel: "INTERCEPTION RETURN · 35 YARDS", possessionChange: { teamId: "SEA", position: "SEA 27", direction: "right" }, returnPath: { teamId: "SEA", yards: 35, direction: "right" } });
    expect(view.returnPath!.endPercent).toBeGreaterThan(view.returnPath!.startPercent);
  });

  it.each([
    ["SEA", "NE", "NE", "SEA 44", "(No Huddle, Shotgun) D.Maye pass short middle intended for K.Boutte INTERCEPTED by U.Nwosu (D.Witherspoon) [D.Witherspoon] at NE 45. U.Nwosu for 45 yards, TOUCHDOWN.", "SEA", 45],
    ["NYJ", "TB", "NYJ", "NYJ 45", "(Shotgun) T.Taylor pass short left intended for G.Wilson INTERCEPTED by J.Dean at TB 45. J.Dean for 55 yards, TOUCHDOWN.", "TB", 55],
  ])("sends an interception return TD toward the interceptor team's end zone", (visitor, home, possession, spot, description, scoringTeam, yards) => {
    const pair = teams(visitor, home), item = play(description, possession, spot, pair);
    const view = replayFieldView({ teams: pair } as GameData, item);
    expect(view).toMatchObject({ mode: "touchdown", visualization: "pass-intercepted", resultLabel: "INTERCEPTION RETURN · TOUCHDOWN", returnPath: { teamId: scoringTeam, yards, touchdown: true } });
    expect(view.displayFinalPercent).toBe(fieldPercent(scoringTeam === visitor ? 100 : 0));
    expect(renderPlaySections(item, "ja").some((section) => section.raw)).toBe(false);
  });

  it("structures blocked field goal recovery and return touchdown", () => {
    const pair = teams("LA", "PHI");
    const item = play("J.Karty 44 yard field goal is BLOCKED (J.Davis), Center-A.Ward, Holder-E.Evans, RECOVERED by PHI-J.Davis at PHI 39. J.Davis for 61 yards, TOUCHDOWN.", "LA", "PHI 26", pair);
    expect(item.details.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "field-goal", outcome: "blocked", teamId: "LA" }),
      expect.objectContaining({ type: "return", actor: "J.Davis", teamId: "PHI", startPosition: "PHI 39", yards: 61, outcome: "touchdown" }),
    ]));
    expect(item.details.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "block", actor: "J.Davis" }), expect.objectContaining({ type: "recovery", teamId: "PHI", location: "PHI 39" })]));
    const view = replayFieldView({ teams: pair } as GameData, item);
    expect(view).toMatchObject({ mode: "touchdown", visualization: "blocked-field-goal", resultLabel: "BLOCKED FG RETURN · TOUCHDOWN", blockedKick: { blocker: "J.Davis", recoveryTeamId: "PHI", recoveryPosition: "PHI 39" }, returnPath: { teamId: "PHI", direction: "left", yards: 61 } });
    expect(view.displayFinalPercent).toBe(fieldPercent(0));
    expect(renderPlaySections(item, "ja").some((section) => section.raw)).toBe(false);
  });

  it("keeps a blocked field goal self-recovery distinct and preserves the certain recovery spot", () => {
    const pair = teams("LA", "PHI");
    const description = "J.Karty 36 yard field goal is BLOCKED (J.Carter), Center-A.Ward, Holder-E.Evans, recovered by LA-J.Karty at PHI 24. PENALTY on PHI-J.Carter, Unnecessary Roughness, 9 yards, enforced between downs. Incomplete Pass by 16-J.Karty after Blocked Kick Recovery.";
    const item = play(description, "LA", "PHI 18", pair), view = replayFieldView({ teams: pair } as GameData, item);
    expect(view).toMatchObject({ mode: "blocked-kick", resultLabel: "BLOCKED FG · RECOVERED BY LA", displayFinalPosition: "PHI 24", blockedKick: { recoveryTeamId: "LA", recoveryPosition: "PHI 24" } });
    expect(view.possessionChange).toBeUndefined();
    expect(item.details.penalties[0]).toMatchObject({ enforcement: "between-downs", status: "accepted" });
    expect(renderPlaySections(item, "ja").some((section) => section.raw)).toBe(false);
  });

  it("uses the same possession-transition model for an ordinary punt return", () => {
    const pair = teams("LA", "PHI");
    const item = play("B.Mann punts 42 yards to LA 43, Center-C.Hughlett. X.Smith to PHI 48 for 9 yards (M.Epps).", "PHI", "PHI 15", pair);
    expect(item.details.actions).toContainEqual(expect.objectContaining({ type: "return", actor: "X.Smith", teamId: "LA", startPosition: "LA 43", endPosition: "PHI 48", yards: 9 }));
  });
});
