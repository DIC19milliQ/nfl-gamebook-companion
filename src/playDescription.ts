import type { Play, PlayAction, PlayParticipant, PlayPenalty, PlaySequenceEvent } from "./types";

export type DescriptionLanguage = "en" | "ja";
export type PlaySectionKind = "main" | "defense" | "turnover" | "penalty" | "scoring" | "review" | "note";
export interface RenderedPlaySection { kind: PlaySectionKind; label: string; text: string; raw?: boolean; phase?: string; ruling?: string }

const directionJa: Record<string, string> = {
  "short left": "左へのショート", "short middle": "中央へのショート", "short right": "右へのショート",
  "deep left": "左へのディープ", "deep middle": "中央へのディープ", "deep right": "右へのディープ",
  "left end": "左エンド", "left tackle": "左タックル", "left guard": "左ガード", "up the middle": "中央",
  "right guard": "右ガード", "right tackle": "右タックル", "right end": "右エンド",
};
const penaltyJa: Record<string, string> = {
  "Defensive Pass Interference": "ディフェンシブ・パス・インターフェアランス", "Offensive Pass Interference": "オフェンシブ・パス・インターフェアランス",
  "Defensive Holding": "ディフェンシブ・ホールディング", "Offensive Holding": "オフェンシブ・ホールディング", Holding: "ホールディング",
  "Face Mask": "フェイスマスク", "False Start": "フォルススタート", "Delay of Game": "ディレイ・オブ・ゲーム",
  "Intentional Grounding": "インテンショナル・グラウンディング", "Ineligible Downfield Pass": "無資格レシーバーのダウンフィールド進入",
  "Illegal Use of Hands": "イリーガル・ユース・オブ・ハンズ", "Illegal Block Above the Waist": "腰より上へのイリーガルブロック",
  "Kickoff Out of Bounds": "キックオフのアウト・オブ・バウンズ", "Offensive Offside": "オフェンシブ・オフサイド",
};
const phaseLabels = { scrimmage: "SCRIMMAGE", try: "TRY", kickoff: "KICKOFF", administrative: "ADMIN" } as const;

function formationText(formations: string[] = []) {
  const labels: Record<string, string> = { Shotgun: "ショットガン", "No Huddle": "ノーハドル", "Run Formation": "ラン・フォーメーション", "Punt Formation": "パント・フォーメーション", "Field Goal Formation": "フィールドゴール・フォーメーション" };
  return formations.length ? `${formations.map((formation) => labels[formation] ?? formation).join("・")}から、` : "";
}
function yardText(action: PlayAction) { if (action.outcome === "no-gain" || action.yards === 0) return "ゲインなし"; if (action.yards === undefined) return ""; return action.yards < 0 ? `${Math.abs(action.yards)}ヤードロス` : `${action.yards}ヤード獲得`; }
const destination = (action: PlayAction) => action.endPosition ? `${action.endPosition}まで` : "";
function direction(action: PlayAction) { const key = [action.depth, action.direction].filter(Boolean).join(" "); return directionJa[key] ?? (action.direction ? directionJa[action.direction] ?? action.direction : ""); }
function sentence(parts: (string | undefined)[]) { const text = parts.filter(Boolean).join("、").replace(/、。/g, "。"); return /[。.!?]$/.test(text) ? text : `${text}。`; }

function renderAction(action: PlayAction, play: Play) {
  const formation = formationText(action.formation), yards = yardText(action);
  switch (action.type) {
    case "pass": {
      const route = direction(action);
      if (action.outcome === "incomplete") return sentence([`${formation}${action.actor}が${action.target ? `${action.target}へ` : ""}${route ? `${route}パスを投げるが` : "パスを投げるが"}不成功`]);
      if (action.outcome === "interception") { const interceptor = play.details.participants.find((participant) => participant.role === "interceptor"); return sentence([`${formation}${action.actor}の${route ? `${route}パス` : "パス"}`, action.target ? `${action.target}を狙う` : undefined, `${interceptor?.name ?? "守備選手"}が${action.endPosition ? `${action.endPosition}で` : ""}インターセプト`]); }
      return sentence([`${formation}${action.actor}から${action.target ?? "レシーバー"}へ${route ? `${route}パス` : "パス"}成功`, destination(action), yards, action.boundary === "out-of-bounds" ? "アウト・オブ・バウンズ" : undefined, action.outcome === "touchdown" ? "タッチダウン" : undefined, /TOUCHDOWN NULLIFIED/i.test(action.rawText) ? "当初タッチダウン判定（反則により無効）" : undefined]);
    }
    case "rush": return sentence([`${formation}${action.actor}が${direction(action) || "中央"}をラン`, destination(action), yards, action.boundary === "out-of-bounds" ? "アウト・オブ・バウンズ" : undefined, action.outcome === "touchdown" ? "タッチダウン" : undefined]);
    case "advance": return sentence([`${formation}${action.actor}がボールを進める`, destination(action), yards, action.outcome === "touchdown" ? "タッチダウン" : undefined]);
    case "return": return sentence([`${action.actor}が${action.startPosition ? `${action.startPosition}から` : ""}リターン`, destination(action), yards, action.boundary === "out-of-bounds" ? "アウト・オブ・バウンズ" : undefined, action.outcome === "touchdown" ? "タッチダウン" : undefined]);
    case "scramble": return sentence([`${formation}${action.actor}が${direction(action) ? `${direction(action)}へ` : ""}スクランブル`, destination(action), yards, action.boundary === "out-of-bounds" ? "アウト・オブ・バウンズ" : undefined, action.outcome === "touchdown" ? "タッチダウン" : undefined]);
    case "sack": { const sackers = namesByRole(play.details.participants, ["sacker"]); return sentence([`${formation}${action.actor}が${sackers.length ? `${sackers.join(" / ")}に` : ""}サックされる`, action.endPosition ? `${action.endPosition}で` : undefined, action.boundary === "out-of-bounds" ? "アウト・オブ・バウンズ" : undefined, yards]); }
    case "kneel": return sentence([`${formation}${action.actor}がニーダウン`, destination(action), yards]);
    case "spike": return `${formation}${action.actor}がスパイクして時計を止める。`;
    case "field-goal": return `${action.actor}の${action.yards}ヤード・フィールドゴールは${action.outcome === "good" ? "成功" : action.outcome === "blocked" ? "ブロックされる" : "失敗"}。`;
    case "extra-point": return `${action.actor}のエクストラポイントは${action.outcome === "good" ? "成功" : "失敗"}。`;
    case "punt": return sentence([`${action.actor}が${action.yards}ヤードのパント`, action.endPosition ? `${action.endPosition}へ` : undefined, action.outcome === "fair-catch" ? "フェアキャッチ" : undefined]);
    case "kickoff": return sentence([`${action.actor}が${action.yards}ヤードのキックオフ`, action.endPosition ? `${action.endPosition}へ` : undefined]);
    case "timeout": return action.actor ? `${action.actor}がタイムアウト。` : "タイムアウト。";
    case "penalty": return "スナップ前またはプレー中に反則。";
    case "replay": return "リプレー・レビューが行われた。";
    default: return action.rawText;
  }
}
function namesByRole(participants: PlayParticipant[], roles: PlayParticipant["role"][]) { return unique(participants.filter((participant) => roles.includes(participant.role)).map((participant) => participant.name)); }
function unique<T>(items: T[]) { return [...new Set(items)]; }
function penaltyText(penalty: PlayPenalty) {
  const translated = penaltyJa[penalty.type], name = [penalty.teamId, penalty.playerName].filter(Boolean).join("-") || "チーム／選手不明";
  const status = penalty.status === "accepted" ? "受理" : penalty.status === "declined" ? "辞退" : penalty.status === "offsetting" ? "相殺" : "判定状態不明";
  return sentence([`${name}に${translated ? `${translated}（${penalty.type}）` : penalty.type}`, penalty.yards !== undefined ? `${penalty.yards}ヤード` : undefined, penalty.enforcedAt ? `${penalty.enforcedAt}で${penalty.enforcement === "placed" ? "ボールを配置" : "適用"}` : penalty.enforcement === "between-downs" ? "ダウン間で適用" : undefined, status, penalty.automaticFirstDown ? "オートマチック・ファーストダウン" : undefined, penalty.noPlay ? "ノープレー" : undefined]);
}
function injuryStatus(status: string) { if (/return is Questionable/i.test(status)) return "Return Questionable"; if (/is Out of the game/i.test(status)) return "Out"; if (/has returned to the game/i.test(status)) return "Returned"; return status; }
function driveText(raw: string) {
  const match = raw.match(/([A-Z]{2,3}) (\d+) ([A-Z]{2,3}) (\d+),\s*(\d+) plays?,\s*(-?\d+) yards?,(?:\s*(\d+) penalt(?:y|ies),)?\s*(\d+:\d+) drive/i);
  return match ? `スコア ${match[1]} ${match[2]} – ${match[3]} ${match[4]}。ドライブ：${match[5]}プレー／${match[6]}ヤード${match[7] ? `／反則${match[7]}回` : ""}／${match[8]}。` : raw;
}
function sectionForEvent(play: Play, event: PlaySequenceEvent): RenderedPlaySection | undefined {
  const phase = phaseLabels[event.phase], suffix = event.ruling === "provisional" ? " · INITIAL" : event.ruling === "final" ? " · FINAL" : "";
  if (event.type === "action" && event.actionIndex !== undefined) { const action = play.details.actions[event.actionIndex]; return { kind: action.type === "extra-point" || action.type === "field-goal" ? "scoring" : "main", label: `${phase}${suffix}`, text: renderAction(action, play), phase, ruling: event.ruling }; }
  if (event.type === "defense") {
    const label = event.result === "qb-hit" ? "QBヒット" : event.result === "forced-fumble" ? "ファンブル誘発" : event.result === "sacker" ? "サック" : event.result === "defender" ? "守備関与" : "タックル";
    return { kind: "defense", label: `${phase} · DEFENSE`, text: `${label}: ${event.participantNames?.join(" / ") ?? event.rawText}。`, phase };
  }
  if (event.type === "fumble") return { kind: "turnover", label: `${phase} · BALL EVENT`, text: "ファンブル。", phase };
  if (event.type === "recovery") return { kind: "turnover", label: `${phase} · BALL EVENT`, text: `${event.participantNames?.[0] ?? "選手"}が${event.location ? `${event.location}で` : ""}リカバー。`, phase };
  if (event.type === "block") return { kind: "turnover", label: `${phase} · BLOCK`, text: `${event.participantNames?.[0] ?? "守備選手"}が${event.result === "field-goal" ? "フィールドゴール" : "キック"}をブロック。`, phase };
  if (event.type === "possession-change") return { kind: "turnover", label: `${phase} · POSSESSION`, text: `ボール保持が${event.teamId ?? "相手チーム"}へ移る${event.location ? `（${event.location}）` : ""}。`, phase };
  if (event.type === "penalty" && event.penaltyIndex !== undefined) {
    if (event.result === "restated-after-review") return { kind: "note", label: `${phase} · OFFICIAL RESTATEMENT`, text: "最終公式記録で同じ反則が再掲されたため、重複計上していません。", phase };
    return { kind: "penalty", label: `${phase} · PENALTY${suffix}`, text: penaltyText(play.details.penalties[event.penaltyIndex]), phase, ruling: event.ruling };
  }
  if (event.type === "review") { const review = event.review; return { kind: "review", label: "REVIEW", text: review?.source === "team-challenge" ? `${review.teamId ?? "Team"}が「${review.subject ?? "判定"}」をチャレンジ。` : `Replay Officialが「${review?.subject ?? "判定"}」をレビュー。` }; }
  if (event.type === "review-result") { const text = event.result === "reversed" ? "判定はREVERSED（覆る）。" : event.result === "upheld" ? "判定はUpheld（支持）。" : event.result === "stands" ? "フィールド上の判定を維持。" : "判定を確認。"; return { kind: "review", label: "REVIEW RESULT", text }; }
  if (event.type === "timeout") return { kind: "note", label: "TIMEOUT", text: event.result ? `${event.result}がタイムアウト。` : "タイムアウト。" };
  if (event.type === "injury-update" && event.injury) return { kind: "note", label: "INJURY UPDATE", text: `${event.injury.teamId ?? "TEAM"} · ${event.injury.player ?? "Player"} — ${injuryStatus(event.injury.status)}。` };
  if (event.type === "drive-summary") return { kind: "scoring", label: "SCORE / DRIVE", text: driveText(event.rawText), phase };
  if (event.type === "kick-crew") return { kind: "scoring", label: `${phase} · KICK CREW`, text: `スナッパー：${event.participantNames?.[0] ?? "—"}。ホルダー：${event.participantNames?.[1] ?? "—"}。`, phase };
  if (event.type === "official-marker") return undefined;
  if (event.type === "administrative") return { kind: "note", label: "ADMINISTRATIVE", text: event.result === "10-second runoff" ? "10秒ランオフ。" : event.result === "blocked-kick-incomplete-pass" ? `${event.participantNames?.[0] ?? "回収選手"}がブロックキック回収後に投げたパスは不成功。` : event.rawText };
  if (event.type === "raw") return { kind: "note", label: "RAW / UNPARSED", text: event.rawText, raw: true, phase };
  return undefined;
}

export function renderPlaySections(play: Play, language: DescriptionLanguage): RenderedPlaySection[] {
  if (language === "en") return [{ kind: "main", label: "GAMEBOOK", text: play.description, raw: true }];
  const sections = play.details.sequence.map((event) => sectionForEvent(play, event)).filter((section): section is RenderedPlaySection => Boolean(section));
  return sections.length ? sections : [{ kind: "main", label: "GAMEBOOK ORIGINAL", text: play.description, raw: true }];
}
export function renderPlayDescription(play: Play, language: DescriptionLanguage) { return renderPlaySections(play, language).map((section) => section.text).join(" "); }
