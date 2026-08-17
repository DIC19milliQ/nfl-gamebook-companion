import { describe, expect, it } from "vitest";
import { renderPlayDescription, renderPlaySections } from "../src/playDescription";
import { parsePlayDetails } from "../src/parser/playText";
import type { Play, Team } from "../src/types";

const teams: [Team, Team] = [
  { id: "DAL", name: "Dallas Cowboys", shortName: "Cowboys", homeAway: "visitor", score: 0, color: "#57a" },
  { id: "SEA", name: "Seattle Seahawks", shortName: "Seahawks", homeAway: "home", score: 0, color: "#596" },
];

function play(description: string, possession = "SEA"): Play {
  const details = parsePlayDetails(description, possession, teams);
  return {
    id: "p", index: 0, quarter: 1, clock: "10:00", down: 1, distance: 10, yardLine: `${possession} 34`, possession,
    description, rawText: description, kind: details.action.type === "field-goal" ? "field-goal" : details.action.type === "punt" ? "punt" : details.action.type === "pass" ? "pass" : details.action.type === "sack" ? "sack" : details.action.type === "rush" || details.action.type === "scramble" ? "rush" : "other",
    yards: details.action.yards ?? null, noPlay: details.penalties.some((penalty) => penalty.noPlay), playerIds: [], fieldPosition: 34, details,
    stateBefore: { quarter: 1, clock: "10:00", down: 1, distance: 10, ballPosition: `${possession} 34`, possession },
  };
}

describe("semantic Play parser and lossless Japanese renderer", () => {
  it("structures a completed pass, end position, yards, and tacklers", () => {
    const item = play("(Shotgun) D.Lock pass short left to M.Foster to DAL 4 for 5 yards (M.Bell; L.Overton).");
    expect(item.details.action).toMatchObject({ type: "pass", actor: "D.Lock", target: "M.Foster", depth: "short", direction: "left", endPosition: "DAL 4", yards: 5 });
    expect(item.details.participants.filter((participant) => participant.role === "tackler").map((participant) => participant.name)).toEqual(["M.Bell", "L.Overton"]);
    expect(renderPlayDescription(item, "ja")).toContain("DAL 4");
    expect(renderPlayDescription(item, "ja")).toContain("タックル: M.Bell / L.Overton");
  });

  it("keeps incomplete-pass parenthetical involvement and bracketed QB hit distinct", () => {
    const item = play("(Shotgun) S.Howell pass incomplete short left to A.Smith (T.Knight) [M.Morris].", "DAL");
    expect(item.details.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "T.Knight", role: "defender", source: "parenthetical" }),
      expect.objectContaining({ name: "M.Morris", role: "qb-hit", source: "bracket" }),
    ]));
    const ja = renderPlayDescription(item, "ja");
    expect(ja).toContain("守備関与: T.Knight");
    expect(ja).toContain("QBヒット: M.Morris");
  });

  it("supports rush, no gain, scramble, sack, kneel, and spike as semantic actions", () => {
    expect(play("G.Holani right tackle to DAL 18 for no gain (K.Gilliam; T.Bridges).").details.action).toMatchObject({ type: "rush", outcome: "no-gain", yards: 0 });
    expect(renderPlayDescription(play("G.Holani right tackle to DAL 18 for no gain (K.Gilliam; T.Bridges)."), "ja")).toContain("ゲインなし");
    expect(play("D.Lock scrambles left end to DAL 33 for 6 yards (C.Robinson).").details.action).toMatchObject({ type: "scramble", yards: 6 });
    expect(play("J.Milroe scrambles right end ran ob at SEA 38 for 2 yards (M.Lawrence).").details.action).toMatchObject({ type: "scramble", boundary: "out-of-bounds", endPosition: "SEA 38", yards: 2 });
    expect(renderPlayDescription(play("J.Milroe scrambles right end ran ob at SEA 38 for 2 yards (M.Lawrence)."), "ja")).toContain("SEA 38まで、2ヤード獲得、アウト・オブ・バウンズ");
    expect(play("D.Lock sacked at SEA 18 for -8 yards (M.Parsons).").details.action).toMatchObject({ type: "sack", yards: -8 });
    expect(play("J.Milton kneels to SEA 22 for -1 yards.", "DAL").details.action.type).toBe("kneel");
    expect(play("D.Lock spiked the ball to stop the clock.").details.action.type).toBe("spike");
  });

  it("preserves accepted penalty identity, type, yards, enforcement location, no-play and first-down marker", () => {
    const item = play("(Shotgun) D.Lock pass incomplete deep left to C.White. PENALTY on DAL-C.Carson, Defensive Pass Interference, 19 yards, enforced at SEA 26 - No Play. X1");
    expect(item.details.penalties).toEqual([expect.objectContaining({ teamId: "DAL", playerName: "C.Carson", type: "Defensive Pass Interference", yards: 19, enforcedAt: "SEA 26", status: "accepted", noPlay: true })]);
    expect(item.details.annotations).toContainEqual(expect.objectContaining({ kind: "official-marker", rawText: "X1" }));
    const penalty = renderPlaySections(item, "ja").find((section) => section.kind === "penalty")?.text ?? "";
    expect(penalty).toContain("DAL-C.Carson");
    expect(penalty).toContain("19ヤード");
    expect(penalty).toContain("SEA 26で適用");
    expect(penalty).toContain("ノープレー");
    expect(renderPlaySections(item, "ja").some((section) => section.label === "OFFICIAL MARKER" || section.text.includes("Gamebook marker"))).toBe(false);
  });

  it("preserves declined and offsetting penalties without inventing yardage", () => {
    const declined = play("D.Lock pass incomplete. Penalty on DAL-M.Liufau, Defensive Pass Interference, declined.");
    const offsetting = play("PENALTY on DAL-C.Carson, Holding, offsetting - No Play.");
    expect(declined.details.penalties[0]).toMatchObject({ status: "declined", yards: undefined });
    expect(offsetting.details.penalties[0]).toMatchObject({ status: "offsetting", yards: undefined, noPlay: true });
    expect(renderPlayDescription(declined, "ja")).toContain("辞退");
    expect(renderPlayDescription(offsetting, "ja")).toContain("相殺");
  });

  it("structures touchdowns, extra points, score and drive summaries", () => {
    const item = play("(Shotgun) D.Lock pass short right to M.Foster for 5 yards, TOUCHDOWN. P6 Penalty on DAL-M.Liufau, Defensive Pass Interference, declined. J.Myers extra point is GOOD, Center-C.Stoll, Holder-M.Dickson. DAL 0 SEA 7, 13 plays, 80 yards, 2 penalties, 7:18 drive, 7:18 elapsed");
    expect(item.details.events).toContainEqual(expect.objectContaining({ type: "touchdown", actor: "M.Foster" }));
    expect(item.details.scoring).toMatchObject({ extraPoint: { kicker: "J.Myers", result: "good" }, score: { visitor: 0, home: 7 }, drive: { plays: 13, yards: 80, penalties: 2, possessionTime: "7:18" } });
    const scoring = renderPlaySections(item, "ja").filter((section) => section.kind === "scoring").map((section) => section.text).join(" ");
    expect(scoring).toContain("J.Myers");
    expect(scoring).toContain("13プレー");
    expect(scoring).toContain("80ヤード");
    expect(scoring).toContain("7:18");
  });

  it("structures fumble, forced fumble, recovery and location", () => {
    const item = play("S.McGowan up the middle to SEA 1 for no gain (J.Pharms). FUMBLES (J.Saunders), RECOVERED by SEA-D.Pettus at SEA 2.", "DAL");
    expect(item.details.participants).toEqual(expect.arrayContaining([expect.objectContaining({ name: "J.Saunders", role: "forced-fumble" }), expect.objectContaining({ name: "D.Pettus", role: "recovery", teamId: "SEA" })]));
    expect(item.details.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "fumble" }), expect.objectContaining({ type: "recovery", actor: "D.Pettus", location: "SEA 2" })]));
  });

  it("covers punts, kickoffs, field goals, extra points and timeouts", () => {
    expect(play("M.Dickson punts 39 yards to DAL 26, fair catch by J.Mingo.").details.action).toMatchObject({ type: "punt", yards: 39, endPosition: "DAL 26", outcome: "fair-catch" });
    expect(play("J.Myers kicks 65 yards from SEA 35 to end zone.").details.action.type).toBe("kickoff");
    expect(play("B.Aubrey 29 yard field goal is GOOD.", "DAL").details.action).toMatchObject({ type: "field-goal", outcome: "good", yards: 29 });
    expect(play("J.Myers extra point is GOOD.").details.action.type).toBe("extra-point");
    expect(play("Timeout #1 by SEA.").details.action.type).toBe("timeout");
  });

  it("retains replay text and safely falls back to the exact English raw text", () => {
    const reviewed = play("The Replay Official reviewed the pass completion ruling, and the play was REVERSED. D.Lock pass incomplete short right to M.Foster.");
    expect(reviewed.details.events).toContainEqual(expect.objectContaining({ type: "replay", result: "reversed" }));
    expect(renderPlaySections(reviewed, "ja")).toContainEqual(expect.objectContaining({ kind: "review", text: expect.stringContaining("Replay Official") }));
    const raw = "A highly unusual lateral sequence with an official correction.";
    expect(renderPlayDescription(play(raw), "ja")).toBe(raw);
  });

  it("renders the structured portion in Japanese and preserves only an unknown suffix as RAW", () => {
    const item = play("(Shotgun) D.Lock pass incomplete short right to M.Foster. Uncatalogued sideline administration remains.");
    expect(item.details.parseStatus).toBe("partial");
    expect(item.details.unparsedText).toEqual(["Uncatalogued sideline administration remains."]);
    const sections = renderPlaySections(item, "ja");
    expect(sections).toContainEqual(expect.objectContaining({ kind: "main", text: expect.stringContaining("パスを投げるが不成功") }));
    expect(sections).toContainEqual(expect.objectContaining({ label: "RAW / UNPARSED", text: "Uncatalogued sideline administration remains.", raw: true }));
  });
});
