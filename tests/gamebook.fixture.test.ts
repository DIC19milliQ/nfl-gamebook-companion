import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseGamebook } from "../src/parser";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

const fixture = new URL("../fixtures/colts-at-patriots-2026-08-13.pdf", import.meta.url);

describe("2026 Colts at Patriots Gamebook", () => {
  it("parses and links the required regression values from the PDF", async () => {
    const bytes = new Uint8Array(await readFile(fixture));
    const game = await parseGamebook(bytes, "colts-at-patriots-2026-08-13.pdf");

    expect(game.teams.map((team) => [team.id, team.score])).toEqual([["IND", 13], ["NE", 13]]);
    expect(game.teamStats.find((stat) => stat.label === "TOTAL NET YARDS")).toMatchObject({ visitor: "355", home: "275" });

    const richardson = game.players.find((player) => player.name === "A.Richardson" && player.teamId === "IND");
    expect(richardson?.passing).toMatchObject({ completions: 11, attempts: 14, yards: 145, touchdowns: 0, interceptions: 1, rating: 80.1 });
    expect(richardson?.rushing).toMatchObject({ attempts: 6, yards: 53, touchdowns: 1 });
    expect(richardson?.snaps?.offense).toEqual({ count: 27, percentage: 42 });
    expect(game.players.find((player) => player.name === "R.Leonard" && player.teamId === "IND")?.snaps?.offense).toEqual({ count: 38, percentage: 58 });

    const firstColtsDrive = game.drives.find((drive) => drive.teamId === "IND" && drive.teamDriveNumber === 1);
    expect(firstColtsDrive).toMatchObject({ startPosition: "IND 38", plays: 5, netYards: 29, result: "Interception" });
    const firstDrivePlays = game.plays.filter((play) => firstColtsDrive?.playIds.includes(play.id));
    expect(firstDrivePlays).toHaveLength(5);
    expect(firstDrivePlays.at(-1)?.description).toContain("A.Richardson");
    expect(firstDrivePlays.at(-1)?.description).toContain("INTERCEPTED");

    expect(game.scoring.filter((score) => score.teamId === "IND").map((score) => [score.quarter, score.clock, score.description])).toEqual([
      [2, "1:04", expect.stringContaining("A.Richardson 1 yd. run")],
      [4, "7:21", expect.stringContaining("S.Shrader 46 yd. Field Goal")],
      [4, "1:16", expect.stringContaining("S.Shrader 61 yd. Field Goal")],
    ]);
    expect(game.scoring.every((score) => score.playIndex >= 0)).toBe(true);
    expect(game.plays.at(-1)?.description).toBe("(Shotgun) R.Leonard pass incomplete deep right.");
    expect(game.plays.filter((play) => play.description.includes("S.Shrader"))).toHaveLength(2);
    expect(game.warnings).toEqual([]);
  });
});
