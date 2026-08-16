import { describe, expect, it } from "vitest";
import { renderPlayDescription } from "../src/playDescription";
import type { Play } from "../src/types";

function play(description: string, kind: Play["kind"]): Play {
  return { id: "p", index: 0, quarter: 1, clock: "10:00", down: 1, distance: 10, yardLine: "SF 34", possession: "SF", description, rawText: description, kind, yards: null, noPlay: false, playerIds: [], fieldPosition: 34 };
}

describe("rule-based Japanese play renderer", () => {
  it("renders a structured completed pass", () => {
    expect(renderPlayDescription(play("(Shotgun) K.Rourke pass short left to D.Stribling to SF 40 for 6 yards (A.Taylor).", "pass"), "ja"))
      .toBe("ショットガンから、K.RourkeからD.Striblingへ左へのショートパス成功、6ヤード獲得");
  });

  it("renders a rush and touchdown without an API", () => {
    expect(renderPlayDescription(play("T.Pollard right tackle to SF 5 for 5 yards, TOUCHDOWN.", "touchdown"), "ja"))
      .toBe("T.Pollardが右タックルをラン、5ヤード獲得。タッチダウン");
  });

  it("falls back exactly to the English raw description when grammar is unknown", () => {
    const raw = "A highly unusual lateral sequence with an official correction.";
    expect(renderPlayDescription(play(raw, "other"), "ja")).toBe(raw);
  });
});
