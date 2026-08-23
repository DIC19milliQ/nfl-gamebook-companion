# Phase 3 multi-game blind validation

## Executive decision

**Proceed to Companion nflverse integration design using `research-0.1.0` as the foundation. A matcher v0.2 is not a prerequisite.** Across six games unknown to Phase 2, high-confidence Gamebook coverage was **99.89%** (899/900), ambiguous rate **0.11%** (1/900), unmatched Gamebook rate **0.00%** (0/900), and audited false-match rate **0.00%** (0/899).

The remaining misses are concentrated in parser/source granularity: omitted kickoffs and administrative rows, PAT/two-point continuations not represented independently, and one correct composite held below threshold by ARZ/ARI plus merged text. This is not evidence of DAL @ PHI overfitting.

## Frozen validation set

The set was chosen mechanically from official nflverse flags before Alignment and documented in `research/phase-3-validation-set.md`. DAL @ PHI was excluded.

- `2025_09_CHI_CIN` — Week 9, CHI @ CIN: Replay reversals, blocked field goal, turnovers, kickoff penalties, and high scoring.
- `2025_04_PHI_TB` — Week 4, PHI @ TB: Blocked punt, safety, replay, turnovers, and kickoff penalties.
- `2025_14_PHI_LAC` — Week 14, PHI @ LAC: Overtime, repeated interceptions/returns, lost fumbles/returns, and kick-heavy scoring.
- `2025_05_TEN_ARI` — Week 5, TEN @ ARI: Four lost fumbles, replay reversals, offsetting penalty, and kickoff penalties.
- `2025_06_DET_KC` — Week 6, DET @ KC: Ordinary control with no flagged turnover, replay, blocked kick, safety, offsetting, or kickoff penalty.
- `2025_06_SEA_JAX` — Week 6, SEA @ JAX: Ordinary control with high punt volume and only one kickoff penalty among targeted rare events.

## Matcher freeze and identity

- Matcher version in every alignment: `research-0.1.0`
- Matcher SHA-256 before and after evaluation: `5d09bee7bf4009783f2d85660aa459bb0a34b3f8184ebcb43285b800539dc2e4`
- All six identities resolved uniquely from Center season, season type, week, teams, and kickoff evidence; no slug-to-game_id string construction was used.
- Shared nflverse PBP SHA-256: `2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978`; retrieved 2026-08-23T15:24:19.810Z.

## Per-game results

| game_id | Round | Matchup | GB | nflverse | 1:1 | 1:many | many:1 | Ambig. | GB unmatched | HC coverage |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `2025_09_CHI_CIN` | Week 9 | CHI @ CIN | 159 | 204 | 151 | 8 | 0 | 0 | 0 | 100.00% |
| `2025_04_PHI_TB` | Week 4 | PHI @ TB | 147 | 179 | 142 | 5 | 0 | 0 | 0 | 100.00% |
| `2025_14_PHI_LAC` | Week 14 | PHI @ LAC | 166 | 196 | 164 | 2 | 0 | 0 | 0 | 100.00% |
| `2025_05_TEN_ARI` | Week 5 | TEN @ ARI | 153 | 180 | 148 | 4 | 0 | 1 | 0 | 99.35% |
| `2025_06_DET_KC` | Week 6 | DET @ KC | 125 | 154 | 119 | 6 | 0 | 0 | 0 | 100.00% |
| `2025_06_SEA_JAX` | Week 6 | SEA @ JAX | 150 | 175 | 146 | 4 | 0 | 0 | 0 | 100.00% |

## Aggregate metrics

- Gamebook high-confidence coverage: **99.89%** (899/900)
- Ambiguous rate: **0.11%** (1/900)
- Unmatched Gamebook rate: **0.00%** (0/900)
- False-match rate: **0.00%** (0/899 high-confidence matched Gamebook Plays)
- nflverse row reference rate: **85.94%** (935/1088)

## Confidence distribution

- Minimum matched confidence: 0.7659
- Median matched confidence: 1.0000
- 0.95-1.00: 750
- 0.90-0.95: 62
- 0.85-0.90: 78
- 0.80-0.85: 8
- 0.75-0.80: 1

## Event success

Counts are correctly referenced nflverse event rows / total event rows. A referenced row is counted successful only because the correctness audit found no false match.

| Event | Correct / total |
|---|---:|
| Interception | 9/9 |
| Interception return | 6/6 |
| Fumble | 15/16 |
| Lost fumble | 8/8 |
| Fumble return | 3/3 |
| Replay review | 13/13 |
| Replay reversal | 11/11 |
| Blocked FG | 1/1 |
| Blocked punt | 1/1 |
| Safety | 1/1 |
| Offsetting penalty | 1/1 |
| Unusual no-play | 1/1 |
| Kickoff penalty | 6/7 |
| Penalty / no-play | 74/76 |
| Touchdown | 33/34 |
| Extra point | 29/31 |
| Field goal | 28/28 |
| Punt | 53/53 |
| Ordinary scrimmage | 757/757 |

The sole missed fumble was on an unrepresented standalone kickoff. The missed touchdown was the CHI @ CIN opening kickoff-return TD; its PAT was also absent from Gamebook Plays. The other missed PAT followed the PHI @ TB blocked-punt TD. One kickoff penalty and one scoring-continuation no-play were merged/omitted by parser granularity.

## Unmatched nflverse rows

| Cause | Rows |
|---|---:|
| Administrative timeout | 53 |
| Parser granularity difference / conversion | 3 |
| Parser granularity difference / PAT | 2 |
| Parser granularity difference / scoring continuation | 1 |
| Quarter/game marker | 31 |
| Standalone kickoff | 63 |

All 153 rows are explainable source/parser granularity differences. No ordinary play was classified as a matcher failure.

## Gamebook ambiguous / unmatched

- Unmatched: none.
- Ambiguous: TEN @ ARI `play-123` only (confidence 0.7385). Its selected rows `3876`, `3899`, and `3914` are the correct TD, missed PAT, and kickoff penalty. The Gamebook merges those with an injury update, and ARZ vs ARI removes state evidence. Classification: Gamebook/nflverse granularity difference plus source-description difference; not a false match.

## False-match audit

No high-confidence false match was found. All 900 alignments were screened for clock, description, and monotonic order; all four screen exceptions were read against both sources and were correct. Targeted review covered 10 confidence<0.85 cases, the only same-clock alternative case, all 30 1:many cases, all 15 turnover alignments, all 13 replay alignments, both blocked kicks, the safety, and all 17 overtime alignments. Scoring and penalty/no-play alignments were also rule-checked.

Closest risks, all correct:

- `2025_05_TEN_ARI` play-20: Correct Spears run despite Gamebook 5:49 versus nflverse 5:50 and ARZ versus ARI.
- `2025_06_SEA_JAX` play-114: Only same-clock alternative case. The selected Walker run is exact; the alternative is the preceding kickoff and trails by a 0.2421 confidence margin.
- `2025_04_PHI_TB` play-147: Correct end-zone safety; low confidence comes from sparse/missing state fields rather than a competing row.

## Parser observations (not fixed)

- Thirteen Gamebook descriptions contain 'No Play' while parsed noPlay remains false. They still aligned correctly.
- CHI @ CIN opening kickoff return touchdown (nflverse 39) and its PAT (63) produce no Gamebook Play, so neither can be referenced.
- PHI @ TB blocked-punt return TD is a Gamebook Play, but the following PAT row (nflverse 211) is not attached to its description and remains external-only.
- Three two-point conversion rows and one scoring-continuation no-play row are embedded in preceding Gamebook scoring descriptions but are not separately referenced.
- Standalone kickoffs generally do not become Gamebook Plays; six kickoff-penalty rows attach through existing 1:many behavior and one kickoff penalty remains external-only.
- Fifty-three timeout rows and thirty-one quarter/game markers have no Gamebook Play, as expected from parser granularity.

A new material observation is the complete omission of an opening kickoff-return touchdown and PAT as Gamebook Plays. The earlier `noPlay: false` behavior also reproduced 13 times. No parser code was changed.

## Generalization and next phase

The matcher did not materially overfit DAL @ PHI: two ordinary controls both reached 100% Gamebook coverage, the OT game reached 100%, and interceptions, returns, lost fumbles, replay reversals, blocked FG, blocked punt, safety, field goals, and punts all aligned without false matches. TEN @ ARI exposed a narrow ARZ/ARI/composite-confidence weakness, but not an incorrect match.

Current `research-0.1.0` is suitable as the production integration foundation. Phase 4 should move to Companion nflverse integration design while preserving 1:many and external-only rows. A later matcher v0.2 can address team-code aliases and conversion/scoring-continuation attachments, but those improvements are not required before integration design.

Limitations: six regular-season games, one overtime game, and only one example each of blocked FG, blocked punt, safety, and offsetting penalty. There were no many:1 cases in this set.
