import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseGamebook } from "../src/parser";
import { aggregateSummaries, runIndependentBatch, summarizeGame, type GameEvaluationSummary } from "./batch";
import { resolveNflverseGame } from "./identity";
import { alignPlays, MATCHER_VERSION } from "./matcher";
import { loadNflverseGame, loadSchedule, toGamebookInputs, type CenterMetadata } from "./sources";
import type { AlignmentRun, GamebookPlayInput, NflversePlay, PlayAlignment } from "./types";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

interface GameConfig { id: string; slug: string; round: string; reason: string }

const cache = "research/cache";
const output = "research/output/phase-3";
const schedulePath = `${cache}/games.csv`;
const pbpPath = `${cache}/play_by_play_2025.csv.gz`;

async function fingerprint(path: string) {
  const bytes = await readFile(path);
  const info = await stat(path);
  return { path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), retrievedAt: info.mtime.toISOString() };
}

const eventDefinitions: [string, (play: NflversePlay) => boolean][] = [
  ["Interception", (play) => play.flags.interception],
  ["Interception return", (play) => Boolean(play.flags.interceptionReturn)],
  ["Fumble", (play) => Boolean(play.flags.fumble)],
  ["Lost fumble", (play) => play.flags.fumbleLost],
  ["Fumble return", (play) => Boolean(play.flags.fumbleReturn)],
  ["Replay review", (play) => Boolean(play.flags.replay)],
  ["Replay reversal", (play) => Boolean(play.flags.replayReversal)],
  ["Blocked FG", (play) => Boolean(play.flags.blockedFieldGoal)],
  ["Blocked punt", (play) => Boolean(play.flags.blockedPunt)],
  ["Safety", (play) => Boolean(play.flags.safety)],
  ["Offsetting penalty", (play) => Boolean(play.flags.offsettingPenalty)],
  ["Unusual no-play", (play) => play.flags.noPlay && !play.flags.penalty && !play.flags.timeout],
  ["Kickoff penalty", (play) => Boolean(play.flags.kickoffPenalty)],
  ["Penalty / no-play", (play) => (play.flags.penalty || play.flags.noPlay) && !play.flags.timeout],
  ["Touchdown", (play) => play.flags.touchdown],
  ["Extra point", (play) => play.flags.extraPoint],
  ["Field goal", (play) => play.flags.fieldGoal],
  ["Punt", (play) => play.flags.punt],
  ["Ordinary scrimmage", (play) => ["run", "pass", "qb_kneel", "qb_spike"].includes(play.playType ?? "") && !play.flags.penalty && !/^TWO-POINT CONVERSION/i.test(play.description ?? "")],
];

function eventCoverage(external: NflversePlay[], run: AlignmentRun) {
  const referenced = new Set(run.alignments.flatMap((item) => item.externalPlayRefs.map((ref) => ref.providerPlayId)));
  return Object.fromEntries(eventDefinitions.map(([name, test]) => {
    const rows = external.filter(test);
    return [name, { referenced: rows.filter((row) => referenced.has(row.providerPlayId)).length, total: rows.length }];
  }));
}

function externalCategory(play: NflversePlay) {
  const description = play.description ?? "";
  if (play.flags.timeout) return "Administrative timeout";
  if (!play.playType && /end of|quarter|game|two-minute warning/i.test(description)) return "Quarter/game marker";
  if (play.flags.kickoff) return "Standalone kickoff";
  if (/^TWO-POINT CONVERSION ATTEMPT/i.test(description)) return "Parser granularity difference / conversion";
  if (play.flags.replay && !play.playType) return "Replay administrative row";
  if (play.flags.extraPoint) return "Parser granularity difference / PAT";
  if (!play.playType) return "Quarter/game marker";
  if (play.flags.penalty || play.flags.noPlay) return "Parser granularity difference / scoring continuation";
  if (["run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike"].includes(play.playType)) return "Potential matcher failure";
  return "Unknown/source granularity difference";
}

function auditReasons(alignment: PlayAlignment, externalById: Map<string, NflversePlay>) {
  const rows = alignment.externalPlayRefs.map((ref) => externalById.get(ref.providerPlayId)).filter(Boolean) as NflversePlay[];
  const reasons: string[] = [];
  if (alignment.status !== "matched") reasons.push(alignment.status);
  if (alignment.confidence < 0.85) reasons.push("low-confidence matched");
  if (alignment.evidence.alternatives.length) reasons.push("multiple candidates");
  if (alignment.relationship !== "1:1") reasons.push(alignment.relationship);
  if (rows.some((row) => row.quarter === 5)) reasons.push("overtime");
  for (const [name, test] of eventDefinitions.slice(0, -1)) if (rows.some(test)) reasons.push(name);
  return [...new Set(reasons)];
}

function renderGameMarkdown(result: any) {
  const s = result.summary as GameEvaluationSummary;
  const events = Object.entries(result.eventCoverage).map(([name, value]: [string, any]) => `| ${name} | ${value.referenced}/${value.total} |`).join("\n");
  const categories = Object.entries(result.unmatchedExternal.reduce((acc: Record<string, number>, item: any) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1;
    return acc;
  }, {})).map(([name, count]) => `- ${name}: ${count}`).join("\n") || "- None";
  return `# Phase 3 alignment: ${result.identity.game.gameId}\n\n- Round: ${result.config.round}\n- Matchup: ${result.center.identity.awayTeam.code} @ ${result.center.identity.homeTeam.code}\n- Selection reason: ${result.config.reason}\n- Matcher: \`${s.matcherVersion}\`\n- Matcher SHA-256: \`${result.matcherSha256}\`\n\n## Result\n\n| Metric | Value |\n|---|---:|\n| Gamebook plays | ${s.gamebookPlays} |\n| nflverse rows | ${s.nflverseRows} |\n| 1:1 matched | ${s.counts.oneToOne} |\n| 1:many | ${s.counts.oneToMany} |\n| many:1 | ${s.counts.manyToOne} |\n| ambiguous Gamebook | ${s.counts.ambiguous} |\n| unmatched Gamebook | ${s.counts.unmatchedGamebook} |\n| unmatched nflverse | ${s.counts.unmatchedNflverse} |\n| High-confidence coverage | ${(s.highConfidence.rate * 100).toFixed(2)}% (${s.highConfidence.numerator}/${s.highConfidence.denominator}) |\n| nflverse row reference rate | ${(s.externalReference.rate * 100).toFixed(2)}% (${s.externalReference.numerator}/${s.externalReference.denominator}) |\n| Minimum matched confidence | ${s.confidence.minimum?.toFixed(4) ?? "n/a"} |\n| Median matched confidence | ${s.confidence.median?.toFixed(4) ?? "n/a"} |\n\n## Event row reference\n\n| Event | Referenced / total |\n|---|---:|\n${events}\n\n## Unmatched nflverse preliminary classification\n\n${categories}\n\nThe JSON artifact contains every source row, alignment, candidate alternative, audit-queue reason, and preliminary unmatched-row classification. Correctness is finalized only after the Phase 3 cross-game audit.\n`;
}

async function runGame(config: GameConfig, schedule: Awaited<ReturnType<typeof loadSchedule>>, sharedSources: any, matcherSha256: string) {
  const metadataPath = `${cache}/${config.slug}.json`;
  const pdfPath = `${cache}/${config.slug}.pdf`;
  const center = JSON.parse(await readFile(metadataPath, "utf8")) as CenterMetadata;
  const identity = resolveNflverseGame(center.identity, schedule);
  if (identity.game.gameId !== config.id) throw new Error(`Manifest expected ${config.id}; identity resolution produced ${identity.game.gameId}.`);
  const nflverse = await loadNflverseGame(pbpPath, identity.game.gameId);
  const parsed = await parseGamebook(new Uint8Array(await readFile(pdfPath)), pdfPath);
  const gamebook = toGamebookInputs(parsed.plays);
  const run = alignPlays(gamebook, nflverse);
  if (run.alignments.some((item) => item.matcherVersion !== MATCHER_VERSION)) throw new Error("Matcher version drift detected.");
  const externalById = new Map(nflverse.map((play) => [play.providerPlayId, play]));
  const result = {
    generatedAt: new Date().toISOString(), config, matcherSha256,
    sources: { ...sharedSources, centerMetadata: { url: `https://spoiler-free-nfl-gamebooks.dic19.chatgpt.site/api/companion/gamebook?game=${config.slug}`, ...await fingerprint(metadataPath) }, gamebookPdf: { url: center.gamebookUrl, ...await fingerprint(pdfPath) } },
    center, identity, parser: { validation: parsed.validation, warnings: parsed.warnings },
    summary: summarizeGame(identity.game.gameId, gamebook, nflverse, run),
    eventCoverage: eventCoverage(nflverse, run), gamebook, nflverse, alignments: run.alignments,
    auditQueue: run.alignments.map((alignment) => ({ alignment, reasons: auditReasons(alignment, externalById) })).filter((item) => item.reasons.length),
    unmatchedExternal: run.unmatchedExternalPlayIds.map((id) => ({ category: externalCategory(externalById.get(id)!), play: externalById.get(id) })),
  };
  await writeFile(`${output}/${config.id}.json`, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(`${output}/${config.id}.md`, renderGameMarkdown(result));
  return result;
}

const configs = JSON.parse(await readFile("research/phase-3-games.json", "utf8")) as GameConfig[];
const schedule = await loadSchedule(schedulePath);
const matcherSha256 = (await fingerprint("research/matcher.ts")).sha256;
const sharedSources = {
  nflverseSchedule: { url: "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv", ...await fingerprint(schedulePath) },
  nflversePbp: { url: "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz", ...await fingerprint(pbpPath) },
};
await mkdir(output, { recursive: true });
const outcomes = await runIndependentBatch(configs, (config) => runGame(config, schedule, sharedSources, matcherSha256));
const successful = outcomes.filter((item): item is Extract<typeof item, { ok: true }> => item.ok).map((item) => item.value);
const aggregate = aggregateSummaries(successful.map((item) => item.summary));
const eventAggregate: Record<string, { referenced: number; total: number }> = {};
for (const result of successful) for (const [name, value] of Object.entries(result.eventCoverage) as [string, { referenced: number; total: number }][]) {
  const target = eventAggregate[name] ??= { referenced: 0, total: 0 };
  target.referenced += value.referenced; target.total += value.total;
}
const batch = { generatedAt: new Date().toISOString(), matcherSha256, outcomes: outcomes.map((item) => item.ok ? { ok: true, id: item.id, summary: item.value.summary } : item), aggregate, eventAggregate };
await writeFile(`${output}/aggregate.json`, `${JSON.stringify(batch, null, 2)}\n`);
await writeFile(`${output}/aggregate.md`, `# Phase 3 aggregate (pre-audit)\n\n- Matcher: \`${aggregate.matcherVersion}\`\n- Successful games: ${aggregate.games}/${configs.length}\n- Gamebook high-confidence coverage: **${(aggregate.coverage * 100).toFixed(2)}%** (${aggregate.totals.highConfidence}/${aggregate.totals.gamebookPlays})\n- Ambiguous rate: **${(aggregate.ambiguousRate * 100).toFixed(2)}%** (${aggregate.totals.ambiguous}/${aggregate.totals.gamebookPlays})\n- Unmatched Gamebook rate: **${(aggregate.unmatchedGamebookRate * 100).toFixed(2)}%** (${aggregate.totals.unmatchedGamebook}/${aggregate.totals.gamebookPlays})\n- nflverse row reference rate: **${(aggregate.externalReferenceRate * 100).toFixed(2)}%** (${aggregate.totals.referencedRows}/${aggregate.totals.nflverseRows})\n\nThis is the frozen matcher's raw output before correctness audit.\n`);
console.log(JSON.stringify(batch, null, 2));
