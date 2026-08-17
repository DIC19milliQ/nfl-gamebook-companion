import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { parseGamebook } from "./parser";
import { renderPlayDescription, renderPlaySections, type DescriptionLanguage } from "./playDescription";
import { fieldView } from "./field";
import type { Drive, GameData, Play, PlayParticipant, Player, TeamId } from "./types";

type Mode = "watch" | "replay" | "explore";
type ExploreTab = "flow" | "drives" | "plays" | "players" | "stats";

const SAMPLE_FILE = "colts-at-patriots-2026-08-13.pdf";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const downLabel = (play?: Play) => play ? `${play.down}${["th", "st", "nd", "rd"][play.down] ?? "th"} & ${play.distance}` : "Ready";
const situationLabel = (play?: Play) => play ? `${downLabel(play)} · ${play.yardLine}` : "Ready";
const resultCode = (result: string) => ({
  Touchdown: "TD", "Field Goal": "FG", Punt: "P", Interception: "INT", Fumble: "FUM",
  Downs: "DN", "Missed FG": "MFG", "End of Game": "END", "In Progress": "LIVE",
}[result] ?? result.slice(0, 3).toUpperCase());

function team(game: GameData, id: TeamId) {
  return game.teams.find((candidate) => candidate.id === id)!;
}

function TeamMark({ game, teamId, compact = false }: { game: GameData; teamId: TeamId; compact?: boolean }) {
  const item = team(game, teamId);
  return <span className={`team-mark ${compact ? "compact" : ""}`} style={{ "--team-color": item.color } as CSSProperties}><i /><span><b>{item.id}</b>{!compact && <small>{item.homeAway === "visitor" ? "VISITOR" : "HOME"} · {item.shortName}</small>}</span></span>;
}

function LanguageToggle({ language, onLanguage }: { language: DescriptionLanguage; onLanguage: (language: DescriptionLanguage) => void }) {
  return <div className="language-toggle" role="group" aria-label="Play description language"><span>PLAY TEXT</span>{(["en", "ja"] as const).map((item) => <button key={item} className={language === item ? "active" : ""} aria-pressed={language === item} onClick={() => onLanguage(item)}>{item.toUpperCase()}</button>)}</div>;
}

function scoreAt(game: GameData, cursor: number) {
  const visible = game.scoring.filter((score) => score.playIndex >= 0 && score.playIndex <= cursor);
  const last = visible.at(-1);
  return last ? [last.visitorScore, last.homeScore] : [0, 0];
}

function LoadingScreen({ progress, label }: { progress: number; label: string }) {
  return (
    <main className="loading-screen">
      <div className="loader-mark"><span>GB</span></div>
      <p className="eyebrow">LOCAL PDF PARSER</p>
      <h1>Reading the game.</h1>
      <p className="muted">{label}</p>
      <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      <strong>{progress}%</strong>
    </main>
  );
}

function Landing({ onFile, onDemo, error }: { onFile: (file: File) => void; onDemo: () => void; error: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <main className="landing">
      <header className="landing-brand"><span className="brand-box">GB</span><span>GAMEBOOK<br />COMPANION</span></header>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">ONE PDF. THE WHOLE GAME.</p>
          <h1>Turn the gamebook<br />into game day.</h1>
          <p className="hero-lede">A spoiler-safe second screen, a play-by-play replay, and a deep postgame explorer — built entirely from the NFL Gamebook PDF.</p>
          <div className="privacy-pill"><span>●</span> Parsed on this device · no upload · no data API</div>
        </div>
        <div
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault(); setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) onFile(file);
          }}
        >
          <div className="pdf-glyph">PDF</div>
          <h2>Bring a Gamebook</h2>
          <p>Drop an NFL Gamebook PDF here or choose one from your device.</p>
          <button className="primary-button" onClick={() => inputRef.current?.click()}>Choose PDF</button>
          <input ref={inputRef} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
          <div className="or"><span />OR<span /></div>
          <button className="text-button" onClick={onDemo}>Open Colts @ Patriots sample <span>→</span></button>
          {error && <p className="error-message">{error}</p>}
        </div>
      </section>
      <section className="experience-strip">
        <article><b>01</b><h3>WATCH ALONG</h3><p>Second-screen companion for a replay broadcast.</p></article>
        <article><b>02</b><h3>GAMEBOOK REPLAY</h3><p>Experience the game one locked play at a time.</p></article>
        <article><b>03</b><h3>EXPLORE</h3><p>Connect drives, players, snaps, and every play.</p></article>
      </section>
    </main>
  );
}

function SpoilerToggle({ spoiler, onToggle }: { spoiler: boolean; onToggle: () => void }) {
  return <button className={`spoiler-toggle compact ${spoiler ? "on" : ""}`} onClick={onToggle} aria-pressed={spoiler} title={spoiler ? "Future results are hidden" : "Full game is visible"}><span className="toggle-eye">{spoiler ? "◉" : "○"}</span><b>SPOILER FREE</b><i /></button>;
}

function TopBar({ game, onReset, language, onLanguage, spoiler, onSpoiler }: { game: GameData; onReset: () => void; language: DescriptionLanguage; onLanguage: (language: DescriptionLanguage) => void; spoiler: boolean; onSpoiler: () => void }) {
  return (
    <header className="topbar">
      <button className="wordmark" onClick={onReset}><span className="brand-box">GB</span><span>GAMEBOOK<br />COMPANION</span></button>
      <div className="game-title"><b>{game.game.title}</b><span>{game.game.date} · {game.game.location}</span></div>
      <div className="topbar-actions"><SpoilerToggle spoiler={spoiler} onToggle={onSpoiler} /><LanguageToggle language={language} onLanguage={onLanguage} /><div className="source-badge"><span>✓</span><div><b>{game.validation.status === "complete" ? "PDF PARSED" : "PARTIAL PARSE"}</b><small>{game.source.pageCount} pages · local</small></div></div></div>
    </header>
  );
}

function ModeNav({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) {
  const labels: Record<Mode, [string, string]> = {
    watch: ["WATCH ALONG", "Second-screen companion"],
    replay: ["GAMEBOOK REPLAY", "Experience it play by play"],
    explore: ["EXPLORE", "Stats, drives & players"],
  };
  return (
    <nav className="mode-nav" aria-label="Experience mode">
      {(["watch", "replay", "explore"] as Mode[]).map((item) => (
        <button key={item} className={mode === item ? "active" : ""} onClick={() => onMode(item)}><span>{item === "watch" ? "◉" : item === "replay" ? "▷" : "⌕"}</span><b>{labels[item][0]}</b><small>{labels[item][1]}</small></button>
      ))}
    </nav>
  );
}

function SituationHeader({ game, play, cursor, controls }: { game: GameData; play?: Play; cursor: number; controls?: ReactNode }) {
  const [visitorScore, homeScore] = scoreAt(game, cursor);
  const possession = play ? team(game, play.possession) : undefined;
  const direction = play ? (play.possession === game.teams[0].id ? "RIGHT →" : "← LEFT") : "—";
  return (
    <div className="current-situation" style={{ "--possession-team": possession?.color ?? "#8bf0a6" } as CSSProperties}>
      <div className="situation-score" aria-label={`${game.teams[0].id} ${visitorScore}, ${game.teams[1].id} ${homeScore}`}><span><i style={{ background: game.teams[0].color }} />{game.teams[0].id}</span><b>{visitorScore}<em>–</em>{homeScore}</b><span>{game.teams[1].id}<i style={{ background: game.teams[1].color }} /></span></div>
      <div className="situation-clock"><small>GAME CLOCK</small><b>{play ? `Q${play.quarter} · ${play.clock}` : "PREGAME"}</b></div>
      <div className="situation-possession"><small>POSSESSION</small>{play ? <b><TeamMark game={game} teamId={play.possession} compact /> <span>{direction}</span></b> : <b>READY</b>}</div>
      <div className="situation-down"><small>SITUATION</small><b>{play ? `${downLabel(play)} · ${play.yardLine}` : "BEFORE KICKOFF"}</b></div>
      {controls && <div className="situation-controls">{controls}</div>}
    </div>
  );
}

function Field({ game, play, variant = "situation" }: { game: GameData; play?: Play; variant?: "situation" | "replay" }) {
  const view = fieldView(game, play);
  const directionTeam = play ? team(game, play.possession) : undefined;
  const primaryEnd = view.actionEndPercent ?? view.endPercent;
  const hasPath = variant === "replay" && view.startPercent !== null && primaryEnd !== null;
  const pathLeft = hasPath ? Math.min(view.startPercent!, primaryEnd!) : 0;
  const pathWidth = hasPath ? Math.abs(primaryEnd! - view.startPercent!) : 0;
  const hasAdjustment = variant === "replay" && view.actionEndPercent !== null && view.endPercent !== null && Math.abs(view.actionEndPercent - view.endPercent) > .1;
  const adjustmentLeft = hasAdjustment ? Math.min(view.actionEndPercent!, view.endPercent!) : 0;
  const adjustmentWidth = hasAdjustment ? Math.abs(view.endPercent! - view.actionEndPercent!) : 0;
  return (
    <div className={`field field-${variant} direction-${view.direction}`} aria-label={play ? variant === "replay" ? `${play.possession} possession, play starts at ${view.startPosition}, ${view.finalPosition ? `officially ends at ${view.finalPosition}` : "official end spot unavailable"}, attacking ${view.direction}` : `${play.possession} possession, ball at ${view.startPosition}, attacking ${view.direction}` : "Football field"} style={{ "--left-team": view.leftTeam.color, "--right-team": view.rightTeam.color, "--possession-color": directionTeam?.color ?? "#d9ff66" } as CSSProperties}>
      <div className="endzone left"><b>{view.leftTeam.id}</b><span>END ZONE</span></div>
      <div className="field-of-play">
        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((yard) => <i key={yard} style={{ left: `${yard}%` }}><span>{yard === 0 || yard === 100 ? "G" : yard <= 50 ? yard : 100 - yard}</span></i>)}
      </div>
      {view.firstDownPercent !== null && <div className="first-down-marker" style={{ left: `${view.firstDownPercent}%` }}><span>1ST</span></div>}
      {variant === "replay" && view.startPercent !== null && <div className="line-of-scrimmage" style={{ left: `${view.startPercent}%` }}><span>LOS</span></div>}
      {variant === "situation" && play && <div className="attack-arrow" style={{ left: view.direction === "right" ? `${Math.min(view.ballPercent + 7, 84)}%` : `${Math.max(view.ballPercent - 7, 16)}%` }}><span>{view.direction === "right" ? "→" : "←"}</span></div>}
      {variant === "situation" && <div className="ball-marker" style={{ left: `${view.ballPercent}%` }}><span>{view.startPosition ?? "50"}</span></div>}
      {hasPath && <><div className={`play-path direction-${primaryEnd! >= view.startPercent! ? "right" : "left"}`} style={{ left: `${pathLeft}%`, width: `${Math.max(pathWidth, .8)}%` }}><i>{primaryEnd! >= view.startPercent! ? "›" : "‹"}</i></div><div className="spot-marker start" style={{ left: `${view.startPercent}%` }}><i /><span>START<b>{view.startPosition}</b></span></div></>}
      {hasAdjustment && <div className="official-adjustment" style={{ left: `${adjustmentLeft}%`, width: `${Math.max(adjustmentWidth, .8)}%` }}><i>{view.endPercent! >= view.actionEndPercent! ? "›" : "‹"}</i></div>}
      {variant === "replay" && view.actionEndPercent !== null && hasAdjustment && <div className="spot-marker play-end" style={{ left: `${view.actionEndPercent}%` }}><i /><span>PLAY END<b>{view.actionEndPosition}</b></span></div>}
      {variant === "replay" && view.endPercent !== null && <div className="spot-marker end" style={{ left: `${view.endPercent}%` }}><i /><span>OFFICIAL<b>{view.finalPosition}</b></span></div>}
      {variant === "replay" && play && <div className="field-result-chip">{view.movementYards === null ? "FINAL SPOT · NOT STATED" : `${view.movementYards >= 0 ? "+" : ""}${view.movementYards} YARDS`}</div>}
      <div className="endzone right"><b>{view.rightTeam.id}</b><span>END ZONE</span></div>
    </div>
  );
}

function PlayTag({ kind }: { kind: Play["kind"] }) {
  return <span className={`play-tag ${kind}`}>{kind.replace("field-goal", "FG").toUpperCase()}</span>;
}

function PlayText({ play, language, compact = false }: { play: Play; language: DescriptionLanguage; compact?: boolean }) {
  const sections = renderPlaySections(play, language);
  return <div className={`play-sections ${compact ? "compact" : ""}`} lang={language}>{sections.map((section, index) => <div key={`${section.kind}-${index}`} className={`play-section section-${section.kind} ${section.raw ? "raw" : ""}`}>{language === "ja" && sections.length > 1 && <span>{section.label}</span>}<p>{section.text}</p></div>)}</div>;
}

function PlayRow({ game, play, language, onPlayer }: { game: GameData; play: Play; language: DescriptionLanguage; onPlayer?: (id: string) => void }) {
  return (
    <article className="play-row">
      <div className="play-stamp"><b>Q{play.quarter}</b><span>{play.clock}</span></div>
      <div className="play-down"><b>{downLabel(play)}</b><span>{play.yardLine}</span></div>
      <div className="play-copy"><div><TeamMark game={game} teamId={play.possession} compact /><PlayTag kind={play.kind} />{play.noPlay && <span className="no-play">NO PLAY</span>}</div><PlayText play={play} language={language} compact />
        {!!play.playerIds.length && onPlayer && <div className="player-links">{play.playerIds.slice(0, 4).map((id) => <button key={id} onClick={() => onPlayer(id)}>{id.slice(id.indexOf("-") + 1)}</button>)}</div>}
      </div>
    </article>
  );
}

function Locator({ game, cursor, onCursor }: { game: GameData; cursor: number; onCursor: (value: number) => void }) {
  const play = game.plays[Math.max(0, cursor)];
  return (
    <div className="locator">
      <button onClick={() => onCursor(clamp(cursor - 1, -1, game.plays.length - 1))} aria-label="Previous play">←</button>
      <div className="locator-main"><span>GAME POSITION</span><b>{cursor < 0 ? "Before kickoff" : `Q${play.quarter} ${play.clock} · Play ${cursor + 1} of ${game.plays.length}`}</b>
        <input aria-label="Game position" type="range" min={-1} max={game.plays.length - 1} value={cursor} onChange={(event) => onCursor(number(event.target.value))} />
      </div>
      <button onClick={() => onCursor(clamp(cursor + 1, -1, game.plays.length - 1))} aria-label="Next play">→</button>
    </div>
  );
}

function number(value: string) { return Number(value); }

const PARTICIPANT_LABELS: Record<PlayParticipant["role"], string> = {
  passer: "PASSER", target: "TARGET", receiver: "RECEIVER", rusher: "RUSHER", tackler: "TACKLER", defender: "DEFENDER",
  "qb-hit": "QB HIT", sacker: "SACKER", interceptor: "INTERCEPTOR", "forced-fumble": "FORCED FUMBLE", recovery: "RECOVERY",
  kicker: "KICKER", punter: "PUNTER", returner: "RETURNER", holder: "HOLDER", snapper: "SNAPPER", penalized: "PENALTY", other: "INVOLVED",
};

function uniqueParticipants(participants: PlayParticipant[]) {
  return participants.filter((participant, index) => participants.findIndex((candidate) => candidate.name === participant.name && candidate.role === participant.role) === index);
}

function ParticipantList({ game, participants, onPlayer, empty }: { game: GameData; participants: PlayParticipant[]; onPlayer: (id: string) => void; empty: string }) {
  const visible = uniqueParticipants(participants);
  if (!visible.length) return <p className="empty">{empty}</p>;
  return <div className="participant-list">{visible.map((participant) => {
    const item = participant.playerId ? game.players.find((player) => player.id === participant.playerId) : undefined;
    return <button key={`${participant.role}-${participant.name}`} disabled={!item} onClick={() => item && onPlayer(item.id)}><span>{PARTICIPANT_LABELS[participant.role]}</span><b>{participant.name}</b><small>{participant.teamId ? `${participant.teamId} · ${item?.position ?? "—"}` : item?.position ?? "—"}</small></button>;
  })}</div>;
}

function WatchView({ game, cursor, spoiler, language, onCursor, onPlayer }: { game: GameData; cursor: number; spoiler: boolean; language: DescriptionLanguage; onCursor: (value: number) => void; onPlayer: (id: string) => void }) {
  const current = game.plays[cursor];
  const drive = current?.driveId ? game.drives.find((candidate) => candidate.id === current.driveId) : undefined;
  const [query, setQuery] = useState("");
  const searchable = spoiler ? game.plays.slice(0, cursor + 1) : game.plays;
  const results = query.trim() ? searchable.filter((play) => `${play.clock} ${play.yardLine} ${play.description}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : [];
  const recent = searchable.slice(Math.max(0, searchable.length - 3)).reverse();
  const driveParticipants = drive ? uniqueParticipants(game.plays.filter((play) => drive.playIds.includes(play.id) && play.index <= cursor).flatMap((play) => play.details.participants))
    .filter((participant) => participant.teamId === drive.teamId && ["passer", "receiver", "target", "rusher", "kicker", "punter", "returner"].includes(participant.role)).slice(0, 8) : [];
  return (
    <div className="view-grid watch-view" data-play-anchor>
      <section className="main-column">
        <SituationHeader game={game} play={current} cursor={cursor} controls={<Locator game={game} cursor={cursor} onCursor={onCursor} />} />
        <div className="situation-card">
          <Field game={game} play={current} />
          {current ? <div className="current-play"><PlayTag kind={current.kind} /><PlayText play={current} language={language} /></div> : <div className="current-play waiting"><p>No future play or field position is shown. Use the locator to sync with the video.</p></div>}
        </div>
        {drive && <div className="drive-ribbon"><div><span>CURRENT DRIVE</span><TeamMark game={game} teamId={drive.teamId} /></div><div><span>START</span><b>{drive.startPosition}</b></div><div><span>SO FAR</span><b>{drive.playIds.filter((id) => game.plays.find((play) => play.id === id)!.index <= cursor).length} plays</b></div><div><span>BOOK RESULT</span><b className={spoiler && cursor < drive.lastPlayIndex ? "redacted" : ""}>{spoiler && cursor < drive.lastPlayIndex ? "HIDDEN" : drive.result}</b></div></div>}
      </section>
      <aside className="side-column">
        <div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Clock, player, sack, fumble…" /></div>
        {query && <div className="search-results panel"><h3>PLAY SEARCH <span>{results.length}</span></h3>{results.map((play) => <button key={play.id} onClick={() => onCursor(play.index)}><b><TeamMark game={game} teamId={play.possession} compact /> Q{play.quarter} {play.clock}</b><span lang={language}>{renderPlayDescription(play, language)}</span></button>)}{!results.length && <p className="empty">No visible plays match.</p>}</div>}
        <div className="panel quick-panel"><h3>QUICK JUMP</h3><div className="jump-grid">{[1, 2, 3, 4].map((quarter) => <button key={quarter} onClick={() => { const index = game.plays.findIndex((play) => play.quarter === quarter); if (index >= 0) onCursor(index); }}>Q{quarter}</button>)}</div></div>
        <div className="panel"><h3>CURRENT PLAY <span>{current?.details.participants.length ?? 0}</span></h3><ParticipantList game={game} participants={current?.details.participants ?? []} onPlayer={onPlayer} empty="No play participants are visible yet." /></div>
        {drive && <div className="panel"><h3>CURRENT DRIVE <span>{driveParticipants.length}</span></h3><ParticipantList game={game} participants={driveParticipants} onPlayer={onPlayer} empty="No offensive involvement parsed yet." /></div>}
        {!!recent.length && <div className="panel recent-panel"><h3>RECENT PLAYS</h3>{recent.map((play) => <button key={play.id} onClick={() => onCursor(play.index)}><b>Q{play.quarter} {play.clock} · {play.yardLine}</b><span>{renderPlayDescription(play, language)}</span></button>)}</div>}
      </aside>
    </div>
  );
}

function DriveSummary({ drive, game }: { drive: Drive; game: GameData }) {
  return (
    <div className="drive-summary">
      <div><span>DRIVE COMPLETE</span><h3><TeamMark game={game} teamId={drive.teamId} /> {drive.result}</h3></div>
      <dl><div><dt>PLAYS</dt><dd>{drive.plays}</dd></div><div><dt>YARDS</dt><dd>{drive.netYards}</dd></div><div><dt>TIME</dt><dd>{drive.possessionTime}</dd></div><div><dt>END</dt><dd>{drive.endPosition}</dd></div></dl>
    </div>
  );
}

function ReplayView({ game, cursor, language, onCursor, onPlayer }: { game: GameData; cursor: number; language: DescriptionLanguage; onCursor: (value: number) => void; onPlayer: (id: string) => void }) {
  const revealed = game.plays[cursor];
  const next = game.plays[cursor + 1];
  const completedDrive = revealed?.driveId ? game.drives.find((drive) => drive.id === revealed.driveId && drive.lastPlayIndex === cursor) : undefined;
  const view = fieldView(game, revealed);
  return (
    <div className="replay-shell" data-play-anchor>
      <SituationHeader game={game} play={revealed} cursor={cursor} controls={<div className="replay-progress"><span>PLAY {Math.max(0, cursor + 1)} / {game.plays.length}</span><i><b style={{ width: `${((cursor + 1) / game.plays.length) * 100}%` }} /></i><em>NEXT RESULT LOCKED</em></div>} />
      <div className="replay-stage">
        {revealed ? <div className="replay-result">
          <Field game={game} play={revealed} variant="replay" />
          <div className="field-spot-key"><span><i className="key-start" />START · {view.startPosition ?? "NOT STATED"}</span>{view.actionEndPosition && view.actionEndPosition !== view.finalPosition && <span><i className="key-play-end" />PLAY END · {view.actionEndPosition}</span>}<span><i className="key-official" />OFFICIAL · {view.finalPosition ?? "NOT STATED"}</span><b>{view.movementYards === null ? "NO ESTIMATE" : `${view.movementYards >= 0 ? "+" : ""}${view.movementYards} YARDS`}</b></div>
          <div className="supporting-play"><div className="supporting-head"><span>SUPPORTING TEXT · EVENT ORDER</span><div className="result-flags"><PlayTag kind={revealed.kind} />{revealed.noPlay && <span className="no-play">NO PLAY</span>}{revealed.details.events.some((event) => event.type === "touchdown") && <b>TD</b>}{revealed.details.events.some((event) => event.type === "fumble" || event.type === "interception") && <b className="danger">TURNOVER EVENT</b>}{revealed.details.penalties.length > 0 && <b className="penalty-flag">PENALTY</b>}</div></div><PlayText play={revealed} language={language} />{!!revealed.playerIds.length && <div className="player-links">{revealed.playerIds.slice(0, 4).map((id) => <button key={id} onClick={() => onPlayer(id)}>{id.slice(id.indexOf("-") + 1)}</button>)}</div>}</div>
        </div> : <div className="opening-card"><span>OPENING SNAP · RESULT LOCKED</span><Field game={game} play={next} variant="situation" /><p>Only the first pre-snap situation is visible. Press Space or → to reveal the play.</p></div>}
        {completedDrive && <DriveSummary drive={completedDrive} game={game} />}
        {next ? <div className="next-situation-line"><span>NEXT</span><b>Q{next.quarter} {next.clock}</b><strong><TeamMark game={game} teamId={next.possession} compact /> {next.possession === game.teams[0].id ? "→" : "←"}</strong><em>{situationLabel(next)}</em><small>RESULT LOCKED</small></div> : <div className="game-over"><span>00:00</span><h3>Game complete.</h3></div>}
        <div className="replay-controls"><button className="back-play" disabled={cursor < 0} onClick={() => onCursor(cursor - 1)}>← Previous</button>{next ? <button className="next-play-button" onClick={() => onCursor(cursor + 1)}><span>NEXT PLAY</span><i>→</i></button> : <button className="next-play-button" onClick={() => onCursor(-1)}><span>REPLAY FROM KICKOFF</span><i>↺</i></button>}</div>
      </div>
    </div>
  );
}

function FlowTab({ game, visibleDrives, onDrive }: { game: GameData; visibleDrives: Drive[]; onDrive: (drive: Drive) => void }) {
  return (
    <div className="flow-board">
      <div className="flow-legend"><span><i className="score-dot" />SCORE</span><span><i className="turnover-dot" />TURNOVER</span><span><i />OTHER</span></div>
      <div className="flow-quarters">{[1, 2, 3, 4].map((quarter) => <div key={quarter} className="flow-quarter"><h3><span>Q{quarter}</span><small>{visibleDrives.filter((drive) => drive.quarter === quarter).length} drives</small></h3><div className="flow-track">{visibleDrives.filter((drive) => drive.quarter === quarter).map((drive) => {
        const scoring = /Touchdown|Field Goal/.test(drive.result), turnover = /Interception|Fumble|Downs/.test(drive.result);
        return <button key={drive.id} className={scoring ? "scoring" : turnover ? "turnover" : ""} style={{ "--team-color": team(game, drive.teamId).color } as CSSProperties} onClick={() => onDrive(drive)}><span className="flow-team">{team(game, drive.teamId).homeAway === "visitor" ? "VISITOR" : "HOME"} · {drive.teamId}</span><b>{resultCode(drive.result)}</b><small>{drive.startClock} · {drive.plays} plays</small></button>;
      })}</div></div>)}</div>
    </div>
  );
}

function DrivesTab({ game, visibleDrives, openDrive, setOpenDrive, language, onPlayer }: { game: GameData; visibleDrives: Drive[]; openDrive: string; setOpenDrive: (id: string) => void; language: DescriptionLanguage; onPlayer: (id: string) => void }) {
  return <div className="drive-list">{visibleDrives.map((drive) => {
    const open = openDrive === drive.id;
    return <article key={drive.id} className={`drive-card ${open ? "open" : ""}`}><button className="drive-head" onClick={() => setOpenDrive(open ? "" : drive.id)}><span className="drive-number" style={{ background: team(game, drive.teamId).color }}><small>{team(game, drive.teamId).homeAway === "visitor" ? "VISITOR" : "HOME"}</small>{drive.teamId} {drive.teamDriveNumber}</span><div><b>{drive.startClock} · {drive.startPosition}</b><small>{drive.obtained}</small></div><dl><div><dt>PLAYS</dt><dd>{drive.plays}</dd></div><div><dt>NET YDS</dt><dd>{drive.netYards}</dd></div><div><dt>TIME</dt><dd>{drive.possessionTime}</dd></div></dl><span className={`result-badge result-${drive.result.toLowerCase().replaceAll(" ", "-")}`}>{drive.result}</span><i>{open ? "−" : "+"}</i></button>{open && <div className="drive-plays">{game.plays.filter((play) => drive.playIds.includes(play.id)).map((play) => <PlayRow key={play.id} game={game} play={play} language={language} onPlayer={onPlayer} />)}</div>}</article>;
  })}</div>;
}

function PlaysTab({ game, visiblePlays, language, onPlayer }: { game: GameData; visiblePlays: Play[]; language: DescriptionLanguage; onPlayer: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [quarter, setQuarter] = useState(0);
  const filtered = visiblePlays.filter((play) => (!quarter || play.quarter === quarter) && (!query || `${play.clock} ${play.yardLine} ${play.description}`.toLowerCase().includes(query.toLowerCase())));
  return <div><div className="filter-bar"><div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search every visible play…" /></div><div className="quarter-filter"><button className={!quarter ? "active" : ""} onClick={() => setQuarter(0)}>ALL</button>{[1,2,3,4].map((q) => <button key={q} className={quarter === q ? "active" : ""} onClick={() => setQuarter(q)}>Q{q}</button>)}</div><span>{filtered.length} plays</span></div><div className="pbp-list">{filtered.map((play) => <PlayRow key={play.id} game={game} play={play} language={language} onPlayer={onPlayer} />)}</div></div>;
}

function playerSummary(player: Player) {
  if (player.passing) return `${player.passing.completions}/${player.passing.attempts} · ${player.passing.yards} PASS YDS`;
  if (player.rushing) return `${player.rushing.attempts} CAR · ${player.rushing.yards} RUSH YDS`;
  if (player.receiving) return `${player.receiving.receptions} REC · ${player.receiving.yards} REC YDS`;
  if (player.defense) return `${player.defense.combined} TKL · ${player.defense.sacks} SACK`;
  return "Game participant";
}

function snapPercentage(player: Player) {
  return player.snaps?.offense?.percentage ?? player.snaps?.defense?.percentage ?? player.snaps?.specialTeams?.percentage;
}

const POSITION_GROUPS = ["QB", "RB / FB", "WR", "TE", "OL", "DL", "LB", "DB", "SPECIALISTS", "OTHER"] as const;
function positionGroup(position = "") {
  if (position === "QB") return "QB";
  if (/^(RB|FB)$/.test(position)) return "RB / FB";
  if (position === "WR") return "WR";
  if (position === "TE") return "TE";
  if (/^(C|G|T|OL|LT|LG|RG|RT)$/.test(position)) return "OL";
  if (/^(DL|DE|DT|NT)$/.test(position)) return "DL";
  if (/^(LB|ILB|OLB)$/.test(position)) return "LB";
  if (/^(CB|DB|S|FS|SS)$/.test(position)) return "DB";
  if (/^(K|P|LS)$/.test(position)) return "SPECIALISTS";
  return "OTHER";
}

function PlayersTab({ game, spoiler, onPlayer }: { game: GameData; spoiler: boolean; onPlayer: (id: string) => void }) {
  const [teamFilter, setTeamFilter] = useState<TeamId>(game.teams[0].id);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"name" | "position">("position");
  const players = game.players.filter((player) => player.teamId === teamFilter && (!query || player.name.toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => sortMode === "name" ? a.name.localeCompare(b.name) : POSITION_GROUPS.indexOf(positionGroup(a.position)) - POSITION_GROUPS.indexOf(positionGroup(b.position)) || (a.position ?? "").localeCompare(b.position ?? "") || a.name.localeCompare(b.name));
  const card = (player: Player) => {
    const percentage = snapPercentage(player), snapsAvailable = game.source.sections.playtimePercentage;
    return <button key={player.id} className="player-card" style={{ "--team-color": team(game, player.teamId).color } as CSSProperties} onClick={() => onPlayer(player.id)}><div className="player-avatar">{player.position ?? "—"}</div><div><TeamMark game={game} teamId={player.teamId} compact /><h3>{player.name}</h3><p>{spoiler ? "Game totals hidden in Spoiler Free" : playerSummary(player)}</p></div><div className={`snap-ring ${spoiler ? "locked" : !snapsAvailable || percentage === undefined ? "unavailable" : ""}`}><b>{spoiler ? "—" : percentage === undefined ? "N/A" : `${percentage}%`}</b><span>{spoiler ? "LOCKED" : snapsAvailable ? "SNAPS" : "NO SECTION"}</span></div></button>;
  };
  return <div><div className="filter-bar player-filters"><div className="team-filter team-filter-wide">{game.teams.map((item) => <button key={item.id} className={teamFilter === item.id ? "active" : ""} onClick={() => setTeamFilter(item.id)}><b>{item.id}</b><small>{item.homeAway === "visitor" ? "VISITOR" : "HOME"} · {item.shortName}</small></button>)}</div><div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a player…" /></div><div className="sort-toggle" role="group" aria-label="Player order"><span>SORT</span><button className={sortMode === "name" ? "active" : ""} onClick={() => setSortMode("name")}>NAME</button><button className={sortMode === "position" ? "active" : ""} onClick={() => setSortMode("position")}>POSITION</button></div></div>{sortMode === "name" ? <div className="player-grid">{players.map(card)}</div> : <div className="position-groups">{POSITION_GROUPS.map((group) => { const grouped = players.filter((player) => positionGroup(player.position) === group); return grouped.length ? <section key={group}><h3>{group}<span>{grouped.length}</span></h3><div className="player-grid">{grouped.map(card)}</div></section> : null; })}</div>}</div>;
}

function StatsTab({ game, spoiler }: { game: GameData; spoiler: boolean }) {
  if (spoiler) return <div className="spoiler-lock"><span>◉</span><h3>TEAM STATS LOCKED</h3><p>Final team totals can reveal future drives. Turn off Spoiler Free to inspect them.</p></div>;
  return <div className="stats-board"><div className="stats-team-head"><TeamMark game={game} teamId={game.teams[0].id} /><h3>TEAM STATISTICS</h3><TeamMark game={game} teamId={game.teams[1].id} /></div>{game.teamStats.map((stat) => {
    const a = parseFloat(stat.visitor), b = parseFloat(stat.home), numeric = Number.isFinite(a) && Number.isFinite(b);
    const max = numeric ? Math.max(Math.abs(a), Math.abs(b), 1) : 1;
    return <div className="stat-row" key={stat.label}><b>{stat.visitor}</b><div><span>{stat.label}</span>{numeric && <div className="compare-bar"><i style={{ width: `${(Math.abs(a) / max) * 50}%` }} /><i style={{ width: `${(Math.abs(b) / max) * 50}%` }} /></div>}</div><b>{stat.home}</b></div>;
  })}</div>;
}

function ExploreView({ game, cursor, spoiler, language, onPlayer }: { game: GameData; cursor: number; spoiler: boolean; language: DescriptionLanguage; onPlayer: (id: string) => void }) {
  const [tab, setTab] = useState<ExploreTab>("flow");
  const [openDrive, setOpenDrive] = useState("");
  const visibleDrives = spoiler ? game.drives.filter((drive) => drive.firstPlayIndex <= cursor).map((drive) => {
    if (drive.lastPlayIndex <= cursor) return drive;
    const visibleDrivePlays = game.plays.filter((play) => drive.playIds.includes(play.id) && play.index <= cursor);
    const liveYards = visibleDrivePlays.reduce((sum, play) => sum + (play.yards ?? 0), 0);
    return { ...drive, endClock: "—", possessionTime: "—", endPosition: "—", plays: visibleDrivePlays.length, grossYards: liveYards, penaltyYards: 0, netYards: liveYards, firstDowns: 0, result: "In Progress" };
  }) : game.drives;
  const visiblePlays = spoiler ? game.plays.slice(0, cursor + 1) : game.plays;
  const openFromFlow = (drive: Drive) => { setOpenDrive(drive.id); setTab("drives"); };
  const tabs: [ExploreTab, string][] = [["flow","Game Flow"],["drives","Drives"],["plays","Play-by-Play"],["players","Players"],["stats","Team Stats"]];
  return <div className="explore-shell"><div className="section-heading"><div><p className="eyebrow">THE WHOLE BOOK, CONNECTED</p><h2>EXPLORE</h2></div><span className="data-chip">{game.plays.length} PLAYS · {game.drives.length} DRIVES · {game.players.length} PLAYERS</span></div><div className="explore-tabs">{tabs.map(([id,label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>{spoiler && <div className="spoiler-notice"><span>◉</span><b>Spoiler Free is filtering Explore</b><p>Only data through the current WATCH ALONG / GAMEBOOK REPLAY position is visible.</p></div>}<div className="explore-content">{tab === "flow" && <FlowTab game={game} visibleDrives={visibleDrives} onDrive={openFromFlow} />}{tab === "drives" && <DrivesTab game={game} visibleDrives={visibleDrives} openDrive={openDrive} setOpenDrive={setOpenDrive} language={language} onPlayer={onPlayer} />}{tab === "plays" && <PlaysTab game={game} visiblePlays={visiblePlays} language={language} onPlayer={onPlayer} />}{tab === "players" && <PlayersTab game={game} spoiler={spoiler} onPlayer={onPlayer} />}{tab === "stats" && <StatsTab game={game} spoiler={spoiler} />}</div></div>;
}

function StatBlock({ label, values }: { label: string; values: [string, string][] }) {
  return <div className="drawer-stat"><h4>{label}</h4><dl>{values.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></div>;
}

function PlayerDrawer({ game, playerId, cursor, spoiler, language, onClose }: { game: GameData; playerId: string; cursor: number; spoiler: boolean; language: DescriptionLanguage; onClose: () => void }) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  const related = game.plays.filter((play) => player.playIds.includes(play.id) && (!spoiler || play.index <= cursor));
  return <div className="drawer-backdrop" onMouseDown={onClose}>
    <aside className="player-drawer" onMouseDown={(event) => event.stopPropagation()}>
      <button className="drawer-close" onClick={onClose}>×</button>
      <div className="drawer-hero" style={{ borderColor: team(game, player.teamId).color }}><div className="player-avatar large">{player.position ?? "—"}</div><div><TeamMark game={game} teamId={player.teamId} /><h2>{player.name}</h2><p>{spoiler ? "Game totals hidden in Spoiler Free" : playerSummary(player)}</p></div></div>
      {spoiler ? <div className="spoiler-lock compact-lock"><span>◉</span><h3>GAME TOTALS LOCKED</h3><p>Only involved plays through the current game position are shown.</p></div> : <>
        <div className="drawer-stats">
          {player.passing && <StatBlock label="PASSING" values={[["CMP/ATT",`${player.passing.completions}/${player.passing.attempts}`],["YARDS",String(player.passing.yards)],["TD–INT",`${player.passing.touchdowns}–${player.passing.interceptions}`],["RATING",String(player.passing.rating)]]} />}
          {player.rushing && <StatBlock label="RUSHING" values={[["ATT",String(player.rushing.attempts)],["YARDS",String(player.rushing.yards)],["AVG",String(player.rushing.average)],["TD",String(player.rushing.touchdowns)]]} />}
          {player.receiving && <StatBlock label="RECEIVING" values={[["REC/TGT",`${player.receiving.receptions}/${player.receiving.targets}`],["YARDS",String(player.receiving.yards)],["LONG",String(player.receiving.long)],["TD",String(player.receiving.touchdowns)]]} />}
          {player.defense && <StatBlock label="DEFENSE" values={[["TKL",String(player.defense.combined)],["SOLO",String(player.defense.tackles)],["SACK",String(player.defense.sacks)],["PD",String(player.defense.passesDefended)]]} />}
        </div>
        {game.source.sections.playtimePercentage ? player.snaps && Object.values(player.snaps).some(Boolean) ? <div className="snap-section"><h3>PLAYTIME</h3><div>{(["offense","defense","specialTeams"] as const).map((unit) => player.snaps?.[unit] && <article key={unit}><span>{unit === "specialTeams" ? "SPECIAL" : unit.toUpperCase()}</span><b>{player.snaps[unit]!.count}</b><small>{player.snaps[unit]!.percentage}%</small><i><em style={{ width: `${player.snaps[unit]!.percentage}%` }} /></i></article>)}</div></div> : <div className="data-unavailable"><b>PLAYTIME ROW UNAVAILABLE</b><span>This Gamebook has a snap section, but no row was parsed for this player.</span></div> : <div className="data-unavailable"><b>SNAP DATA NOT IN GAMEBOOK</b><span>This PDF does not include a Playtime Percentage section. No 0% value is inferred.</span></div>}
      </>}
      <div className="related-plays"><h3>INVOLVED PLAYS <span>{related.length}</span></h3>{related.map((play) => <PlayRow key={play.id} game={game} play={play} language={language} />)}{!related.length && <p className="empty">No involved plays are visible at this game position.</p>}</div>
    </aside>
  </div>;
}

export default function App() {
  const [game, setGame] = useState<GameData | null>(null);
  const [mode, setMode] = useState<Mode>("watch");
  const [spoiler, setSpoiler] = useState(true);
  const [language, setLanguage] = useState<DescriptionLanguage>("en");
  const [cursor, setCursor] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState("");
  const [playerId, setPlayerId] = useState("");

  const loadBytes = useCallback(async (bytes: ArrayBuffer, fileName: string) => {
    setLoading(true); setError(""); setProgress(2); setLoadingLabel("Opening the PDF…");
    try {
      const parsed = await parseGamebook(bytes, fileName, (current, total) => {
        setProgress(Math.round((current / total) * 90));
        setLoadingLabel(`Reading page ${current} of ${total}…`);
      });
      setProgress(100); setLoadingLabel("Linking drives, players, and plays…");
      setGame(parsed); setCursor(-1); setMode("watch"); setSpoiler(true); setLanguage("en");
      document.title = `${parsed.teams[0].id} @ ${parsed.teams[1].id} · Gamebook Companion`;
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : "This PDF could not be parsed.");
    } finally { setLoading(false); }
  }, []);

  const loadFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) { setError("Choose an NFL Gamebook PDF."); return; }
    if (file.size > 30 * 1024 * 1024) { setError("For safety, PDFs are limited to 30 MB."); return; }
    await loadBytes(await file.arrayBuffer(), file.name);
  }, [loadBytes]);

  const loadDemo = useCallback(async () => {
    try {
      setLoading(true); setProgress(1); setLoadingLabel("Loading the included Gamebook…");
      const response = await fetch(`./${SAMPLE_FILE}`);
      if (!response.ok) throw new Error("The included fixture is not available.");
      await loadBytes(await response.arrayBuffer(), SAMPLE_FILE);
    } catch (cause) {
      setLoading(false); setError(cause instanceof Error ? cause.message : "Could not load the sample.");
    }
  }, [loadBytes]);

  const reset = () => { setGame(null); setPlayerId(""); setCursor(-1); document.title = "Gamebook Companion"; };
  const safeCursor = useMemo(() => game ? clamp(cursor, -1, game.plays.length - 1) : -1, [cursor, game]);
  useEffect(() => {
    if (!game || mode === "explore" || playerId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const previous = event.key === "ArrowLeft";
      const next = event.key === "ArrowRight" || event.code === "Space";
      if (!previous && !next) return;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space" && target?.closest("button, a")) return;
      event.preventDefault();
      setCursor((value) => clamp(value + (previous ? -1 : 1), -1, game.plays.length - 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [game, mode, playerId]);
  useEffect(() => {
    if (!game || mode === "explore") return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = document.querySelector<HTMLElement>("[data-play-anchor]");
      if (!anchor) return;
      const safeTop = window.innerWidth <= 760 ? 52 : 92;
      const top = anchor.getBoundingClientRect().top;
      if (top < safeTop - 12 || top > window.innerHeight * .5) {
        window.scrollTo({ top: Math.max(0, window.scrollY + top - safeTop), behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [game, mode, safeCursor]);
  if (loading) return <LoadingScreen progress={progress} label={loadingLabel} />;
  if (!game) return <Landing onFile={loadFile} onDemo={loadDemo} error={error} />;
  return <div className="app-shell"><TopBar game={game} onReset={reset} language={language} onLanguage={setLanguage} spoiler={spoiler} onSpoiler={() => setSpoiler((value) => !value)} /><ModeNav mode={mode} onMode={setMode} /><main className="app-main">{game.warnings.length > 0 && <div className="warning-banner"><b>{game.validation.status === "partial" ? "PARTIAL PARSE" : "PARSER NOTE"}</b>{game.warnings.join(" ")}</div>}{mode === "watch" && <WatchView game={game} cursor={safeCursor} spoiler={spoiler} language={language} onCursor={setCursor} onPlayer={setPlayerId} />}{mode === "replay" && <ReplayView game={game} cursor={safeCursor} language={language} onCursor={setCursor} onPlayer={setPlayerId} />}{mode === "explore" && <ExploreView game={game} cursor={safeCursor} spoiler={spoiler} language={language} onPlayer={setPlayerId} />}</main><footer className="app-footer"><span>Parsed locally from {game.source.fileName}</span><span>No external data or AI APIs</span></footer>{playerId && <PlayerDrawer game={game} playerId={playerId} cursor={safeCursor} spoiler={spoiler} language={language} onClose={() => setPlayerId("")} />}</div>;
}
