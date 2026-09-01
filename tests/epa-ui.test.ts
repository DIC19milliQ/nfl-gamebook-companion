import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { formatEpa, formatProbabilityPoints, formatWinProbability, formatYards } from "../src/analytics/nflverse/format";

describe("per-play EPA presentation", () => {
  it("formats positive, negative, and true-zero values with an explicit EPA sign", () => {
    expect(formatEpa(1.24)).toBe("+1.24");
    expect(formatEpa(-0.31)).toBe("-0.31");
    expect(formatEpa(0)).toBe("+0.00");
    expect(formatEpa(Number.NaN)).toBeNull();
  });

  it("formats Air/YAC, current WP, and WPA units without changing their meaning", () => {
    expect(formatYards(-2)).toBe("-2 yd");
    expect(formatYards(8.5)).toBe("8.5 yd");
    expect(formatWinProbability(0.684)).toBe("68%");
    expect(formatProbabilityPoints(11.84)).toBe("+11.8 pts");
  });

  it("keeps EPA outside Play and gates every badge at the spoiler cursor", async () => {
    const [app, types, styles] = await Promise.all([
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/types.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ]);
    const playInterface = types.slice(types.indexOf("export interface Play {"), types.indexOf("export interface Drive {"));
    expect(playInterface).not.toMatch(/\bepa\b/i);
    expect(app).toMatch(/visibleThrough: spoiler \? safeCursor : null/);
    expect(app).toMatch(/if \(visibleThrough !== null && play\.index > visibleThrough\) return null/);
    expect(app).toMatch(/AdvancedAnalyticsPanel game=\{game\} play=\{current\}/);
    expect(app).toMatch(/PlayResult game=\{game\} play=\{revealed\}/);
    expect(app).toMatch(/AdvancedAnalyticsPanel game=\{game\} play=\{revealed\}/);
    expect(app).toMatch(/AFTER THIS PLAY/);
    expect(app).toMatch(/NOT A ROUTE MAP/);
    expect(styles).toMatch(/\.epa-badge/);
    expect(styles).toMatch(/\.advanced-analytics-panel/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.play-result-primary/);
  });

  it("defaults analytics off, makes no PBP request on Gamebook load, and clears it per game", async () => {
    const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
    const autoLoad = app.slice(app.indexOf("if (!autoGameId || autoLoadStarted.current)"), app.indexOf("}, [autoGameId, loadBytes]);"));
    expect(app).toMatch(/useState\(false\).*advancedAnalytics|\[advancedAnalytics, setAdvancedAnalytics\] = useState\(false\)/);
    expect(autoLoad).not.toMatch(/fetchNflversePbp|requestNflversePbp/);
    expect(app).toMatch(/if \(!automatic\) \{ setRemoteGameId\(""\); setNflversePayload\(null\); \}/);
    expect(app).toMatch(/if \(!advancedAnalytics \|\| !remoteGameId\)/);
    expect(app).toMatch(/setAdvancedAnalytics\(false\)/);
    expect(app).toMatch(/AdvancedAnalyticsControl/);
  });
});
