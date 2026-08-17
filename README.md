# NFL Gamebook Companion

NFL公式Gamebook PDFを、見逃し配信向けの第二画面、1プレーずつ進むリプレー、試合後のデータ探索画面へ変換するローカルファーストWebアプリです。

外部のNFLデータAPIやLLM APIは使いません。PDFはブラウザ内のPDF.jsで解析され、端末外へ送信されません。

## 3つの体験

- **WATCH ALONG** — 見逃し映像へQuarter / Clockで手動同期する第二画面です。現在状況、直近Play、Current Play / Driveの実関与Player、検索を素早く確認します。
- **GAMEBOOK REPLAY** — 映像なしで、次の結果を隠したまま `NEXT PLAY` で進行します。固定された両Team陣地、攻撃方向、Ball Position、First-down marker、Drive終了要約を表示します。
- **EXPLORE** — Game Flow、Drives、Play-by-Play、Players、Team Statsを相互に行き来できます。

Spoiler Freeがオンの間、最終スコア、未来の得点、未来のDrive、未来のPlay、未来のPlayer関連プレーは現在のプレーカーソルより先を表示しません。進行中Driveの最終結果と、未来を含むBox Stats / Snap Count / Team Statsもロックします。

Play descriptionは全画面で `EN / JA` を共有できます。JAは外部翻訳を使わず、主動作、関与Player、Penalty、守備注記、Ball event、Scoring / Drive、Reviewへ分解した意味データから組み立てます。解釈不能な要素は捨てず、英語原文またはraw noteとして保持します。

## 起動方法

必要環境: Node.js 20以降、npm

```powershell
npm install
npm run dev
```

`http://127.0.0.1:4173` を開きます。`npm run dev` は型検査と本番バンドルを行ってから、依存のない小さな静的サーバーを起動します。

個別コマンド:

```powershell
npm test          # 実Gamebook回帰テスト
npm run build     # dist/ に静的サイトを生成
npm run preview   # 生成済みdist/を配信
npm run check     # test + build
```

## Gamebookの読み込み

1. 初期画面で `Choose PDF` を押すか、PDFをドロップします。
2. 解析はブラウザ内で完結します。
3. 同梱fixtureを使う場合は `Open Colts @ Patriots sample` を押します。

テストfixture:

- Indianapolis Colts at New England Patriots
- 2026-08-13 / Gillette Stadium
- `fixtures/colts-at-patriots-2026-08-13.pdf`
- SHA-256: `E2D3F5C2CA287B8250BA31B783F90F628B4A24592A59A08C35CF57DC61FE7E9E`

複数レイアウト回帰用fixture:

- Dallas Cowboys at Seattle Seahawks — 2026-08-15（HomeスコアのPDF.js baseline差を検証）
- Tennessee Titans at San Francisco 49ers — 2026-08-13（左右のPlayer / Position / Snap列を検証）

## アーキテクチャ

```text
Gamebook PDF
  → PDF.js（文字列 + X/Y座標）
  → セクション検出 / 行復元 / 表列分離
  → Play semantic parser（Action / Participants / Penalties / Events / State transition）
  → GameData（Teams / Scoring / Drives / Plays / Players / Snaps / Stats）
  → React UI（WATCH ALONG / GAMEBOOK REPLAY / EXPLORE）
```

- **クライアント完結**: サーバー処理や外部APIが不要な静的SPAです。
- **対称な左右表抽出**: ページ幅の中央でVisitor/Home領域を作り、同一の解析関数を両側へ適用します。Snap列は固定offsetではなく、`Offense / Defense / Special Teams` 見出しの実座標を列アンカーとして使います。
- **baseline許容付き行復元**: PDF.jsがフォントごとに保持する約0.75ptのbaseline差を、実際の行間より十分小さい1pt許容で同じ表行へ復元します。
- **見出しベースのセクション検出**: ページ番号ではなく `Final Team Statistics`、`Ball Possession And Drive Chart`、`Play By Play` などの見出しで対象を探します。
- **PBP状態機械**: Quarter、Drive開始、Down/Distance行、折返し行、Penalty/Review追記を順に結合します。
- **1 Play = 順序付き状態変化**: `stateBefore / stateAfter` に加え、原文offset順の `sequence[]`、複数の `actions[]`、phase、provisional/final ruling、確実なspot列を保持します。互換用 `action` は最終公式actionを指します。
- **phaseとReview正規化**: scrimmage / try / kickoff / administrativeを分け、Replay前後の同一反則再掲はreview境界をまたぐsemantic一致の場合だけ1件へ統合します。原文上の再掲位置はsequenceに残します。
- **情報を失わないJA**: event sequence順にMain Play、Penalty、Review、Timeout、Injury、XP / Drive summaryを表示し、構造化できないoffset区間だけを `RAW / UNPARSED` として原文保持します。
- **体験を分離したField**: WATCH ALONGはPossessionと攻撃方向を強調する小型Situation Indicator、GAMEBOOK REPLAYは確定済みPlayのStart → Official Finalと移動方向を主役にします。
- **共通キーボード操作**: WATCH ALONG / GAMEBOOK REPLAYでは `←` / `→` / `Space` でPlay移動できます。入力・ボタンへフォーカス中は発火しません。
- **Roster統合**: Starterだけでなく、左右のSubstitutions / Did Not Playを行折返し後に復元し、Stats / Defense / Snap / PBP由来PlayerへPositionを統合します。
- **missingと0を分離**: PDFにPlaytime Percentageがなければsection availabilityを`false`として保持し、UIは0%を推定せず`N/A`を表示します。
- **raw保持**: 全ページの復元テキストと各プレーの元行を `GameData.source.rawPages` / `Play.rawText` に保持します。
- **関連付け**: Drive Chartのチーム別連番をPBPのDrive開始へ対応させ、選手表記をBox Stats、守備スタッツ、Snap Count、関与プレーへ統合します。

主要コード:

- `src/parser/pdf.ts` — PDF.jsによる座標付き文字抽出
- `src/parser/gamebook.ts` — NFL Gamebookの構造化と関連付け
- `src/parser/playText.ts` — Play本文の意味イベント抽出
- `src/playDescription.ts` — APIを使わないEN/JA Playレンダラー
- `src/field.ts` — 固定Team陣地と攻撃方向・line-to-gainの座標モデル
- `src/types.ts` — GameDataスキーマ
- `src/App.tsx` — 3体験とSpoiler境界
- `tests/gamebook.fixture.test.ts` — 実Gamebook回帰テスト
- `tests/multi-gamebook.fixture.test.ts` — 3試合比較と片側欠落failure injection

## 現在の対応範囲

- 試合基本情報、最終スコア、Scoring
- Team Statistics
- Passing / Rushing / Receiving
- Defensive Statistics
- Drive Chart
- Quarter別Play-by-Play
- Playtime Percentage（Offense / Defense / Special Teams）
- Startersと有用なRoster情報
- Drive → Plays、Player → Stats / Snaps / Plays
- 解析後validation（Team、Score row、左右Player/Position/Snap/Team Stats、Drive/PBP対応）と `complete / partial` 状態
- Position group（QB、RB/FB、WR、TE、OL、DL、LB、DB、Specialists）とName順の切替
- Play participant role（Passer / Target / Rusher / Tackler / QB Hit / Penalty / Kicker等）
- section availability（Snap sectionなし、rowなし、実値を区別）
- Penalty / bracket注記 / Play semantic coverageのvalidation

## Parserの既知の制限

- V1は今回と同じNFL Gamebookレイアウトを対象にしています。過去年や別生成系で列位置・見出し・文字埋め込み方式が大きく異なるPDFは警告または部分抽出になる可能性があります。
- すべての自然言語プレーを完全に意味解析するものではありません。未知のlateralsや特殊な公式注記は、解析済みイベントを維持したまま該当区間だけをRAW表示します。
- Team略称、フィールド位置、Drive対応は現在の32 NFLチーム名と標準的なNFL表記を前提にしています。
- 括弧はPlay文脈からTacklerまたはDefensive involvement、角括弧はNFL Gamebook表記に従いQB hitとして扱います。曖昧な注記は別の意味へ推定せずraw noteに残します。
- 固定フィールドはVisitor側陣地を左、Home側陣地を右に置く「Team territory view」です。Gamebookからスタジアムの実方位・Quarterごとのside switchingを完全復元した表示ではありません。
- スキャン画像だけのPDFにOCRは行いません。

## 回帰テスト

fixtureから直接、次を検証しています。

- 13–13、Total Net Yards IND 355 / NE 275
- Anthony Richardson: 11/14, 145 yards, 0 TD, 1 INT, Rating 80.1; rushing 6–53–1; offensive snaps 27 / 42%
- Riley Leonard: offensive snaps 38 / 58%
- Colts最初のDrive: IND 38、5 plays、29 yards、Interception、およびRichardsonのINTプレー紐付け
- Coltsの3得点とPBP紐付け
- PBP末尾が次のPDFセクションを取り込まないこと
- Patriots Home QBのPosition / Offensive Snap抽出
- Cowboys 17–7 Seahawks、Total Net Yards 338 / 156、両側QB Stats、Drive/PBP
- Titans 19–13 49ers、Total Net Yards 279 / 322、A.Martinez 51 / 66%、K.Rourke 26 / 34%
- 片側Snapを意図的に欠落させた場合に `partial` / `snaps-one-sided` となること
- Pass complete / incomplete、rush、no gain、scramble、sack、kneel、spike、TD、FG / XP、punt / kickoff、timeout
- accepted / declined / offsetting / No Play Penalty、enforcement位置、括弧Tackler、角括弧QB hit、fumble/recovery、Scoring Drive summary
- 固定Team fieldのGoal Line、攻撃方向、First-down marker座標
- 未知構文の英語fallbackと、Penalty / bracketの未抽出validation

## セキュリティ / プライバシー

- PDFは外部送信されません。
- 30 MBを超える入力はUIで拒否します。
- 静的配信サーバーはパストラバーサルを拒否し、`nosniff` と `no-referrer` を設定します。
- CSPでスクリプト、Worker、接続先を同一オリジンへ限定します。

## GitHub Pages

`main` へのpushで `.github/workflows/deploy.yml` がテスト、ビルド、Pages公開を行います。

PDF.js is licensed under the Apache License 2.0. Gamebook content remains subject to the rights and terms of its original publisher.
