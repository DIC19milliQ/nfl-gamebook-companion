# nflverse Play Alignment Research Harness

This directory is a prototype boundary around the production Gamebook parser. It does not add nflverse fields to `Play`, `GameData`, or the UI.

```text
Center metadata + nflverse schedule -> identity resolution
Gamebook PDF -> existing parser -> GamebookPlayInput[]
nflverse season CSV -> NflversePlay[]
GamebookPlayInput[] + NflversePlay[] -> pure matcher -> PlayAlignment[]
```

## Run

The large upstream files belong in ignored `research/cache/`:

```powershell
curl.exe -fL "https://spoiler-free-nfl-gamebooks.dic19.chatgpt.site/api/companion/gamebook?game=cowboys-at-eagles-2025-reg-1" -o research/cache/center-metadata.json
curl.exe -fL "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv" -o research/cache/games.csv
curl.exe -fL "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz" -o research/cache/play_by_play_2025.csv.gz
# Download gamebookUrl from center-metadata.json as:
# research/cache/cowboys-at-eagles-2025-reg-1.pdf

npm run research:alignment
npm run research:check
```

The run writes the compact, single-game research artifact and Markdown report to `research/results/`. The committed JSON is also the real-game regression fixture; the 18 MB season PBP and PDF remain ignored.

## Source and DTO boundary

- Official distribution: [nflverse-data](https://github.com/nflverse/nflverse-data) release assets.
- PBP file: `play_by_play_2025.csv.gz`, filtered after download to the schedule-resolved `game_id`.
- Schedule file: `games.csv`.
- Used PBP columns are recorded in the result JSON together with source URLs, retrieval timestamps, file sizes, and SHA-256 hashes.
- `NflversePlay` is deliberately separate from the production `Play` type. EPA and WP are retained only to prove analytics availability after alignment.

## Identity resolution

`identity.ts` filters nflverse schedule rows by season, mapped season type, week, away code, home code, and kickoff. It requires one candidate. It never derives `game_id` by rewriting the NFL Game Center ID.

For this fixture, Center `2025 / regular / Week 1 / DAL @ PHI / 2025-09-05T00:20Z` matches schedule `2025 / REG / Week 1 / DAL @ PHI / 2025-09-04 20:20 ET`, yielding `2025_01_DAL_PHI`.

## Matcher and confidence

`matcher.ts` is pure: it accepts two DTO arrays and performs no I/O. Candidate evidence uses weighted criteria:

| Criterion | Weight |
|---|---:|
| Quarter | 0.14 |
| Clock | 0.14 |
| Possession | 0.10 |
| Down | 0.08 |
| Distance | 0.07 |
| Start yard line | 0.08 |
| Play type compatibility | 0.10 |
| Description token Dice similarity | 0.24 |
| Monotonic sequence | 0.05 |

Missing criteria are excluded from the applicable denominator and are still recorded as `missing`. Description text removes source-only clock prefixes, jersey-number prefixes, Gamebook stat markers, punctuation noise, and a small stop-word set. It does not depend on description alone: candidate generation also considers state, and evidence retains every criterion.

`matched` requires confidence >= 0.75. A candidate at or above 0.58 whose top-two margin is below 0.045 becomes `ambiguous`; weaker candidates become `unmatched`. Alternatives and margins remain in evidence.

The representation supports `1:1`, `1:many`, and `many:1`. Adjacent PAT, kickoff, or administrative rows attach only when the Gamebook text contains evidence of that component. A conservative pre-pass can combine two consecutive Gamebook fragments into one nflverse row when their combined description is strong and neither fragment alone is strong.

## Tests

`tests/play-alignment.test.ts` covers clear 1:1, same-clock candidates, penalty/no-play, 1:many, many:1, ambiguous, unmatched, identity resolution, and the full 2025 DAL-PHI result fixture.
