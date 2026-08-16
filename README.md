# NFL Gamebook Companion

NFL公式Gamebook PDFを、見逃し配信向けの第二画面、1プレーずつ進むリプレー、試合後のデータ探索画面へ変換するローカルファーストWebアプリです。

外部のNFLデータAPIやLLM APIは使いません。PDFはブラウザ内のPDF.jsで解析され、端末外へ送信されません。

## 3つの体験

- **WATCH** — 現在位置を手動で同期し、Quarter、Clock、Down & Distance、Field Position、Drive、Playerを素早く確認。検索も現在位置までに制限できます。
- **REPLAY** — 次の結果を隠したまま、状況と簡易フィールドを見て `NEXT PLAY` で1プレーずつ進行。Drive終了時に要約を表示します。
- **EXPLORE** — Game Flow、Drives、Play-by-Play、Players、Team Statsを相互に行き来できます。

Spoiler Freeがオンの間、最終スコア、未来の得点、未来のDrive、未来のPlay、未来のPlayer関連プレーは現在のプレーカーソルより先を表示しません。

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

## アーキテクチャ

```text
Gamebook PDF
  → PDF.js（文字列 + X/Y座標）
  → セクション検出 / 行復元 / 表列分離
  → GameData（Teams / Scoring / Drives / Plays / Players / Snaps / Stats）
  → React UI（WATCH / REPLAY / EXPLORE）
```

- **クライアント完結**: サーバー処理や外部APIが不要な静的SPAです。
- **座標ベースの表抽出**: Team Stats、Individual Stats、Drive Chart、Snap Countは左右チームと列をX座標で分離します。
- **見出しベースのセクション検出**: ページ番号ではなく `Final Team Statistics`、`Ball Possession And Drive Chart`、`Play By Play` などの見出しで対象を探します。
- **PBP状態機械**: Quarter、Drive開始、Down/Distance行、折返し行、Penalty/Review追記を順に結合します。
- **raw保持**: 全ページの復元テキストと各プレーの元行を `GameData.source.rawPages` / `Play.rawText` に保持します。
- **関連付け**: Drive Chartのチーム別連番をPBPのDrive開始へ対応させ、選手表記をBox Stats、守備スタッツ、Snap Count、関与プレーへ統合します。

主要コード:

- `src/parser/pdf.ts` — PDF.jsによる座標付き文字抽出
- `src/parser/gamebook.ts` — NFL Gamebookの構造化と関連付け
- `src/types.ts` — GameDataスキーマ
- `src/App.tsx` — 3体験とSpoiler境界
- `tests/gamebook.fixture.test.ts` — 実Gamebook回帰テスト

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

## Parserの既知の制限

- V1は今回と同じNFL Gamebookレイアウトを対象にしています。過去年や別生成系で列位置・見出し・文字埋め込み方式が大きく異なるPDFは警告または部分抽出になる可能性があります。
- すべての自然言語プレーを完全に意味解析するものではありません。曖昧なPenalty、Replay、複合イベントはraw descriptionを優先します。
- Team略称、フィールド位置、Drive対応は標準的なNFL表記を前提にしています。
- スキャン画像だけのPDFにOCRは行いません。

## 回帰テスト

fixtureから直接、次を検証しています。

- 13–13、Total Net Yards IND 355 / NE 275
- Anthony Richardson: 11/14, 145 yards, 0 TD, 1 INT, Rating 80.1; rushing 6–53–1; offensive snaps 27 / 42%
- Riley Leonard: offensive snaps 38 / 58%
- Colts最初のDrive: IND 38、5 plays、29 yards、Interception、およびRichardsonのINTプレー紐付け
- Coltsの3得点とPBP紐付け
- PBP末尾が次のPDFセクションを取り込まないこと

## セキュリティ / プライバシー

- PDFは外部送信されません。
- 30 MBを超える入力はUIで拒否します。
- 静的配信サーバーはパストラバーサルを拒否し、`nosniff` と `no-referrer` を設定します。
- CSPでスクリプト、Worker、接続先を同一オリジンへ限定します。

## GitHub Pages

`main` へのpushで `.github/workflows/deploy.yml` がテスト、ビルド、Pages公開を行います。

PDF.js is licensed under the Apache License 2.0. Gamebook content remains subject to the rights and terms of its original publisher.
