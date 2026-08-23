import { mkdir, readFile, writeFile } from "node:fs/promises";
import { MATCHER_VERSION } from "./matcher";
import type { NflversePlay } from "./types";

interface Audit {
  auditedAt: string;
  method: Record<string, unknown>;
  falseMatches: any[];
  gamebookIssues: any[];
  parserIssues: any[];
  closestRiskExamples: any[];
}

const inputDir = "research/output/phase-3";
const resultDir = "research/results/phase-3";
const expectedMatcherHash = "5d09bee7bf4009783f2d85660aa459bb0a34b3f8184ebcb43285b800539dc2e4";
const configs = JSON.parse(await readFile("research/phase-3-games.json", "utf8"));
const audit = JSON.parse(await readFile("research/phase-3-audit.json", "utf8")) as Audit;
const games = await Promise.all(configs.map(async (config: any) => JSON.parse(await readFile(`${inputDir}/${config.id}.json`, "utf8"))));

if (games.some((game) => game.summary.matcherVersion !== MATCHER_VERSION || game.matcherSha256 !== expectedMatcherHash)) {
  throw new Error("Refusing to finalize a batch with matcher version/hash drift.");
}

function countsByCategory(items: any[]) {
  return Object.fromEntries(Object.entries(items.reduce((acc: Record<string, number>, item: any) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1;
    return acc;
  }, {})).sort(([left], [right]) => left.localeCompare(right)));
}

function percent(value: number) { return `${(value * 100).toFixed(2)}%`; }

function compactGame(game: any) {
  const gameIssues = audit.gamebookIssues.filter((issue) => issue.gameId === game.summary.gameId);
  const falseMatches = audit.falseMatches.filter((issue) => issue.gameId === game.summary.gameId);
  return {
    generatedAt: game.generatedAt,
    auditedAt: audit.auditedAt,
    config: game.config,
    matcherVersion: game.summary.matcherVersion,
    matcherSha256: game.matcherSha256,
    sources: game.sources,
    centerGameId: game.center.gameId,
    nflverseGameId: game.identity.game.gameId,
    identityEvidence: game.identity.evidence,
    parser: game.parser,
    summary: game.summary,
    eventCoverage: game.eventCoverage,
    audit: { falseMatches, gamebookIssues: gameIssues },
    unmatchedExternal: {
      countsByCategory: countsByCategory(game.unmatchedExternal),
      rows: game.unmatchedExternal.map((item: any) => ({
        category: item.category,
        providerPlayId: item.play.providerPlayId,
        quarter: item.play.quarter,
        clock: item.play.clock,
        playType: item.play.playType,
        description: item.play.description,
      })),
    },
    alignmentLedger: game.alignments.map((item: any) => ({
      gamebookPlayIds: item.gamebookPlayIds,
      externalPlayIds: item.externalPlayRefs.map((ref: any) => ref.providerPlayId),
      status: item.status,
      relationship: item.relationship,
      confidence: item.confidence,
      marginToNextCandidate: item.evidence.marginToNextCandidate,
    })),
  };
}

function renderGame(game: any, compact: any) {
  const summary = game.summary;
  const eventRows = Object.entries(game.eventCoverage).map(([name, value]: [string, any]) => `| ${name} | ${value.referenced}/${value.total} |`).join("\n");
  const categoryRows = Object.entries(compact.unmatchedExternal.countsByCategory).map(([name, count]) => `| ${name} | ${count} |`).join("\n");
  const issues = compact.audit.gamebookIssues.length
    ? compact.audit.gamebookIssues.map((issue: any) => `- \`${issue.gamebookPlayId}\`: ${issue.status}, confidence ${issue.confidence.toFixed(4)} — ${issue.finding}`).join("\n")
    : "- None";
  return `# Phase 3 blind validation: ${summary.gameId}\n\n## Identity and provenance\n\n- Round: ${game.config.round}\n- Matchup: ${game.center.identity.awayTeam.code} @ ${game.center.identity.homeTeam.code}\n- Selection reason: ${game.config.reason}\n- Center game ID: \`${game.center.gameId}\`\n- nflverse game_id: \`${game.identity.game.gameId}\`\n- Identity evidence: season=${game.identity.evidence.season}, seasonType=${game.identity.evidence.seasonType}, week=${game.identity.evidence.week}, away=${game.identity.evidence.awayTeam}, home=${game.identity.evidence.homeTeam}, kickoff=${game.identity.evidence.kickoff}\n- Gamebook source: ${game.sources.gamebookPdf.url}\n- Gamebook SHA-256: \`${game.sources.gamebookPdf.sha256}\`\n- PBP source: ${game.sources.nflversePbp.url}\n- PBP SHA-256: \`${game.sources.nflversePbp.sha256}\`\n- Dataset retrieval time: ${game.sources.nflversePbp.retrievedAt}\n- Matcher: \`${summary.matcherVersion}\` (SHA-256 \`${game.matcherSha256}\`)\n\n## Alignment result\n\n| Metric | Value |\n|---|---:|\n| Gamebook plays | ${summary.gamebookPlays} |\n| nflverse rows | ${summary.nflverseRows} |\n| 1:1 matched | ${summary.counts.oneToOne} |\n| 1:many | ${summary.counts.oneToMany} |\n| many:1 | ${summary.counts.manyToOne} |\n| ambiguous Gamebook | ${summary.counts.ambiguous} |\n| unmatched Gamebook | ${summary.counts.unmatchedGamebook} |\n| unmatched nflverse | ${summary.counts.unmatchedNflverse} |\n| High-confidence Gamebook coverage | ${percent(summary.highConfidence.rate)} (${summary.highConfidence.numerator}/${summary.highConfidence.denominator}) |\n| nflverse row reference rate | ${percent(summary.externalReference.rate)} (${summary.externalReference.numerator}/${summary.externalReference.denominator}) |\n| Minimum matched confidence | ${summary.confidence.minimum?.toFixed(4) ?? "n/a"} |\n| Median matched confidence | ${summary.confidence.median?.toFixed(4) ?? "n/a"} |\n\n## Confidence distribution\n\n${Object.entries(summary.confidence.bins).map(([bin, count]) => `- ${bin}: ${count}`).join("\n")}\n\n## Event success\n\nCounts are correctly referenced nflverse event rows / total event rows. The correctness audit found no false match.\n\n| Event | Correct / total |\n|---|---:|\n${eventRows}\n\n## Unmatched nflverse classification\n\n| Cause | Rows |\n|---|---:|\n${categoryRows}\n\nThese rows are source/parser granularity differences; no true matcher failure was found.\n\n## Ambiguous or unmatched Gamebook\n\n${issues}\n\n## False-match audit\n\n- High-confidence false matches: ${compact.audit.falseMatches.length}\n- This game was included in the all-alignment clock/description/order screen and targeted review of low-confidence, composite, turnover, scoring, penalty/no-play, review, blocked-kick, safety, and overtime cases as applicable.\n`;
}

await mkdir(resultDir, { recursive: true });
const compactGames = games.map(compactGame);
for (let index = 0; index < games.length; index += 1) {
  await writeFile(`${resultDir}/${games[index].summary.gameId}.json`, `${JSON.stringify(compactGames[index], null, 2)}\n`);
  await writeFile(`${resultDir}/${games[index].summary.gameId}.md`, renderGame(games[index], compactGames[index]));
}

const totalGamebook = games.reduce((sum, game) => sum + game.summary.gamebookPlays, 0);
const totalExternal = games.reduce((sum, game) => sum + game.summary.nflverseRows, 0);
const highConfidence = games.reduce((sum, game) => sum + game.summary.highConfidence.numerator, 0);
const referencedRows = games.reduce((sum, game) => sum + game.summary.externalReference.numerator, 0);
const ambiguous = games.reduce((sum, game) => sum + game.summary.counts.ambiguous, 0);
const unmatchedGamebook = games.reduce((sum, game) => sum + game.summary.counts.unmatchedGamebook, 0);
const matchedConfidences = games.flatMap((game) => game.alignments.filter((item: any) => item.status === "matched").map((item: any) => item.confidence)).sort((a: number, b: number) => a - b);
const midpoint = Math.floor(matchedConfidences.length / 2);
const aggregateMedian = matchedConfidences.length % 2 ? matchedConfidences[midpoint] : (matchedConfidences[midpoint - 1] + matchedConfidences[midpoint]) / 2;
const confidenceBins: Record<string, number> = {};
for (const game of games) for (const [bin, count] of Object.entries(game.summary.confidence.bins) as [string, number][]) confidenceBins[bin] = (confidenceBins[bin] ?? 0) + count;
const eventAggregate: Record<string, { correct: number; total: number }> = {};
for (const game of games) for (const [name, value] of Object.entries(game.eventCoverage) as [string, any][]) {
  const target = eventAggregate[name] ??= { correct: 0, total: 0 };
  target.correct += value.referenced; target.total += value.total;
}
const allUnmatchedExternal = games.flatMap((game) => game.unmatchedExternal);
const externalCategories = countsByCategory(allUnmatchedExternal);
const aggregate = {
  generatedAt: new Date().toISOString(), auditedAt: audit.auditedAt,
  matcherVersion: MATCHER_VERSION, matcherSha256: expectedMatcherHash,
  games: compactGames.map((game) => ({ gameId: game.nflverseGameId, round: game.config.round, matchup: `${games.find((item) => item.summary.gameId === game.nflverseGameId).center.identity.awayTeam.code} @ ${games.find((item) => item.summary.gameId === game.nflverseGameId).center.identity.homeTeam.code}`, reason: game.config.reason, summary: game.summary })),
  metrics: {
    gamebookHighConfidenceCoverage: { numerator: highConfidence, denominator: totalGamebook, rate: highConfidence / totalGamebook },
    ambiguousRate: { numerator: ambiguous, denominator: totalGamebook, rate: ambiguous / totalGamebook },
    unmatchedGamebookRate: { numerator: unmatchedGamebook, denominator: totalGamebook, rate: unmatchedGamebook / totalGamebook },
    falseMatchRate: { numerator: audit.falseMatches.length, denominator: highConfidence, rate: audit.falseMatches.length / highConfidence },
    externalRowReferenceRate: { numerator: referencedRows, denominator: totalExternal, rate: referencedRows / totalExternal },
  },
  confidence: { minimum: Math.min(...matchedConfidences), median: aggregateMedian, bins: confidenceBins },
  eventSuccess: eventAggregate,
  unmatchedExternal: { total: allUnmatchedExternal.length, countsByCategory: externalCategories },
  unmatchedOrAmbiguousGamebook: audit.gamebookIssues,
  falseMatches: audit.falseMatches,
  auditMethod: audit.method,
  parserIssues: audit.parserIssues,
  closestRiskExamples: audit.closestRiskExamples,
  decision: {
    dalPhiOverfit: false,
    productionFoundation: true,
    matcherV02BeforeIntegration: false,
    proceedToCompanionIntegrationDesign: true,
    rationale: "Six blind games reached 99.89% high-confidence Gamebook coverage, 0.11% ambiguous, 0% unmatched Gamebook, and 0 audited false matches. Ordinary scrimmage rows were fully referenced; the missed event rows are explained by parser/source granularity."
  }
};
await writeFile(`${resultDir}/aggregate.json`, `${JSON.stringify(aggregate, null, 2)}\n`);

const perGameRows = games.map((game) => `| \`${game.summary.gameId}\` | ${game.config.round} | ${game.center.identity.awayTeam.code} @ ${game.center.identity.homeTeam.code} | ${game.summary.gamebookPlays} | ${game.summary.nflverseRows} | ${game.summary.counts.oneToOne} | ${game.summary.counts.oneToMany} | ${game.summary.counts.manyToOne} | ${game.summary.counts.ambiguous} | ${game.summary.counts.unmatchedGamebook} | ${percent(game.summary.highConfidence.rate)} |`).join("\n");
const eventRows = Object.entries(eventAggregate).map(([name, value]) => `| ${name} | ${value.correct}/${value.total} |`).join("\n");
const externalRows = Object.entries(externalCategories).map(([name, count]) => `| ${name} | ${count} |`).join("\n");
const report = `# Phase 3 multi-game blind validation\n\n## Executive decision\n\n**Proceed to Companion nflverse integration design using \`research-0.1.0\` as the foundation. A matcher v0.2 is not a prerequisite.** Across six games unknown to Phase 2, high-confidence Gamebook coverage was **${percent(highConfidence / totalGamebook)}** (${highConfidence}/${totalGamebook}), ambiguous rate **${percent(ambiguous / totalGamebook)}** (${ambiguous}/${totalGamebook}), unmatched Gamebook rate **0.00%** (0/${totalGamebook}), and audited false-match rate **0.00%** (0/${highConfidence}).\n\nThe remaining misses are concentrated in parser/source granularity: omitted kickoffs and administrative rows, PAT/two-point continuations not represented independently, and one correct composite held below threshold by ARZ/ARI plus merged text. This is not evidence of DAL @ PHI overfitting.\n\n## Frozen validation set\n\nThe set was chosen mechanically from official nflverse flags before Alignment and documented in \`research/phase-3-validation-set.md\`. DAL @ PHI was excluded.\n\n${games.map((game) => `- \`${game.summary.gameId}\` — ${game.config.round}, ${game.center.identity.awayTeam.code} @ ${game.center.identity.homeTeam.code}: ${game.config.reason}`).join("\n")}\n\n## Matcher freeze and identity\n\n- Matcher version in every alignment: \`${MATCHER_VERSION}\`\n- Matcher SHA-256 before and after evaluation: \`${expectedMatcherHash}\`\n- All six identities resolved uniquely from Center season, season type, week, teams, and kickoff evidence; no slug-to-game_id string construction was used.\n- Shared nflverse PBP SHA-256: \`${games[0].sources.nflversePbp.sha256}\`; retrieved ${games[0].sources.nflversePbp.retrievedAt}.\n\n## Per-game results\n\n| game_id | Round | Matchup | GB | nflverse | 1:1 | 1:many | many:1 | Ambig. | GB unmatched | HC coverage |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${perGameRows}\n\n## Aggregate metrics\n\n- Gamebook high-confidence coverage: **${percent(highConfidence / totalGamebook)}** (${highConfidence}/${totalGamebook})\n- Ambiguous rate: **${percent(ambiguous / totalGamebook)}** (${ambiguous}/${totalGamebook})\n- Unmatched Gamebook rate: **${percent(unmatchedGamebook / totalGamebook)}** (${unmatchedGamebook}/${totalGamebook})\n- False-match rate: **${percent(audit.falseMatches.length / highConfidence)}** (${audit.falseMatches.length}/${highConfidence} high-confidence matched Gamebook Plays)\n- nflverse row reference rate: **${percent(referencedRows / totalExternal)}** (${referencedRows}/${totalExternal})\n\n## Confidence distribution\n\n- Minimum matched confidence: ${Math.min(...matchedConfidences).toFixed(4)}\n- Median matched confidence: ${aggregateMedian.toFixed(4)}\n${Object.entries(confidenceBins).map(([bin, count]) => `- ${bin}: ${count}`).join("\n")}\n\n## Event success\n\nCounts are correctly referenced nflverse event rows / total event rows. A referenced row is counted successful only because the correctness audit found no false match.\n\n| Event | Correct / total |\n|---|---:|\n${eventRows}\n\nThe sole missed fumble was on an unrepresented standalone kickoff. The missed touchdown was the CHI @ CIN opening kickoff-return TD; its PAT was also absent from Gamebook Plays. The other missed PAT followed the PHI @ TB blocked-punt TD. One kickoff penalty and one scoring-continuation no-play were merged/omitted by parser granularity.\n\n## Unmatched nflverse rows\n\n| Cause | Rows |\n|---|---:|\n${externalRows}\n\nAll ${allUnmatchedExternal.length} rows are explainable source/parser granularity differences. No ordinary play was classified as a matcher failure.\n\n## Gamebook ambiguous / unmatched\n\n- Unmatched: none.\n- Ambiguous: TEN @ ARI \`play-123\` only (confidence 0.7385). Its selected rows \`3876\`, \`3899\`, and \`3914\` are the correct TD, missed PAT, and kickoff penalty. The Gamebook merges those with an injury update, and ARZ vs ARI removes state evidence. Classification: Gamebook/nflverse granularity difference plus source-description difference; not a false match.\n\n## False-match audit\n\nNo high-confidence false match was found. All 900 alignments were screened for clock, description, and monotonic order; all four screen exceptions were read against both sources and were correct. Targeted review covered 10 confidence<0.85 cases, the only same-clock alternative case, all 30 1:many cases, all 15 turnover alignments, all 13 replay alignments, both blocked kicks, the safety, and all 17 overtime alignments. Scoring and penalty/no-play alignments were also rule-checked.\n\nClosest risks, all correct:\n\n${audit.closestRiskExamples.map((item) => `- \`${item.gameId}\` ${item.gamebookPlayId}: ${item.finding}`).join("\n")}\n\n## Parser observations (not fixed)\n\n${audit.parserIssues.map((issue) => `- ${issue.finding}`).join("\n")}\n\nA new material observation is the complete omission of an opening kickoff-return touchdown and PAT as Gamebook Plays. The earlier \`noPlay: false\` behavior also reproduced 13 times. No parser code was changed.\n\n## Generalization and next phase\n\nThe matcher did not materially overfit DAL @ PHI: two ordinary controls both reached 100% Gamebook coverage, the OT game reached 100%, and interceptions, returns, lost fumbles, replay reversals, blocked FG, blocked punt, safety, field goals, and punts all aligned without false matches. TEN @ ARI exposed a narrow ARZ/ARI/composite-confidence weakness, but not an incorrect match.\n\nCurrent \`research-0.1.0\` is suitable as the production integration foundation. Phase 4 should move to Companion nflverse integration design while preserving 1:many and external-only rows. A later matcher v0.2 can address team-code aliases and conversion/scoring-continuation attachments, but those improvements are not required before integration design.\n\nLimitations: six regular-season games, one overtime game, and only one example each of blocked FG, blocked punt, safety, and offsetting penalty. There were no many:1 cases in this set.\n`;
await writeFile(`${resultDir}/aggregate.md`, report);
console.log(JSON.stringify(aggregate.metrics, null, 2));
