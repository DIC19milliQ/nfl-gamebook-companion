import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseGamebook } from "../src/parser";
import { fieldView, replayFieldView } from "../src/field";
import { renderPlayDescription } from "../src/playDescription";
import type { GameData, PlaySequenceEvent } from "../src/types";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

function relevant(play: { details: { sequence: PlaySequenceEvent[] } }) {
  return play.details.sequence.filter((event) => !["raw", "official-marker", "defense", "kick-crew", "touchdown"].includes(event.type));
}

describe("real Gamebook event sequence regressions", () => {
  let titans: GameData;
  let cowboys: GameData;

  beforeAll(async () => {
    const load = async (fileName: string) => parseGamebook(new Uint8Array(await readFile(new URL(`../fixtures/${fileName}`, import.meta.url))), fileName);
    [titans, cowboys] = await Promise.all([load("titans-at-49ers-2026-08-13.pdf"), load("cowboys-at-seahawks-2026-08-15.pdf")]);
  });

  it("keeps TD, XP, drive summary, and kickoff penalty in occurrence order and phase", () => {
    const play = titans.plays.find((item) => item.clock === "4:46" && item.quarter === 1)!;
    const events = relevant(play);
    const touchdownAction = events.find((event) => event.type === "action" && play.details.actions[event.actionIndex!].type === "rush")!;
    const extraPoint = events.find((event) => event.type === "action" && play.details.actions[event.actionIndex!].type === "extra-point")!;
    const drive = events.find((event) => event.type === "drive-summary")!;
    const kickoffPenalty = events.find((event) => event.type === "penalty")!;
    expect([touchdownAction.phase, extraPoint.phase, drive.phase, kickoffPenalty.phase]).toEqual(["scrimmage", "try", "try", "kickoff"]);
    const orders = [touchdownAction.order, extraPoint.order, drive.order, kickoffPenalty.order];
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("retains challenge, upheld result, ruling stands, timeout, and J.Jones injury update", () => {
    const play = titans.plays.find((item) => item.clock === "10:21" && item.quarter === 2)!;
    const types = relevant(play).map((event) => `${event.type}:${event.result ?? ""}`);
    expect(types).toEqual(expect.arrayContaining(["review:", "review-result:upheld", "review-result:stands", "timeout:", "injury-update:"]));
    expect(types.indexOf("review:")).toBeLessThan(types.indexOf("review-result:upheld"));
    expect(types.indexOf("review-result:stands")).toBeLessThan(types.indexOf("timeout:"));
    expect(play.details.reviews[0]).toMatchObject({ source: "team-challenge", teamId: "TEN", result: "upheld", ruling: "stands", timeoutNumber: 1 });
    expect(play.details.injuryUpdates[0]).toMatchObject({ teamId: "SF", player: "J.Jones", status: "is Out of the game" });
    expect(renderPlayDescription(play, "ja")).toContain("SF · J.Jones — Out");
  });

  it("models provisional and final rulings while merging only review-restated penalties", () => {
    const play = titans.plays.find((item) => item.clock === "8:51" && item.quarter === 2)!;
    const actionEvents = play.details.sequence.filter((event) => event.type === "action");
    expect(actionEvents.map((event) => event.ruling)).toEqual(["provisional", "final"]);
    expect(play.details.action).toMatchObject({ type: "pass", outcome: "incomplete", target: "P.Taylor" });
    expect(play.details.penalties).toHaveLength(2);
    expect(play.details.penalties.map((penalty) => penalty.occurrences?.length)).toEqual([2, 2]);
    expect(play.details.penalties.every((penalty) => penalty.repeatedAfterReview)).toBe(true);
    expect(play.details.sequence.filter((event) => event.type === "penalty")).toHaveLength(4);
    expect(renderPlayDescription(play, "ja").match(/重複計上していません/g)).toHaveLength(2);
  });

  it("keeps a fumble, recovery, and subsequent pass as multiple ordered actions", () => {
    const play = titans.plays.find((item) => item.clock === "4:03" && item.quarter === 2)!;
    expect(play.details.actions).toHaveLength(2);
    expect(play.details.actions.map((action) => action.type)).toEqual(["advance", "pass"]);
    expect(play.details.actions[1]).toMatchObject({ actor: "A.Martinez", target: "J.Watkins", outcome: "incomplete" });
    const types = relevant(play).map((event) => event.type);
    expect(types.indexOf("action")).toBeLessThan(types.indexOf("fumble"));
    expect(types.indexOf("recovery")).toBeLessThan(types.lastIndexOf("action"));
    expect(play.details.participants).toContainEqual(expect.objectContaining({ name: "K.Faulk", role: "qb-hit" }));
    expect(play.details.officialEndPosition).toBe("TEN 44");
  });

  it("parses compound formation, sack out of bounds, and no gain without whole-entry fallback", () => {
    const noHuddle = titans.plays.find((item) => item.clock === "1:28" && item.quarter === 2)!;
    const sack = titans.plays.find((item) => item.clock === "0:24" && item.quarter === 2)!;
    const noGain = titans.plays.find((item) => item.clock === "7:34" && item.quarter === 1)!;
    expect(noHuddle.details.action.formation).toEqual(["No Huddle", "Shotgun"]);
    expect(renderPlayDescription(noHuddle, "ja")).toContain("ノーハドル・ショットガン");
    expect(sack.details.action).toMatchObject({ type: "sack", boundary: "out-of-bounds", endPosition: "TEN 43", yards: -14 });
    expect(sack.details.participants).toContainEqual(expect.objectContaining({ name: "J.Holmes", role: "sacker" }));
    expect(noGain.details.action).toMatchObject({ outcome: "no-gain", yards: 0 });
    expect([noHuddle, sack, noGain].every((item) => item.details.parseStatus !== "raw")).toBe(true);
  });

  it("draws certain start/final spots in fixed-team coordinates for both possessions", () => {
    const homeSack = titans.plays.find((item) => item.clock === "0:24" && item.quarter === 2)!;
    const visitorMultiAction = cowboys.plays.find((item) => item.clock === "6:32" && item.quarter === 4)!;
    expect(fieldView(titans, homeSack)).toMatchObject({ direction: "left", startPosition: "TEN 29", finalPosition: "TEN 43", movementYards: -14 });
    expect(fieldView(cowboys, visitorMultiAction)).toMatchObject({ direction: "right", startPosition: "DAL 15", finalPosition: "DAL 23", movementYards: 8 });
    expect(fieldView(titans, homeSack).startPercent).toBeLessThan(fieldView(titans, homeSack).endPercent!);
    expect(fieldView(cowboys, visitorMultiAction).startPercent).toBeLessThan(fieldView(cowboys, visitorMultiAction).endPercent!);
  });

  it("retains accepted and declined penalty dispositions", () => {
    const kickoff = titans.plays.find((item) => item.clock === "4:46" && item.quarter === 1)!;
    const reviewed = titans.plays.find((item) => item.clock === "8:51" && item.quarter === 2)!;
    expect(kickoff.details.penalties[0]).toMatchObject({ status: "accepted", phase: "kickoff", enforcedAt: "SF 40" });
    expect(reviewed.details.penalties.map((penalty) => penalty.status).sort()).toEqual(["accepted", "declined"]);
  });

  it("builds football-specific replay views for incomplete, touchdown, and field goals", () => {
    const incomplete = titans.plays.find((item) => item.quarter === 1 && item.clock === "6:57")!;
    const touchdown = titans.plays.find((item) => item.quarter === 1 && item.clock === "4:46")!;
    const fieldGoal = titans.plays.find((item) => item.quarter === 4 && item.clock === "0:51")!;
    const missed = titans.plays.find((item) => item.quarter === 2 && item.clock === "0:18")!;
    expect(replayFieldView(titans, incomplete)).toMatchObject({ mode: "no-movement", visualization: "pass-incomplete", finalSource: "state-after", startPosition: "TEN 47", displayFinalPosition: "TEN 47", resultLabel: "INCOMPLETE · 0 YARDS", resultState: "incomplete" });
    expect(replayFieldView(titans, touchdown)).toMatchObject({ mode: "touchdown", startPosition: "SF 5", displayFinalPosition: "END ZONE", displayMovementYards: 5, phases: expect.arrayContaining([expect.objectContaining({ label: "XP", result: "GOOD" }), expect.objectContaining({ label: "KICKOFF", result: "OUT OF BOUNDS", position: "SF 40" })]) });
    expect(replayFieldView(titans, fieldGoal)).toMatchObject({ mode: "field-goal", resultLabel: "FIELD GOAL · GOOD", fieldGoal: { outcome: "good", distance: 41 } });
    expect(replayFieldView(titans, missed)).toMatchObject({ mode: "field-goal", resultLabel: "FIELD GOAL · MISSED", fieldGoal: { outcome: "missed", distance: 61 } });
  });

  it("distinguishes run, completed pass, sack, and retained fumble on the Titans fixture", () => {
    const run = titans.plays.find((item) => item.quarter === 1 && item.clock === "7:34")!;
    const pass = titans.plays.find((item) => item.quarter === 1 && item.clock === "14:55")!;
    const sack = titans.plays.find((item) => item.quarter === 2 && item.clock === "0:24")!;
    const retainedFumble = titans.plays.find((item) => item.quarter === 2 && item.clock === "4:03")!;
    expect(replayFieldView(titans, run)).toMatchObject({ visualization: "run", playDirection: "UP THE MIDDLE", resultLabel: "NO GAIN · 0 YARDS", resultState: "no-gain" });
    expect(replayFieldView(titans, pass)).toMatchObject({ visualization: "pass-complete", playDirection: "SHORT LEFT", resultLabel: "+6 YARDS", resultState: "positive" });
    expect(replayFieldView(titans, sack)).toMatchObject({ visualization: "sack", resultLabel: "-14 YARDS", resultState: "negative" });
    expect(replayFieldView(titans, retainedFumble)).toMatchObject({ visualization: "pass-incomplete", turnover: false, resultLabel: "INCOMPLETE · 0 YARDS" });
  });
});
