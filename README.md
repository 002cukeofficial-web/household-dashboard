# わが家の光熱費ダッシュボード

GitHub Pages・GitHub Repository・CSVのみで構築した、家庭用の光熱費・家計ダッシュボードです。
ランニングコストは無料、保守はGitHub上でのCSV編集で完結します。

## 構成

- 表示層: GitHub Pages（`index.html` ほか、HTML/CSS/JavaScript + Chart.js）
- データ層: このリポジトリの `data/*.csv`
- 入力層: 電気代は手入力フォーム、水道代はスマホ撮影 → OCR（Google Apps Script + Drive API）

## セットアップ手順

### 1. リポジトリの準備

1. このリポジトリをご自身のGitHubアカウントにコピーする
2. `assets/js/config.js` の `GITHUB_OWNER` / `GITHUB_REPO` を、実際のユーザー名・リポジトリ名に書き換える
3. リポジトリの Settings → Pages で GitHub Pages を有効化する（公開リポジトリであれば無料）

### 2. 書き込み用トークン（Fine-grained Personal Access Token）の作成

電気代・水道代の登録機能は、ブラウザから直接GitHubへコミットするために、書き込み権限を持つトークンが必要です。

1. GitHubの Settings → Developer settings → Personal access tokens → **Fine-grained tokens** を開く
2. 「Generate new token」を選択
3. **Repository access** で「Only select repositories」を選び、このリポジトリだけを選択する（他のリポジトリに影響が及ばないようにするため）
4. **Permissions** → Repository permissions → **Contents** を「Read and write」に設定する（他の権限は不要）
5. 発行されたトークンをコピーしておく（この画面を閉じると二度と表示されません）
6. 電気代または水道代の登録画面で初めて「登録」ボタンを押したときに入力を求められるので、そこに貼り付ける
   - 一度入力すれば、その端末のブラウザに保存され、次回以降は入力不要になります
   - トークンが無効になった場合（有効期限切れなど）は、次回操作時に自動的に再入力を求められます

### 3. 水道代OCR機能（Google Apps Script）のデプロイ

`apps-script/Code.gs` 内のコメントに沿って、Google Apps Scriptをウェブアプリとしてデプロイし、発行されたURLと合言葉を `assets/js/config.js` の `OCR_ENDPOINT_URL` / `OCR_SHARED_SECRET` に設定してください。

## データの見方・直し方

`data/*.csv` はExcelやGitHub上のテキストエディタでそのまま開けます。誤った値を登録してしまった場合は、CSVを直接編集してコミットしても構いません（アプリを介さない修正も可能です）。
