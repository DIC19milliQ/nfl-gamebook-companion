import { describe, expect, it } from "vitest";
import { planReplayFieldLayout } from "../src/replayLayout";

const base = {
  visualization: "pass-complete",
  visualizationLabel: "PASS COMPLETE",
  playDirection: "SHORT LEFT",
  direction: "right" as const,
  startPercent: 42,
  primaryEndPercent: 58,
  displayFinalPercent: 58,
  actionEndPercent: 58,
  firstDownPercent: 50,
  noMovement: false,
  turnover: false,
};

describe("replay field annotation planner", () => {
  it("keeps every complete-pass endpoint on the START/FINAL centerline", () => {
    const layout = planReplayFieldLayout(base);
    expect(layout.pathY).toBe(50);
    expect(layout.passApexY).not.toBe(50);
  });

  it("does not map Gamebook left/right wording to a screen lane", () => {
    const left = planReplayFieldLayout({ ...base, playDirection: "SHORT LEFT" });
    const right = planReplayFieldLayout({ ...base, playDirection: "SHORT RIGHT" });
    expect(right.pathY).toBe(left.pathY);
    expect(right.passApexY).toBe(left.passApexY);
  });

  it("separates close START and FINAL labels onto different rails", () => {
    const layout = planReplayFieldLayout({ ...base, primaryEndPercent: 45, displayFinalPercent: 45, actionEndPercent: 45 });
    expect(layout.start.lane).not.toBe(layout.final.lane);
  });

  it("keeps the broadcast marker away from the central run route", () => {
    const layout = planReplayFieldLayout({ ...base, visualization: "run", visualizationLabel: "QB SCRAMBLE", playDirection: "RIGHT END" });
    expect(layout.pathY).toBe(50);
    expect(["top", "bottom"]).toContain(layout.situation.lane);
    expect(layout.situation.x).not.toBe(base.startPercent);
  });
});
