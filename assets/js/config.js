/**
 * config.js
 * -----------------------------------------------------------------------
 * サイト全体で共通の設定値をまとめるファイルです。
 * 「リポジトリ名を変えたい」「ブランチ名を変えたい」といった変更は、
 * このファイルの値を書き換えるだけで全画面に反映されます。
 *
 * このファイルはページの一番最初に読み込む前提です（他のJSより先）。
 * ------------------------------------------------------------------- */

window.AppConfig = {
  // --- 水道代OCR機能（Google Apps Script）関連 ---
  // TODO: Apps Scriptをウェブアプリとしてデプロイした後のURLに置き換えてください
  OCR_ENDPOINT_URL: "https://script.google.com/macros/s/XXXXXXXXXXXXXXXX/exec",
  // TODO: apps-script/Code.gs 側のスクリプトプロパティ SHARED_SECRET と同じ値にしてください。
  // 注意: このサイトは公開リポジトリで運用しているため、このJSファイルの中身も
  // 誰でも閲覧できます。つまりこの「合言葉」も事実上公開されており、
  // 「誰でも簡単に叩けないようにする程度」の抑止効果しかありません。
  // 本格的な認証にはなりませんが、無料の静的サイト構成での現実的な落としどころとして採用しています。
  OCR_SHARED_SECRET: "change-this-to-your-own-secret",

  // --- GitHubリポジトリ情報 ---
  // TODO: 実際に使うリポジトリのオーナー名・リポジトリ名に書き換えてください
  GITHUB_OWNER: "your-github-username",
  GITHUB_REPO: "household-dashboard",
  GITHUB_BRANCH: "main",

  // --- データファイルの場所（すべてリポジトリのルートからの相対パス） ---
  DATA_DIR: "data",
  CATEGORIES_FILE: "data/categories.json",

  /**
   * カテゴリ一覧（categories.json）を取得します。
   * 表示層・入力層のどちらからも、カテゴリを増やす際はこの1ファイルを
   * 経由するだけで済むようにするための共通関数です。
   *
   * @returns {Promise<Array<{id:string, label:string, csv:string, unit:string, hasUsage:boolean, color:string, order:number}>>}
   */
  async loadCategories() {
    const response = await fetch(this.CATEGORIES_FILE, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        `カテゴリ情報の取得に失敗しました（${this.CATEGORIES_FILE}, status: ${response.status}）`
      );
    }
    const categories = await response.json();
    // order（表示順）が小さい順に並べ替えておく
    return categories.sort((a, b) => a.order - b.order);
  },
};
