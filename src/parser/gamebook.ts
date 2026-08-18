import type {
  DefensiveStats,
  Drive,
  GameData,
  PassingStats,
  PdfLine,
  Play,
  PlayKind,
  ParseValidation,
  ParseValidationIssue,
  Player,
  RawPage,
  ReceivingStats,
  RushingStats,
  ScoringPlay,
  SnapUnit,
  Team,
  TeamId,
  TeamStat,
} from "../types";
import { parsePlayDetails } from "./playText";

const PLAYER_RE = /\b[A-Z][a-z]?\.[A-Z][A-Za-z'-]*(?:-[A-Za-z]+)*/g;
const PLAYER_EXACT_RE = /^[A-Z][a-z]?\.[A-Z][A-Za-z'-]*(?:-[A-Za-z]+)*$/;
const POSITION_RE = /^(?:QB|RB|FB|WR|TE|C|G|T|OL|LT|LG|RG|RT|DL|DE|DT|NT|LB|ILB|OLB|CB|DB|S|FS|SS|K|P|LS)$/;
const TEAM_INFO: Record<string, { id: TeamId; short: string; color: string }> = {
  "Arizona Cardinals": { id: "ARI", short: "Cardinals", color: "#97233f" },
  "Atlanta Falcons": { id: "ATL", short: "Falcons", color: "#a71930" },
  "Baltimore Ravens": { id: "BAL", short: "Ravens", color: "#4f2683" },
  "Buffalo Bills": { id: "BUF", short: "Bills", color: "#00338d" },
  "Carolina Panthers": { id: "CAR", short: "Panthers", color: "#0085ca" },
  "Chicago Bears": { id: "CHI", short: "Bears", color: "#c83803" },
  "Cincinnati Bengals": { id: "CIN", short: "Bengals", color: "#fb4f14" },
  "Cleveland Browns": { id: "CLE", short: "Browns", color: "#ff3c00" },
  "Dallas Cowboys": { id: "DAL", short: "Cowboys", color: "#4f6d8a" },
  "Denver Broncos": { id: "DEN", short: "Broncos", color: "#fb4f14" },
  "Detroit Lions": { id: "DET", short: "Lions", color: "#0076b6" },
  "Green Bay Packers": { id: "GB", short: "Packers", color: "#1f5a43" },
  "Houston Texans": { id: "HOU", short: "Texans", color: "#03202f" },
  "Indianapolis Colts": { id: "IND", short: "Colts", color: "#2f6da3" },
  "Jacksonville Jaguars": { id: "JAX", short: "Jaguars", color: "#0080a0" },
  "Kansas City Chiefs": { id: "KC", short: "Chiefs", color: "#e31837" },
  "Las Vegas Raiders": { id: "LV", short: "Raiders", color: "#7a7d80" },
  "Los Angeles Chargers": { id: "LAC", short: "Chargers", color: "#0080c6" },
  "Los Angeles Rams": { id: "LAR", short: "Rams", color: "#3158a6" },
  "Miami Dolphins": { id: "MIA", short: "Dolphins", color: "#008e97" },
  "Minnesota Vikings": { id: "MIN", short: "Vikings", color: "#4f2683" },
  "New England Patriots": { id: "NE", short: "Patriots", color: "#c83943" },
  "New Orleans Saints": { id: "NO", short: "Saints", color: "#b2955a" },
  "New York Giants": { id: "NYG", short: "Giants", color: "#0b4aa2" },
  "New York Jets": { id: "NYJ", short: "Jets", color: "#34715a" },
  "Philadelphia Eagles": { id: "PHI", short: "Eagles", color: "#267269" },
  "Pittsburgh Steelers": { id: "PIT", short: "Steelers", color: "#c8a932" },
  "San Francisco 49ers": { id: "SF", short: "49ers", color: "#aa0000" },
  "Seattle Seahawks": { id: "SEA", short: "Seahawks", color: "#4b9658" },
  "Tampa Bay Buccaneers": { id: "TB", short: "Buccaneers", color: "#b13a32" },
  "Tennessee Titans": { id: "TEN", short: "Titans", color: "#4b92db" },
  "Washington Commanders": { id: "WAS", short: "Commanders", color: "#8f2635" },
};

function number(value: string | undefined, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function normalizedClock(clock: string) {
  if (clock.startsWith(":")) return `0${clock}`;
  return clock;
}

function clockSeconds(clock: string) {
  const [minutes, seconds] = normalizedClock(clock).split(":").map(Number);
  return minutes * 60 + seconds;
}

function makePlayerId(teamId: TeamId, name: string) {
  return `${teamId}-${name}`;
}

function pageContaining(pages: RawPage[], marker: string) {
  return pages.find((page) => page.text.includes(marker));
}

function lineTokens(line: PdfLine, minX = -Infinity, maxX = Infinity) {
  return line.items
    .filter((item) => item.x >= minX && item.x < maxX && item.text.trim())
    .map((item) => item.text.trim());
}

function pageSplitX(page: RawPage) {
  return page.width / 2;
}

function sideTokens(line: PdfLine, page: RawPage, side: 0 | 1) {
  const split = pageSplitX(page);
  return lineTokens(line, side === 0 ? 0 : split, side === 0 ? split : page.width);
}

function parseTeams(summary: RawPage): [Team, Team] {
  const visitorLine = summary.lines.find((line) => line.text.startsWith("VISITOR:"));
  const homeLine = summary.lines.find((line) => line.text.startsWith("HOME:"));
  const parse = (line: PdfLine | undefined, homeAway: "visitor" | "home"): Team => {
    const label = homeAway === "visitor" ? "VISITOR:" : "HOME:";
    const nearbyItems = line ? summary.lines
      .filter((candidate) => Math.abs(candidate.y - line.y) <= 1.25)
      .flatMap((candidate) => candidate.items)
      .sort((a, b) => a.x - b.x) : [];
    const scoreItems = nearbyItems.filter((item) => item.x > summary.width / 2 && /^\d+$/.test(item.text.trim()));
    const name = nearbyItems
      .filter((item) => item.x < summary.width / 2 && item.text.trim() !== label)
      .map((item) => item.text.trim())
      .join(" ") || (homeAway === "visitor" ? "Visitor" : "Home");
    const info = TEAM_INFO[name] ?? {
      id: name.split(" ").map((word) => word[0]).join("").slice(0, 3).toUpperCase(),
      short: name.split(" ").at(-1) ?? name,
      color: homeAway === "visitor" ? "#3f7fa8" : "#c34b4b",
    };
    return {
      id: info.id,
      name,
      shortName: info.short,
      homeAway,
      score: number(scoreItems.at(-1)?.text),
      color: info.color,
    };
  };
  return [parse(visitorLine, "visitor"), parse(homeLine, "home")];
}

function parseMeta(summary: RawPage, gameSummary: RawPage | undefined) {
  const all = summary.text;
  const title = summary.lines.find((line) => / at .+ Start Time:/.test(line.text))?.text
    .replace(/\s+Start Time:.+$/, "") ?? "NFL Gamebook";
  const date = all.match(/Date:\s+\w+,\s+([^\s]+(?:\/\d{4})?)/)?.[1] ?? "";
  const startTime = all.match(/Start Time:\s+([^\n]+)/)?.[1] ?? "";
  const venueLine = summary.lines.find((line) => line.text.startsWith("at "))?.text ?? "";
  const [venue, ...location] = venueLine.replace(/^at\s+/, "").split(",");
  const weather = summary.lines.find((line) => line.text.startsWith("Game Weather:"))?.text.replace(/^Game Weather:\s*/, "") ?? "";
  const paidLine = gameSummary?.lines.find((line) => line.text.includes("Paid Attendance:"))?.text ?? "";
  return {
    title,
    date,
    venue: venue ?? "",
    location: location.join(",").trim(),
    startTime,
    weather,
    attendance: paidLine.match(/Paid Attendance:\s*([\d,]+)/)?.[1] ?? "",
    duration: paidLine.match(/Time:\s*([\d:]+)/)?.[1] ?? "",
  };
}

function parseTeamStats(page: RawPage | undefined): TeamStat[] {
  if (!page) return [];
  return page.lines
    .filter((line) => {
      const values = line.items.filter((item) => item.x > 400 && item.text.trim());
      return values.length >= 2 && line.items.some((item) => item.x < 400 && item.text.trim());
    })
    .map((line) => {
      const label = line.items.filter((item) => item.x < 400 && item.text.trim()).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
      const values = line.items.filter((item) => item.x > 400 && item.text.trim()).sort((a, b) => a.x - b.x);
      return { label, visitor: values[0]?.text.trim() ?? "", home: values.at(-1)?.text.trim() ?? "" };
    })
    .filter((stat) => stat.label && stat.label !== "Visitor" && stat.label !== "Home");
}

function parseScoring(pages: RawPage[], teams: [Team, Team]): ScoringPlay[] {
  const teamByShort = new Map(teams.map((team) => [team.shortName, team]));
  const rows = pages.flatMap((page) => page.lines)
    .filter((line) => {
      const tokens = lineTokens(line);
      return teamByShort.has(tokens[0]) && /^\d+$/.test(tokens[1] ?? "") && /^\d+:\d+$/.test(tokens[2] ?? "");
    });
  const seen = new Set<string>();
  return rows.flatMap((line) => {
      const tokens = lineTokens(line);
      const team = teamByShort.get(tokens[0])!;
      const description = tokens.slice(3, -2).join(" ");
      const visitorScore = number(tokens.at(-2));
      const homeScore = number(tokens.at(-1));
      const key = [team.id, tokens[1], tokens[2], description, visitorScore, homeScore].join("|");
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        id: `score-${seen.size}`,
        teamId: team.id,
        quarter: number(tokens[1]),
        clock: tokens[2],
        description,
        visitorScore,
        homeScore,
        playIndex: -1,
      }];
    });
}

function playKind(description: string): PlayKind {
  const text = description.toUpperCase();
  const decisiveText = text.includes("REVERSED") ? text.slice(text.lastIndexOf("REVERSED")) : text;
  if (decisiveText.includes("TOUCHDOWN")) return "touchdown";
  if (text.includes("INTERCEPTED") || (text.includes("FUMBLES") && text.includes("RECOVERED BY"))) return "turnover";
  if (text.includes("FIELD GOAL")) return "field-goal";
  if (text.includes("PUNTS")) return "punt";
  if (text.includes("SACKED")) return "sack";
  if (text.includes("PENALTY")) return "penalty";
  if (text.includes("PASS")) return "pass";
  if (/\b(LEFT|RIGHT|UP THE MIDDLE|SCRAMBLES)\b/.test(text)) return "rush";
  return "other";
}

function yardsFromDescription(description: string) {
  const direct = description.match(/for (-?\d+) yards?/i);
  if (direct) return number(direct[1]);
  if (/no gain|incomplete/i.test(description)) return 0;
  return null;
}

function fieldPosition(yardLine: string, possession: TeamId) {
  if (yardLine === "50") return 50;
  const match = yardLine.match(/^([A-Z]{2,3})\s+(\d+)$/);
  if (!match) return null;
  const yard = number(match[2]);
  return match[1] === possession ? yard : 100 - yard;
}

function refreshPlayDetails(play: Play, teams: [Team, Team]) {
  play.noPlay = /No Play/i.test(play.description);
  play.kind = playKind(play.description);
  play.yards = yardsFromDescription(play.description);
  play.details = parsePlayDetails(play.description, play.possession, teams, play.yardLine);
}

function parsePlays(pages: RawPage[], teams: [Team, Team]) {
  const teamNameMap = new Map(teams.map((team) => [team.name, team.id]));
  const firstPbpIndex = pages.findIndex((page) => /First Quarter\s*\nPlay By Play/.test(page.text));
  if (firstPbpIndex < 0) return { plays: [] as Play[], driveStarts: [] as { teamId: TeamId; quarter: number; clock: string; firstPlayIndex: number }[] };
  const pbpPages = pages.slice(firstPbpIndex).filter((page) => page.page < (pageContaining(pages, "Miscellaneous Statistics Report")?.page ?? Infinity));
  const plays: Play[] = [];
  const driveStarts: { teamId: TeamId; quarter: number; clock: string; firstPlayIndex: number }[] = [];
  let quarter = 1;
  let possession: TeamId = teams[1].id;
  let lastPlay: Play | undefined;
  for (const page of pbpPages) {
    const quarterHeader = page.text.match(/(First|Second|Third|Fourth) Quarter/);
    if (quarterHeader) quarter = ["First", "Second", "Third", "Fourth"].indexOf(quarterHeader[1]) + 1;
    for (const line of page.lines) {
      const text = line.text;
      if (!text || text.includes(`${teams[0].name} vs ${teams[1].name} at`) || /Play By Play \d/.test(text) || /^(First|Second|Third|Fourth) Quarter$/.test(text)) continue;
      const driveHeader = [...teamNameMap.entries()].find(([name]) => text.startsWith(`${name} at `));
      if (driveHeader) {
        possession = driveHeader[1];
        const clock = normalizedClock(text.match(/ at (\d{1,2}:\d{2})/)?.[1] ?? "15:00");
        driveStarts.push({ teamId: possession, quarter, clock, firstPlayIndex: plays.length });
        lastPlay = undefined;
        continue;
      }
      if (/ continued\.$/.test(text) || /^END OF QUARTER/.test(text) || /^(Score|Poss|Time|First Downs|Efficiencies)\b/.test(text) || (teams.some((team) => text.startsWith(`${team.name} `)) && /\d+\s+\d+:\d+/.test(text))) continue;
      const match = text.match(/^(\d+)-(\d+|Goal)-((?:[A-Z]{2,3}\s+\d+)|50)\s+\((:?\d{0,2}:\d{2})\)\s+(.+)$/i);
      if (match) {
        const description = match[5].trim();
        const playerNames = [...new Set(description.match(PLAYER_RE) ?? [])];
        const play: Play = {
          id: `play-${plays.length + 1}`,
          index: plays.length,
          quarter,
          clock: normalizedClock(match[4]),
          down: number(match[1]),
          distance: match[2].toLowerCase() === "goal" ? "Goal" : number(match[2]),
          yardLine: match[3],
          possession,
          description,
          rawText: text,
          kind: playKind(description),
          yards: yardsFromDescription(description),
          noPlay: false,
          playerIds: playerNames.map((name) => makePlayerId("", name)),
          fieldPosition: fieldPosition(match[3], possession),
          details: parsePlayDetails(description, possession, teams, match[3]),
          stateBefore: {
            quarter,
            clock: normalizedClock(match[4]),
            down: number(match[1]),
            distance: match[2].toLowerCase() === "goal" ? "Goal" : number(match[2]),
            ballPosition: match[3],
            possession,
          },
        };
        plays.push(play);
        lastPlay = play;
        continue;
      }
      const isContinuation = !/^Timeout|^Two-Minute Warning|^[A-Z]\.[A-Za-z'-]+ kicks|^IND \d+ NE \d+/.test(text);
      if (lastPlay && isContinuation) {
        lastPlay.description = `${lastPlay.description} ${text}`.replace(/\s+/g, " ").trim();
        lastPlay.rawText = `${lastPlay.rawText}\n${text}`;
        refreshPlayDetails(lastPlay, teams);
        const names = [...new Set(lastPlay.description.match(PLAYER_RE) ?? [])];
        lastPlay.playerIds = names.map((name) => makePlayerId("", name));
      }
    }
  }
  plays.forEach((play, index) => {
    const next = plays[index + 1];
    if (next) play.stateAfter = { ...next.stateBefore };
  });
  return { plays, driveStarts };
}

function valueAt(line: PdfLine, from: number, to: number) {
  return line.items.filter((item) => item.x >= from && item.x < to && item.text.trim()).map((item) => item.text.trim()).join(" ").trim();
}

function parseDrives(page: RawPage | undefined, teams: [Team, Team]): Drive[] {
  if (!page) return [];
  const splitY = page.lines.find((line) => line.text === teams[1].name)?.y ?? 448;
  const result: Drive[] = [];
  for (const line of page.lines) {
    const driveNumber = valueAt(line, 20, 40);
    if (!/^\d+$/.test(driveNumber)) continue;
    const team = line.y > splitY ? teams[0] : teams[1];
    const startClock = valueAt(line, 40, 75);
    const endClock = valueAt(line, 75, 105);
    if (!/^\d+:\d+$/.test(startClock) || !/^\d+:\d+$/.test(endClock)) continue;
    const lastPosition = valueAt(line, 430, 478).replace(/^\*\s*/, "");
    result.push({
      id: `drive-${team.id}-${driveNumber}`,
      teamId: team.id,
      teamDriveNumber: number(driveNumber),
      quarter: 0,
      startClock,
      endClock,
      possessionTime: valueAt(line, 104, 131),
      obtained: valueAt(line, 130, 205),
      startPosition: valueAt(line, 205, 250),
      plays: number(valueAt(line, 255, 288)),
      grossYards: number(valueAt(line, 288, 325)),
      penaltyYards: number(valueAt(line, 325, 356)),
      netYards: number(valueAt(line, 356, 390)),
      firstDowns: number(valueAt(line, 390, 430)),
      endPosition: lastPosition,
      result: valueAt(line, 478, 600),
      playIds: [],
      firstPlayIndex: -1,
      lastPlayIndex: -1,
    });
  }
  return result;
}

function attachDrives(
  drives: Drive[],
  plays: Play[],
  starts: { teamId: TeamId; quarter: number; clock: string; firstPlayIndex: number }[],
) {
  const counters = new Map<TeamId, number>();
  for (let startIndex = 0; startIndex < starts.length; startIndex += 1) {
    const start = starts[startIndex];
    const driveNumber = (counters.get(start.teamId) ?? 0) + 1;
    counters.set(start.teamId, driveNumber);
    const drive = drives.find((candidate) => candidate.teamId === start.teamId && candidate.teamDriveNumber === driveNumber);
    if (!drive) continue;
    const next = starts.slice(startIndex + 1).find((candidate) => candidate.teamId !== start.teamId);
    const endIndex = next ? next.firstPlayIndex - 1 : plays.length - 1;
    const owned = plays.slice(start.firstPlayIndex, endIndex + 1).filter((play) => play.possession === start.teamId);
    drive.quarter = start.quarter;
    drive.playIds = owned.map((play) => play.id);
    drive.firstPlayIndex = owned[0]?.index ?? start.firstPlayIndex;
    drive.lastPlayIndex = owned.at(-1)?.index ?? drive.firstPlayIndex;
    for (const play of owned) play.driveId = drive.id;
  }
  return drives.sort((a, b) => a.firstPlayIndex - b.firstPlayIndex);
}

interface PlayerDraft extends Player {}

function playerDraft(map: Map<string, PlayerDraft>, teamId: TeamId, name: string) {
  const id = makePlayerId(teamId, name);
  let player = map.get(id);
  if (!player) {
    player = { id, name, teamId, starter: false, playIds: [] };
    map.set(id, player);
  }
  return player;
}

function parseStarterRows(page: RawPage, teams: [Team, Team], players: Map<string, PlayerDraft>) {
  const lineupHeader = page.lines.find((line) => line.text.includes("Offense") && line.text.includes("Defense"));
  const substitutions = page.lines.find((line) => line.y < (lineupHeader?.y ?? Infinity) && line.text.includes("Substitutions"));
  const rows = page.lines.filter((line) => line.y < (lineupHeader?.y ?? Infinity) && line.y > (substitutions?.y ?? -Infinity));
  for (const line of rows) {
    ([0, 1] as const).forEach((side) => {
      const text = sideTokens(line, page, side).join(" ");
      const matches = [...text.matchAll(/\b([A-Z]{1,3})\s+\d+\s+([A-Z][a-z]?\.[A-Za-z'-]+(?:-[A-Za-z]+)?)/g)];
      for (const match of matches) {
        const player = playerDraft(players, teams[side].id, match[2]);
        player.position = player.position ?? match[1];
        player.starter = true;
      }
    });
  }
}

function parseRosterRows(page: RawPage, teams: [Team, Team], players: Map<string, PlayerDraft>) {
  const substitutions = page.lines.find((line) => line.text.includes("Substitutions"));
  const notActive = page.lines.find((line) => line.text.includes("Not Active"));
  if (!substitutions || !notActive) return;
  const rows = page.lines.filter((line) => line.y < substitutions.y && line.y > notActive.y).sort((a, b) => b.y - a.y);
  for (const side of [0, 1] as const) {
    const text = rows.map((line) => sideTokens(line, page, side).join(" ")).join(" ").replace(/\s+/g, " ");
    const matches = [...text.matchAll(/\b([A-Z]{1,3})\s+\d+\s+([A-Z][a-z]?\.[A-Za-z'-]+(?: [A-Z][A-Za-z'-]+)?)/g)];
    for (const match of matches) {
      if (!POSITION_RE.test(match[1])) continue;
      const player = playerDraft(players, teams[side].id, match[2]);
      player.position = player.position ?? match[1];
    }
  }
}

function parseIndividualStats(page: RawPage | undefined, teams: [Team, Team], players: Map<string, PlayerDraft>) {
  if (!page) return;
  const headers = page.lines.filter((line) => /^(RUSHING|PASSING|PASS RECEIVING|INTERCEPTIONS)\b/.test(line.text));
  const headerY = (name: string) => headers.find((line) => line.text.startsWith(name))?.y ?? -1;
  const ranges = [
    { name: "rushing", top: headerY("RUSHING"), bottom: headerY("PASSING"), columns: 6 },
    { name: "passing", top: headerY("PASSING"), bottom: headerY("PASS RECEIVING"), columns: 9 },
    { name: "receiving", top: headerY("PASS RECEIVING"), bottom: headerY("INTERCEPTIONS"), columns: 7 },
  ];
  for (const range of ranges) {
    const lines = page.lines.filter((line) => line.y < range.top && line.y > range.bottom);
    for (const line of lines) {
      for (const side of [0, 1] as const) {
        const tokens = sideTokens(line, page, side);
        if (!PLAYER_EXACT_RE.test(tokens[0] ?? "") || tokens.length < range.columns) continue;
        const player = playerDraft(players, teams[side].id, tokens[0]);
        if (range.name === "rushing") {
          player.rushing = {
            attempts: number(tokens[1]), yards: number(tokens[2]), average: number(tokens[3]),
            long: number(tokens[4]), touchdowns: number(tokens[5]),
          } satisfies RushingStats;
        } else if (range.name === "passing") {
          player.passing = {
            attempts: number(tokens[1]), completions: number(tokens[2]), yards: number(tokens[3]), sacks: tokens[4],
            touchdowns: number(tokens[5]), long: number(tokens[6]), interceptions: number(tokens[7]), rating: number(tokens[8]),
          } satisfies PassingStats;
        } else {
          player.receiving = {
            targets: number(tokens[1]), receptions: number(tokens[2]), yards: number(tokens[3]), average: number(tokens[4]),
            long: number(tokens[5]), touchdowns: number(tokens[6]),
          } satisfies ReceivingStats;
        }
      }
    }
  }
}

function parseDefense(pages: RawPage[], teams: [Team, Team], players: Map<string, PlayerDraft>) {
  const defensePages = pages.filter((page) => page.text.includes("Final Defensive Statistics"));
  for (const page of defensePages) {
    const team = teams.find((candidate) => page.text.includes(`${candidate.name}\nRegular Defensive Plays`)) ??
      teams.find((candidate) => page.lines.some((line) => line.text.startsWith(candidate.name) && line.text.includes("Regular Defensive Plays")));
    if (!team) continue;
    for (const line of page.lines) {
      const tokens = lineTokens(line);
      if (!tokens[0]?.match(PLAYER_RE) || tokens.length < 12) continue;
      const values = tokens.slice(1).map((value) => number(value));
      playerDraft(players, team.id, tokens[0]).defense = {
        tackles: values[0], assists: values[1], combined: values[2], sacks: values[3], sackYards: values[4],
        tacklesForLoss: values[5], quarterbackHits: values[6], interceptions: values[7], passesDefended: values[8],
        forcedFumbles: values[9], fumbleRecoveries: values[10],
      } satisfies DefensiveStats;
    }
  }
}

function parseSnapUnit(items: PdfLine["items"], from: number, to: number): SnapUnit | undefined {
  const tokens = items.filter((item) => item.x >= from && item.x < to && item.text.trim()).map((item) => item.text.trim());
  const count = tokens.find((token) => /^\d+$/.test(token));
  const percentage = tokens.find((token) => /^\d+%$/.test(token));
  if (!count || !percentage) return undefined;
  return { count: number(count), percentage: number(percentage.replace("%", "")) };
}

function parseSnaps(pages: RawPage[], teams: [Team, Team], players: Map<string, PlayerDraft>) {
  const start = pages.findIndex((page) => page.text.includes("Playtime Percentage"));
  if (start < 0) return;
  const headerPage = pages[start];
  const headerLine = headerPage.lines.find((line) =>
    line.items.filter((item) => item.text.trim() === "Offense").length === 2 &&
    line.items.filter((item) => item.text.trim() === "Defense").length === 2);
  if (!headerLine) return;

  const unitRanges = ([0, 1] as const).map((side) => {
    const split = pageSplitX(headerPage);
    const sideItems = headerLine.items.filter((item) => side === 0 ? item.x < split : item.x >= split);
    const anchors = ["Offense", "Defense", "Special Teams"].map((label) =>
      sideItems.find((item) => item.text.trim() === label)?.x ?? NaN);
    return {
      offense: [anchors[0], anchors[1]] as const,
      defense: [anchors[1], anchors[2]] as const,
      specialTeams: [anchors[2], side === 0 ? split : headerPage.width] as const,
    };
  });

  for (const page of pages.slice(start)) {
    for (const line of page.lines) {
      for (const side of [0, 1] as const) {
        const split = pageSplitX(page);
        const items = line.items.filter((item) => side === 0 ? item.x < split : item.x >= split);
        const nameItem = items.find((item) => PLAYER_EXACT_RE.test(item.text.trim()));
        if (!nameItem) continue;
        const name = nameItem.text.trim();
        const position = items.find((item) => item.x > nameItem.x && POSITION_RE.test(item.text.trim()))?.text.trim();
        const player = playerDraft(players, teams[side].id, name);
        player.position = player.position ?? position;
        const ranges = unitRanges[side];
        player.snaps = {
          offense: parseSnapUnit(items, ...ranges.offense),
          defense: parseSnapUnit(items, ...ranges.defense),
          specialTeams: parseSnapUnit(items, ...ranges.specialTeams),
        };
      }
    }
  }
}

function linkPlayers(players: Map<string, PlayerDraft>, plays: Play[], teams: [Team, Team]) {
  const byName = new Map<string, PlayerDraft[]>();
  for (const player of players.values()) {
    const list = byName.get(player.name) ?? [];
    list.push(player);
    byName.set(player.name, list);
  }
  for (const play of plays) {
    const semanticNames = play.details.participants.map((participant) => participant.name);
    const names = [...new Set([...semanticNames, ...(play.description.match(PLAYER_RE) ?? [])])];
    const resolved: string[] = [];
    for (const name of names) {
      let candidates = byName.get(name) ?? [];
      if (!candidates.length) candidates = [...players.values()].filter((candidate) => candidate.name.startsWith(`${name} `) && play.description.includes(candidate.name));
      const semantic = play.details.participants.find((participant) => participant.name === name);
      let player = semantic?.teamId ? candidates.find((candidate) => candidate.teamId === semantic.teamId) : undefined;
      if (!player) player = candidates.find((candidate) => candidate.teamId === play.possession);
      if (!player) player = candidates[0];
      if (!player) player = playerDraft(players, semantic?.teamId ?? play.possession ?? teams[0].id, name);
      if (!player.playIds.includes(play.id)) player.playIds.push(play.id);
      resolved.push(player.id);
      play.details.participants.filter((participant) => participant.name === name && (!participant.teamId || participant.teamId === player!.teamId)).forEach((participant) => {
        participant.name = player!.name;
        participant.teamId = player!.teamId;
        participant.playerId = player!.id;
      });
    }
    play.playerIds = resolved;
  }
}

function linkScoring(scoring: ScoringPlay[], plays: Play[]) {
  for (const score of scoring) {
    const player = score.description.match(PLAYER_RE)?.[0];
    const candidates = plays.filter((play) => play.quarter === score.quarter && (!player || play.description.includes(player)) &&
      (/Field Goal/i.test(score.description) ? /field goal is GOOD/i.test(play.description) : /TOUCHDOWN/i.test(play.description)));
    score.playIndex = candidates.sort((a, b) => Math.abs(clockSeconds(a.clock) - clockSeconds(score.clock)) - Math.abs(clockSeconds(b.clock) - clockSeconds(score.clock)))[0]?.index ?? -1;
  }
}

function validateParse(
  pages: RawPage[],
  teams: [Team, Team],
  teamStats: TeamStat[],
  drives: Drive[],
  plays: Play[],
  players: Player[],
  sections: GameData["source"]["sections"],
): ParseValidation {
  const issues: ParseValidationIssue[] = [];
  const add = (issue: ParseValidationIssue) => issues.push(issue);
  const playerCountByTeam: Record<TeamId, number> = {};
  const positionCoverageByTeam: Record<TeamId, number> = {};
  const snapCountByTeam: Record<TeamId, number> = {};
  const teamStatValueCountByTeam: Record<TeamId, number> = {};
  const structuredPlayCount = plays.filter((play) => play.details.parseStatus !== "raw").length;
  const rawPlayCount = plays.length - structuredPlayCount;
  const penaltyEventCount = plays.reduce((sum, play) => sum + play.details.penalties.reduce((count, penalty) => count + (penalty.occurrences?.length ?? 1), 0), 0);

  const scoreRowsComplete = teams.map((team) => {
    const label = team.homeAway === "visitor" ? "VISITOR:" : "HOME:";
    const row = pages[0]?.lines.find((line) => line.text.startsWith(label));
    return !!row && row.items.filter((item) => item.x > pages[0].width / 2 && /^\d+$/.test(item.text.trim())).length >= 6;
  });
  if (teams.some((team) => team.name === "Visitor" || team.name === "Home") || teams[0].id === teams[1].id) {
    add({ code: "teams-unresolved", severity: "error", section: "game", message: "Visitor and Home teams could not both be identified." });
  }
  scoreRowsComplete.forEach((complete, index) => {
    if (!complete) add({ code: "score-row-incomplete", severity: "error", section: "game", teamId: teams[index].id, message: `${teams[index].shortName} score row is incomplete.` });
  });

  teams.forEach((team) => {
    const teamPlayers = players.filter((player) => player.teamId === team.id);
    const positioned = teamPlayers.filter((player) => player.position).length;
    const snapped = teamPlayers.filter((player) => player.snaps && Object.values(player.snaps).some(Boolean)).length;
    const statValues = teamStats.filter((stat) => (team.homeAway === "visitor" ? stat.visitor : stat.home).trim()).length;
    playerCountByTeam[team.id] = teamPlayers.length;
    positionCoverageByTeam[team.id] = teamPlayers.length ? positioned / teamPlayers.length : 0;
    snapCountByTeam[team.id] = snapped;
    teamStatValueCountByTeam[team.id] = statValues;
    if (teamPlayers.length < 5) add({ code: "players-missing", severity: "error", section: "players", teamId: team.id, message: `${team.shortName} player data is mostly missing.` });
    if (teamPlayers.length >= 10 && positioned / teamPlayers.length < 0.25) add({ code: "positions-low", severity: "warning", section: "players", teamId: team.id, message: `${team.shortName} position coverage is unusually low.` });
    if (statValues < 5) add({ code: "team-stats-missing", severity: "error", section: "team-stats", teamId: team.id, message: `${team.shortName} team statistics are mostly missing.` });
    if (!drives.some((drive) => drive.teamId === team.id)) add({ code: "drives-team-missing", severity: "error", section: "drives", teamId: team.id, message: `${team.shortName} drives could not be identified.` });
    if (!plays.some((play) => play.possession === team.id)) add({ code: "pbp-team-missing", severity: "error", section: "play-by-play", teamId: team.id, message: `${team.shortName} possession could not be linked in Play-by-Play.` });
  });

  if (sections.playtimePercentage) {
    const [visitorSnaps, homeSnaps] = teams.map((team) => snapCountByTeam[team.id]);
    if ((visitorSnaps === 0) !== (homeSnaps === 0)) {
      const failed = visitorSnaps === 0 ? teams[0] : teams[1];
      add({ code: "snaps-one-sided", severity: "error", section: "snaps", teamId: failed.id, message: `${failed.shortName} snap table was not parsed while the other team was.` });
    } else if (visitorSnaps === 0 && homeSnaps === 0) {
      add({ code: "snaps-missing", severity: "error", section: "snaps", message: "The Playtime Percentage section was found but no snap rows were parsed." });
    }
  }

  const positionRates = teams.map((team) => positionCoverageByTeam[team.id]);
  if (Math.max(...positionRates) > 0.6 && Math.min(...positionRates) < 0.25) {
    const failed = teams[positionRates[0] < positionRates[1] ? 0 : 1];
    add({ code: "positions-one-sided", severity: "error", section: "players", teamId: failed.id, message: `${failed.shortName} positions are disproportionately missing compared with the other team.` });
  }

  const sourcePenaltyCount = plays.reduce((sum, play) => sum + [...play.description.matchAll(/\bPENALTY on\b/gi)].length, 0);
  if (penaltyEventCount < sourcePenaltyCount) add({ code: "penalties-unparsed", severity: "error", section: "play-by-play", message: `${sourcePenaltyCount - penaltyEventCount} penalty event(s) exist in Play-by-Play but were not structured; raw text is retained.` });
  const bracketSourceCount = plays.reduce((sum, play) => sum + [...play.description.matchAll(/\[[^\]]+\]/g)].length, 0);
  const bracketParsedCount = plays.reduce((sum, play) => sum + play.details.annotations.filter((annotation) => annotation.kind === "qb-hit").length, 0);
  if (bracketParsedCount < bracketSourceCount) add({ code: "brackets-unparsed", severity: "warning", section: "play-by-play", message: `${bracketSourceCount - bracketParsedCount} bracket annotation(s) could not be structured; raw text is retained.` });
  if (plays.length >= 20 && rawPlayCount / plays.length > 0.15) add({ code: "play-coverage-low", severity: "warning", section: "play-by-play", message: "Structured Play coverage is unusually low; unrecognized plays use raw Gamebook text." });

  return {
    status: issues.length ? "partial" : "complete",
    issues,
    metrics: { playerCountByTeam, positionCoverageByTeam, snapCountByTeam, teamStatValueCountByTeam, structuredPlayCount, rawPlayCount, penaltyEventCount },
  };
}

export function parseGamebookPages(pages: RawPage[], fileName = "gamebook.pdf"): GameData {
  const summary = pageContaining(pages, "National Football League Game Summary") ?? pages[0];
  const gameSummary = pages.find((page) => page.page !== summary.page && page.text.includes("National Football League Game Summary"));
  const teams = parseTeams(summary);
  const scoring = parseScoring(pages.filter((page) => page.text.includes("National Football League Game Summary")), teams);
  const teamStats = parseTeamStats(pageContaining(pages, "Final Team Statistics"));
  const { plays, driveStarts } = parsePlays(pages, teams);
  const drives = attachDrives(parseDrives(pageContaining(pages, "Ball Possession And Drive Chart"), teams), plays, driveStarts);
  const playerMap = new Map<string, PlayerDraft>();
  parseStarterRows(summary, teams, playerMap);
  parseRosterRows(summary, teams, playerMap);
  parseIndividualStats(pageContaining(pages, "Final Individual Statistics"), teams, playerMap);
  parseDefense(pages, teams, playerMap);
  parseSnaps(pages, teams, playerMap);
  linkPlayers(playerMap, plays, teams);
  linkScoring(scoring, plays);
  const players = [...playerMap.values()].sort((a, b) => a.teamId.localeCompare(b.teamId) || a.name.localeCompare(b.name));
  const warnings: string[] = [];
  if (!plays.length) warnings.push("Play-by-Play could not be structured; raw page text is retained.");
  if (!drives.length) warnings.push("Drive Chart could not be structured; raw page text is retained.");
  const unmatchedScoring = scoring.filter((score) => score.playIndex < 0).length;
  if (unmatchedScoring) warnings.push(`${unmatchedScoring} scoring plays could not be linked to Play-by-Play.`);
  const sections = {
    scoring: pages.some((page) => page.text.includes("SCORING SUMMARY")),
    teamStats: pages.some((page) => page.text.includes("Final Team Statistics")),
    individualStats: pages.some((page) => page.text.includes("Final Individual Statistics")),
    defensiveStats: pages.some((page) => page.text.includes("Final Defensive Statistics")),
    driveChart: pages.some((page) => page.text.includes("Ball Possession And Drive Chart")),
    playByPlay: pages.some((page) => /First Quarter\s*\nPlay By Play/.test(page.text)),
    playtimePercentage: pages.some((page) => page.text.includes("Playtime Percentage")),
    roster: summary.text.includes("Substitutions") || summary.text.includes("Lineups"),
  };
  const validation = validateParse(pages, teams, teamStats, drives, plays, players, sections);
  warnings.push(...validation.issues.map((issue) => issue.message));
  const gameMeta = parseMeta(summary, gameSummary);
  gameMeta.title = `${teams[0].name} at ${teams[1].name}`;
  return {
    source: { fileName, pageCount: pages.length, parsedAt: new Date().toISOString(), rawPages: pages, sections },
    game: gameMeta,
    teams,
    scoring,
    teamStats,
    drives,
    plays,
    players,
    validation,
    warnings,
  };
}
