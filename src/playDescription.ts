import type { Play, PlayAction, PlayParticipant } from "./types";

export type DescriptionLanguage = "en" | "ja";
export type PlaySectionKind = "main" | "defense" | "turnover" | "penalty" | "scoring" | "review" | "note";

export interface RenderedPlaySection {
  kind: PlaySectionKind;
  label: string;
  text: string;
  raw?: boolean;
}

const directionJa: Record<string, string> = {
  "short left": "左へのショート", "short middle": "中央へのショート", "short right": "右へのショート",
  "deep left": "左へのディープ", "deep middle": "中央へのディープ", "deep right": "右へのディープ",
  "left end": "左エンド", "left tackle": "左タックル", "left guard": "左ガード", "up the middle": "中央",
  "right guard": "右ガード", "right tackle": "右タックル", "right end": "右エンド",
};

const penaltyJa: Record<string, string> = {
  "Defensive Pass Interference": "ディフェンシブ・パス・インターフェアランス",
  "Offensive Pass Interference": "オフェンシブ・パス・インターフェアランス",
  "Defensive Holding": "ディフェンシブ・ホールディング", "Offensive Holding": "オフェンシブ・ホールディング",
  "Face Mask": "フェイスマスク", "False Start": "フォルススタート", "Delay of Game": "ディレイ・オブ・ゲーム",
  "Intentional Grounding": "インテンショナル・グラウンディング",
  "Ineligible Downfield Pass": "無資格レシーバーのダウンフィールド進入",
  "Illegal Use of Hands": "イリーガル・ユース・オブ・ハンズ",
  "Illegal Block Above the Waist": "腰より上へのイリーガルブロック", "Kickoff Out of Bounds": "キックオフのアウト・オブ・バウンズ",
};

function formationText(formations: string[]) {
  if (!formations.length) return "";
  const labels: Record<string, string> = { Shotgun: "ショットガン", "No Huddle": "ノーハドル", "Run formation": "ラン・フォーメーション", "Punt formation": "パント・フォーメーション", "Field Goal formation": "フィールドゴール・フォーメーション" };
  return `${formations.map((formation) => labels[formation] ?? formation).join("／")}から、`;
}

function yardText(action: PlayAction) {
  if (action.outcome === "no-gain" || action.yards === 0) return "ゲインなし";
  if (action.yards === undefined) return "";
  return action.yards < 0 ? `${Math.abs(action.yards)}ヤードのロス` : `${action.yards}ヤード獲得`;
}

const destination = (action: PlayAction) => action.endPosition ? `${action.endPosition}まで` : "";
function direction(action: PlayAction) {
  const key = [action.depth, action.direction].filter(Boolean).join(" ");
  return directionJa[key] ?? (action.direction ? directionJa[action.direction] ?? action.direction : "");
}
function sentence(parts: (string | undefined)[]) {
  const text = parts.filter(Boolean).join("、").replace(/、。/g, "。");
  return /[。.!?]$/.test(text) ? text : `${text}。`;
}

function renderMain(play: Play) {
  const action = play.details.action;
  const formation = formationText(play.details.formation);
  const yards = yardText(action);
  switch (action.type) {
    case "pass": {
      const route = direction(action);
      if (action.outcome === "incomplete") return sentence([`${formation}${action.actor}の${route ? `${route}パス` : "パス"}は不成功`, action.target ? `ターゲットは${action.target}` : undefined]);
      if (action.outcome === "interception") {
        const interceptor = play.details.participants.find((participant) => participant.role === "interceptor");
        return sentence([`${formation}${action.actor}の${route ? `${route}パス` : "パス"}`, action.target ? `${action.target}を狙う` : undefined, `${interceptor?.name ?? "守備選手"}が${action.endPosition ? `${action.endPosition}で` : ""}インターセプト`]);
      }
      return sentence([`${formation}${action.actor}から${action.target ?? "レシーバー"}へ${route ? `${route}パス` : "パス"}成功`, destination(action), yards, action.boundary === "out-of-bounds" ? "アウト・オブ・バウンズ" : undefined, action.outcome === "touchdown" ? "タッチダウン" : undefined]);
    }
    case "rush": return sentence([`${formation}${action.actor}が${direction(action) || "中央"}をラン`, destination(action), yards, action.boundary === "out-of-bounds" ? "アウト・オブ・バウンズ" : undefined, action.outcome === "touchdown" ? "タッチダウン" : undefined]);
    case "scramble": return sentence([`${formation}${action.actor}が${direction(action) ? `${direction(action)}へ` : ""}スクランブル`, destination(action), yards, action.boundary === "out-of-bounds" ? "アウト・オブ・バウンズ" : undefined, action.outcome === "touchdown" ? "タッチダウン" : undefined]);
    case "sack": return sentence([`${formation}${action.actor}が${action.endPosition ? `${action.endPosition}で` : ""}サックされる`, yards]);
    case "kneel": return sentence([`${formation}${action.actor}がニーダウン`, destination(action), yards]);
    case "spike": return `${formation}${action.actor}がスパイクして時計を止める。`;
    case "field-goal": return `${action.actor}の${action.yards}ヤード・フィールドゴールは${action.outcome === "good" ? "成功" : "失敗"}。`;
    case "extra-point": return `${action.actor}のエクストラポイントは${action.outcome === "good" ? "成功" : "失敗"}。`;
    case "punt": return sentence([`${action.actor}が${action.yards}ヤードのパント`, action.endPosition ? `${action.endPosition}へ` : undefined, action.outcome === "fair-catch" ? "フェアキャッチ" : undefined]);
    case "kickoff": return sentence([`${action.actor}が${action.yards}ヤードのキックオフ`, action.endPosition ? `${action.endPosition}へ` : undefined]);
    case "timeout": return action.actor ? `${action.actor}がタイムアウト。` : "ツーミニッツ・ウォーニング。";
    case "penalty": return `${formation}スナップ前またはプレー中に反則。`;
    case "replay": return "リプレー・レビューが行われた。";
    default: return play.description;
  }
}

function namesByRole(participants: PlayParticipant[], roles: PlayParticipant["role"][]) {
  return [...new Set(participants.filter((participant) => roles.includes(participant.role)).map((participant) => participant.name))];
}

function defenseSection(play: Play): RenderedPlaySection | undefined {
  const groups = [
    ["タックル", namesByRole(play.details.participants, ["tackler"])], ["守備関与", namesByRole(play.details.participants, ["defender"])],
    ["QBヒット", namesByRole(play.details.participants, ["qb-hit"])], ["ファンブル誘発", namesByRole(play.details.participants, ["forced-fumble"])],
  ].filter(([, names]) => names.length) as [string, string[]][];
  return groups.length ? { kind: "defense", label: "DEFENSE", text: groups.map(([label, names]) => `${label}: ${names.join(" / ")}`).join("。") + "。" } : undefined;
}

function turnoverSection(play: Play): RenderedPlaySection | undefined {
  const fumble = play.details.events.find((event) => event.type === "fumble");
  const recovery = play.details.events.find((event) => event.type === "recovery");
  if (!fumble && !recovery) return undefined;
  return { kind: "turnover", label: "BALL EVENT", text: sentence([fumble ? `${fumble.actor ?? "ボール保持者"}がファンブル` : undefined, recovery ? `${recovery.teamId ?? "守備"}-${recovery.actor ?? "選手"}が${recovery.location ? `${recovery.location}で` : ""}リカバー` : undefined]) };
}

function penaltySections(play: Play): RenderedPlaySection[] {
  return play.details.penalties.map((penalty) => {
    const translated = penaltyJa[penalty.type];
    const name = [penalty.teamId, penalty.playerName].filter(Boolean).join("-") || "チーム／選手不明";
    const status = penalty.status === "accepted" ? "受理" : penalty.status === "declined" ? "辞退" : penalty.status === "offsetting" ? "相殺" : "判定状態不明";
    return { kind: "penalty", label: "PENALTY", text: sentence([`${name}に${translated ? `${translated}（${penalty.type}）` : penalty.type}`, penalty.yards !== undefined ? `${penalty.yards}ヤード` : undefined, penalty.enforcedAt ? `${penalty.enforcedAt}で${penalty.enforcement === "placed" ? "ボールを配置" : "適用"}` : undefined, status, penalty.automaticFirstDown ? "オートマチック・ファーストダウン" : undefined, penalty.noPlay ? "ノープレー" : undefined]) };
  });
}

function scoringSection(play: Play): RenderedPlaySection | undefined {
  const scoring = play.details.scoring;
  if (!scoring) return undefined;
  const parts: string[] = [];
  if (scoring.extraPoint) parts.push(`${scoring.extraPoint.kicker}のエクストラポイントは${scoring.extraPoint.result === "good" ? "成功" : "失敗"}`);
  if (scoring.score) parts.push(`この時点のスコア ${scoring.score.visitor}–${scoring.score.home}`);
  if (scoring.drive) parts.push(`ドライブ: ${scoring.drive.plays}プレー／${scoring.drive.yards}ヤード${scoring.drive.penalties !== undefined ? `／反則${scoring.drive.penalties}回` : ""}／${scoring.drive.possessionTime}`);
  return { kind: "scoring", label: "SCORING / DRIVE", text: `${parts.join("。")}。` };
}

export function renderPlaySections(play: Play, language: DescriptionLanguage): RenderedPlaySection[] {
  if (language === "en") return [{ kind: "main", label: "GAMEBOOK", text: play.description, raw: true }];
  if (play.details.parseStatus === "raw") return [{ kind: "main", label: "GAMEBOOK ORIGINAL", text: play.description, raw: true }];
  const sections: (RenderedPlaySection | undefined)[] = [{ kind: "main", label: "MAIN PLAY", text: renderMain(play) }, defenseSection(play), turnoverSection(play), ...penaltySections(play), scoringSection(play)];
  for (const annotation of play.details.annotations) {
    if (annotation.kind === "replay") sections.push({ kind: "review", label: "REVIEW", text: `${annotation.rawText}（Gamebook原文を保持）`, raw: true });
    else if (annotation.kind === "injury") sections.push({ kind: "note", label: "INJURY", text: annotation.rawText, raw: true });
    else if (annotation.kind === "unknown") sections.push({ kind: "note", label: "RAW NOTE", text: annotation.rawText, raw: true });
  }
  return sections.filter((section): section is RenderedPlaySection => Boolean(section));
}

export function renderPlayDescription(play: Play, language: DescriptionLanguage) {
  return renderPlaySections(play, language).map((section) => section.text).join(" ");
}
