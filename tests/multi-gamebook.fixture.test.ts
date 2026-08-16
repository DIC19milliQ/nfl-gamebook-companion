import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractPdfPages, parseGamebook, parseGamebookPages } from "../src/parser";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

async function parseFixture(fileName: string) {
  const bytes = new Uint8Array(await readFile(new URL(`../fixtures/${fileName}`, import.meta.url)));
  return parseGamebook(bytes, fileName);
}

describe("multiple 2026 Gamebook formats", () => {
  it("parses both sides of Cowboys at Seahawks, including the split Home score baseline", async () => {
    const game = await parseFixture("cowboys-at-seahawks-2026-08-15.pdf");

    expect(game.teams.map(({ id, name, score }) => ({ id, name, score }))).toEqual([
      { id: "DAL", name: "Dallas Cowboys", score: 17 },
      { id: "SEA", name: "Seattle Seahawks", score: 7 },
    ]);
    expect(game.teamStats.find((stat) => stat.label === "TOTAL NET YARDS")).toMatchObject({ visitor: "338", home: "156" });
    expect(game.players.find((player) => player.id === "SEA-D.Lock")).toMatchObject({
      position: "QB",
      passing: { completions: 9, attempts: 13, yards: 40, touchdowns: 1, interceptions: 0, rating: 98.2 },
    });
    expect(game.players.find((player) => player.id === "DAL-S.Howell")?.passing).toMatchObject({ completions: 8, attempts: 12, yards: 94 });
    expect(game.drives.find((drive) => drive.id === "drive-SEA-1")).toMatchObject({ startPosition: "SEA 20", plays: 13, netYards: 80, result: "Touchdown" });
    expect(game.plays[0]).toMatchObject({ possession: "SEA", quarter: 1, clock: "14:52", yardLine: "SEA 20" });
    expect(game.plays.at(-1)?.description).toBe("J.Milton kneels to SEA 22 for -1 yards.");
    expect(game.validation.status).toBe("complete");
    expect(game.validation.metrics.snapCountByTeam).toEqual({ DAL: 0, SEA: 0 });
    expect(game.warnings).toEqual([]);
  });

  it("parses Home players, positions, stats and snaps symmetrically for Titans at 49ers", async () => {
    const game = await parseFixture("titans-at-49ers-2026-08-13.pdf");

    expect(game.teams.map(({ id, score }) => [id, score])).toEqual([["TEN", 19], ["SF", 13]]);
    expect(game.teamStats.find((stat) => stat.label === "TOTAL NET YARDS")).toMatchObject({ visitor: "279", home: "322" });
    expect(game.players.find((player) => player.id === "SF-A.Martinez")).toMatchObject({
      position: "QB",
      passing: { completions: 16, attempts: 30, yards: 159, touchdowns: 0, interceptions: 0, rating: 68.6 },
      snaps: { offense: { count: 51, percentage: 66 } },
    });
    expect(game.players.find((player) => player.id === "SF-K.Rourke")).toMatchObject({
      position: "QB",
      passing: { completions: 12, attempts: 14, yards: 101, rating: 96.7 },
      snaps: { offense: { count: 26, percentage: 34 } },
    });
    expect(game.players.find((player) => player.id === "TEN-C.Ward")?.snaps?.offense).toEqual({ count: 22, percentage: 36 });
    expect(game.drives.find((drive) => drive.id === "drive-SF-1")).toMatchObject({ startPosition: "SF 34", plays: 9, netYards: 24, result: "Punt" });
    expect(game.plays[0]).toMatchObject({ possession: "SF", quarter: 1, clock: "14:55", yardLine: "SF 34" });
    expect(game.validation.status).toBe("complete");
    expect(game.validation.metrics.positionCoverageByTeam.SF).toBe(1);
    expect(game.validation.metrics.snapCountByTeam).toEqual({ TEN: 85, SF: 55 });
    expect(game.warnings).toEqual([]);
  });

  it("marks a one-sided snap extraction as partial instead of silently accepting zeroes", async () => {
    const fileName = "titans-at-49ers-2026-08-13.pdf";
    const bytes = new Uint8Array(await readFile(new URL(`../fixtures/${fileName}`, import.meta.url)));
    const pages = await extractPdfPages(bytes);
    for (const page of pages.slice(pages.findIndex((candidate) => candidate.text.includes("Playtime Percentage")))) {
      const split = page.width / 2;
      for (const line of page.lines) {
        if (!line.text.includes("Offense") && !line.text.includes("Defense")) {
          line.items = line.items.filter((item) => item.x < split);
        }
        line.text = line.items.map((item) => item.text).join(" ");
      }
      page.text = page.lines.map((line) => line.text).join("\n");
    }

    const game = parseGamebookPages(pages, fileName);
    expect(game.validation.status).toBe("partial");
    expect(game.validation.issues).toContainEqual(expect.objectContaining({ code: "snaps-one-sided", teamId: "SF", severity: "error" }));
    expect(game.warnings.join(" ")).toContain("snap table was not parsed");
  });
});
