import type { Play } from "./types";

export type DescriptionLanguage = "en" | "ja";

const directionJa: Record<string, string> = {
  "short left": "左へのショート",
  "short middle": "中央へのショート",
  "short right": "右へのショート",
  "deep left": "左へのディープ",
  "deep middle": "中央へのディープ",
  "deep right": "右へのディープ",
  "left end": "左エンド",
  "left tackle": "左タックル",
  "left guard": "左ガード",
  "up the middle": "中央",
  "right guard": "右ガード",
  "right tackle": "右タックル",
  "right end": "右エンド",
};

function formationPrefix(description: string) {
  const formations: string[] = [];
  let rest = description.trim();
  while (/^\([^)]+\)\s*/.test(rest)) {
    const match = rest.match(/^\(([^)]+)\)\s*/)!;
    if (/Shotgun/i.test(match[1])) formations.push("ショットガン");
    else if (/No Huddle/i.test(match[1])) formations.push("ノーハドル");
    else return null;
    rest = rest.slice(match[0].length);
  }
  return { prefix: formations.length ? `${formations.join("・")}から、` : "", rest };
}

function yardResult(yards: string) {
  const value = Number(yards);
  if (!Number.isFinite(value)) return "";
  if (value > 0) return `${value}ヤード獲得`;
  if (value < 0) return `${Math.abs(value)}ヤードロス`;
  return "ゲインなし";
}

function suffixes(text: string) {
  const parts: string[] = [];
  if (/TOUCHDOWN/i.test(text)) parts.push("タッチダウン");
  if (/No Play/i.test(text)) parts.push("ノープレー");
  return parts.length ? `。${parts.join("、")}` : "";
}

function renderPass(description: string) {
  const formed = formationPrefix(description);
  if (!formed) return null;
  const { prefix, rest } = formed;
  const incomplete = rest.match(/^([\w.'-]+) pass incomplete(?: (short|deep) (left|middle|right))?(?:, intended for ([\w.'-]+))?/i);
  if (incomplete) {
    const direction = incomplete[2] && incomplete[3] ? `${directionJa[`${incomplete[2].toLowerCase()} ${incomplete[3].toLowerCase()}`]}パス` : "パス";
    const target = incomplete[4] ? `（ターゲット: ${incomplete[4]}）` : "";
    return `${prefix}${incomplete[1]}の${direction}は不成功${target}${suffixes(rest)}`;
  }
  const intercepted = rest.match(/^([\w.'-]+) pass(?: (short|deep) (left|middle|right))?.*?INTERCEPTED by ([\w.'-]+) at ((?:[A-Z]{2,3} \d+)|50)/i);
  if (intercepted) {
    const direction = intercepted[2] && intercepted[3] ? `${directionJa[`${intercepted[2].toLowerCase()} ${intercepted[3].toLowerCase()}`]}パス` : "パス";
    return `${prefix}${intercepted[1]}の${direction}を${intercepted[4]}が${intercepted[5]}でインターセプト${suffixes(rest)}`;
  }
  const complete = rest.match(/^([\w.'-]+) pass(?: (short|deep) (left|middle|right))? to ([\w.'-]+).*? for (-?\d+) yards?/i);
  if (complete) {
    const direction = complete[2] && complete[3] ? `${directionJa[`${complete[2].toLowerCase()} ${complete[3].toLowerCase()}`]}パス` : "パス";
    return `${prefix}${complete[1]}から${complete[4]}へ${direction}成功、${yardResult(complete[5])}${suffixes(rest)}`;
  }
  return null;
}

function renderRush(description: string) {
  const formed = formationPrefix(description);
  if (!formed) return null;
  const { prefix, rest } = formed;
  const kneel = rest.match(/^([\w.'-]+) kneels .*? for (-?\d+) yards?/i);
  if (kneel) return `${prefix}${kneel[1]}がニーダウン、${yardResult(kneel[2])}`;
  const scramble = rest.match(/^([\w.'-]+) scrambles(?: (left|right)(?: (?:end|tackle))?| up the middle)?.*? for (-?\d+) yards?/i);
  if (scramble) return `${prefix}${scramble[1]}がスクランブル、${yardResult(scramble[3])}${suffixes(rest)}`;
  const run = rest.match(/^([\w.'-]+) (left end|left tackle|left guard|up the middle|right guard|right tackle|right end).*? for (-?\d+) yards?/i);
  if (run) return `${prefix}${run[1]}が${directionJa[run[2].toLowerCase()]}をラン、${yardResult(run[3])}${suffixes(rest)}`;
  return null;
}

function renderKick(description: string) {
  const fieldGoal = description.match(/^([\w.'-]+) (\d+) yard field goal is (GOOD|No Good)/i);
  if (fieldGoal) return `${fieldGoal[1]}の${fieldGoal[2]}ヤード・フィールドゴールは${fieldGoal[3].toUpperCase() === "GOOD" ? "成功" : "失敗"}`;
  const punt = description.match(/^([\w.'-]+) punts (\d+) yards? to ((?:[A-Z]{2,3} \d+)|50)/i);
  if (punt) return `${punt[1]}が${punt[2]}ヤードのパント、${punt[3]}へ`;
  const kickoff = description.match(/^([\w.'-]+) kicks (\d+) yards? from ([A-Z]{2,3} \d+) to ([A-Z]{2,3} \d+|end zone)/i);
  if (kickoff) return `${kickoff[1]}が${kickoff[3]}から${kickoff[4]}へ${kickoff[2]}ヤードのキックオフ`;
  return null;
}

function renderOther(description: string) {
  const sack = description.match(/^([\w.'-]+) sacked at ((?:[A-Z]{2,3} \d+)|50) for (-?\d+) yards?/i);
  if (sack) return `${sack[1]}が${sack[2]}でサックされ、${yardResult(sack[3])}`;
  const timeout = description.match(/^Timeout #?(\d+)? by ([A-Z]{2,3})/i);
  if (timeout) return `${timeout[2]}が${timeout[1] ? `${timeout[1]}回目の` : ""}タイムアウト`;
  if (/^Two-Minute Warning/i.test(description)) return "ツーミニッツ・ウォーニング";
  return null;
}

export function renderPlayDescription(play: Play, language: DescriptionLanguage) {
  if (language === "en") return play.description;
  const rendered = play.kind === "pass" ? renderPass(play.description) :
    play.kind === "rush" ? renderRush(play.description) :
    play.kind === "field-goal" || play.kind === "punt" ? renderKick(play.description) :
    play.kind === "sack" ? renderOther(play.description) :
    renderPass(play.description) ?? renderRush(play.description) ?? renderKick(play.description) ?? renderOther(play.description);
  return rendered ?? play.description;
}
