# NFL Gamebook Companion

NFL公式Gamebook PDFを、見逃し配信向けの第二画面、1プレーずつ進むリプレー、試合後のデータ探索画面へ変換するローカルファーストWebアプリです。

外部のNFLデータAPIやLLM APIは使いません。PDFはブラウザ内のPDF.jsで解析され、端末外へ送信されません。

## 3つの体験

- **WATCH** — 現在位置を手動で同期し、Quarter、Clock、Down & Distance、Field Position、Drive、Playerを素早く確認。検索も現在位置までに制限できます。
- **REPLAY** — 次の結果を隠したまま、状況と簡易フィールドを見て `NEXT PLAY` で1プレーずつ進行。Drive終了時に要約を表示します。
- **EXPLORE** — Game Flow、Drives、Play-by-Play、Players、Team Statsを相互に行き来できます。

Spoiler Freeがオンの間、最終スコア、未来の得点、未来のDrive、未来のPlay、未来のPlayer関連プレーは現在のプレーカーソルより先を表示しません。進行中Driveの最終結果と、未来を含むBox Stats / Snap Count / Team Statsもロックします。

Play descriptionは全画面で `EN / JA` を共有できます。JAは外部翻訳を使わず、構造化されたPlay種別とNFL定型文法からローカルで組み立て、解釈できない文は英語原文へ戻します。

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
  → GameData（Teams / Scoring / Drives / Plays / Players / Snaps / Stats）
  → React UI（WATCH / REPLAY / EXPLORE）
```

- **クライアント完結**: サーバー処理や外部APIが不要な静的SPAです。
- **対称な左右表抽出**: ページ幅の中央でVisitor/Home領域を作り、同一の解析関数を両側へ適用します。Snap列は固定offsetではなく、`Offense / Defense / Special Teams` 見出しの実座標を列アンカーとして使います。
- **baseline許容付き行復元**: PDF.jsがフォントごとに保持する約0.75ptのbaseline差を、実際の行間より十分小さい1pt許容で同じ表行へ復元します。
- **見出しベースのセクション検出**: ページ番号ではなく `Final Team Statistics`、`Ball Possession And Drive Chart`、`Play By Play` などの見出しで対象を探します。
- **PBP状態機械**: Quarter、Drive開始、Down/Distance行、折返し行、Penalty/Review追記を順に結合します。
- **raw保持**: 全ページの復元テキストと各プレーの元行を `GameData.source.rawPages` / `Play.rawText` に保持します。
- **関連付け**: Drive Chartのチーム別連番をPBPのDrive開始へ対応させ、選手表記をBox Stats、守備スタッツ、Snap Count、関与プレーへ統合します。

主要コード:

- `src/parser/pdf.ts` — PDF.jsによる座標付き文字抽出
- `src/parser/gamebook.ts` — NFL Gamebookの構造化と関連付け
- `src/playDescription.ts` — APIを使わないEN/JA Playレンダラー
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

## Parserの既知の制限

- V1は今回と同じNFL Gamebookレイアウトを対象にしています。過去年や別生成系で列位置・見出し・文字埋め込み方式が大きく異なるPDFは警告または部分抽出になる可能性があります。
- すべての自然言語プレーを完全に意味解析するものではありません。曖昧なPenalty、Replay、複合イベントはraw descriptionを優先します。
- Team略称、フィールド位置、Drive対応は現在の32 NFLチーム名と標準的なNFL表記を前提にしています。
- JA rendererはPass、Rush、Scramble、Sack、Turnover、Field Goal、Punt、Kickoff等の頻出構文を対象とし、複雑なPenalty / Replay / lateral等は誤訳せず英語原文へフォールバックします。
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
- JA定型レンダリングと未知構文の英語fallback

## セキュリティ / プライバシー

- PDFは外部送信されません。
- 30 MBを超える入力はUIで拒否します。
- 静的配信サーバーはパストラバーサルを拒否し、`nosniff` と `no-referrer` を設定します。
- CSPでスクリプト、Worker、接続先を同一オリジンへ限定します。

## GitHub Pages

`main` へのpushで `.github/workflows/deploy.yml` がテスト、ビルド、Pages公開を行います。

PDF.js is licensed under the Apache License 2.0. Gamebook content remains subject to the rights and terms of its original publisher.
