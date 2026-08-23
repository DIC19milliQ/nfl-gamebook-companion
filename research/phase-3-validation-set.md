# Phase 3 blind validation set

This validation set was frozen before any Phase 3 alignment run. DAL @ PHI, the Phase 2 development game, is excluded.

## Selection method

The official nflverse 2025 PBP CSV was scanned by `game_id`. Candidate features came from nflverse flags and fields (`interception`, `return_yards`, `fumble`, `fumble_lost`, `replay_or_challenge`, `replay_or_challenge_result`, `field_goal_attempt`, `field_goal_result`, `punt_blocked`, `safety`, `penalty`, `kickoff_attempt`, `touchdown`, `punt_attempt`) plus case-insensitive description checks for reversed/overturned and offsetting rulings. Games were ranked for rare-event coverage, then greedily selected to avoid redundant cases. Two games with no interception, lost fumble, replay, blocked kick, safety, or offsetting penalty were added as ordinary controls.

Selection source snapshot:

- PBP: `play_by_play_2025.csv.gz`, retrieved 2026-08-23T15:24:19Z, SHA-256 `2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978`
- Schedule: `games.csv`, retrieved 2026-08-23T15:24:18Z, SHA-256 `b24c3d9019b38551570a063ff3e9d7f694452652300fdf69990a43042bd8320f`

## Frozen games

### `2025_09_CHI_CIN` — Week 9 — CHI @ CIN

Major events in the selection scan:

- 2 interceptions, including 1 non-zero return
- 1 lost fumble
- 4 replay/challenge rows with reversed/overturned text
- 1 blocked field-goal attempt
- 2 kickoff penalties
- 11 touchdowns, 6 field-goal attempts, and 3 punts

Reason: highest rare-event score in the mechanical scan and the broadest single-game coverage of replay reversals, a blocked field goal, turnovers, kickoff penalties, and scoring.

### `2025_04_PHI_TB` — Week 4 — PHI @ TB

Major events in the selection scan:

- 1 interception and 1 lost fumble
- 3 replay/challenge rows, 2 with reversed/overturned text
- 1 blocked punt
- 1 safety
- 2 kickoff penalties
- 6 touchdowns, 4 field-goal attempts, and 11 punts

Reason: supplies the blocked-punt and safety cases not covered by CHI @ CIN, while also exercising replay and turnover handling.

### `2025_14_PHI_LAC` — Week 14 — PHI @ LAC

Major events in the selection scan:

- overtime (quarter 5 rows)
- 5 interceptions, all with non-zero returns
- 2 lost fumbles, both with non-zero returns
- 2 replay/challenge rows with reversed/overturned text
- 2 touchdowns, 10 field-goal attempts, and 8 punts

Reason: deliberately stresses overtime sequencing, repeated same-class turnovers, return text, and a kick-heavy low-touchdown game.

### `2025_05_TEN_ARI` — Week 5 — TEN @ ARI

Major events in the selection scan:

- 1 interception
- 4 fumbles, all marked lost
- 4 replay/challenge rows, 3 with reversed/overturned text
- 1 offsetting-penalty description
- 2 kickoff penalties
- 5 touchdowns, 3 field-goal attempts, and 12 punts

Reason: concentrates lost-fumble and offsetting-penalty cases and provides an additional replay/granularity stress test without duplicating a blocked kick.

### `2025_06_DET_KC` — Week 6 — DET @ KC

Major events in the selection scan:

- no interception, lost fumble, replay, blocked kick, safety, offsetting penalty, or kickoff penalty
- 6 touchdowns, 2 field-goal attempts, and 4 punts

Reason: ordinary control game with normal scrimmage and scoring flow and few special-event confounders.

### `2025_06_SEA_JAX` — Week 6 — SEA @ JAX

Major events in the selection scan:

- no interception, lost fumble, replay, blocked kick, safety, or offsetting penalty
- 1 kickoff penalty
- 4 touchdowns, 3 field-goal attempts, and 15 punts

Reason: second ordinary control, selected independently of matcher results; its high punt volume tests repetitive special-teams sequencing in an otherwise straightforward game.

## Freeze statement

The selected six games were frozen with matcher version `research-0.1.0` and `research/matcher.ts` SHA-256 `5d09bee7bf4009783f2d85660aa459bb0a34b3f8184ebcb43285b800539dc2e4`. No Phase 3 alignment had been run when this report was written.
