/**
 * github-api.js
 * -----------------------------------------------------------------------
 * GitHub Contents API を使って、CSVファイルを実際にリポジトリへ
 * コミットするための処理です（ステップ2で決めた書き込み経路）。
 *
 * 入力層（electricity.js / water-ocr.js）は commitCSV() を呼ぶだけで、
 * 認証やAPIの詳細を意識しなくて済むようにしています。
 *
 * 【トークンの扱いについて】
 * このアプリは完全な静的サイトのため、サーバー側でトークンを安全に
 * 管理する仕組みを持てません。そのため、書き込み権限を持つ
 * Personal Access Token を「ブラウザのlocalStorageに保存する」という、
 * 個人・家族利用を前提にした現実的な妥協をしています。
 * 対象リポジトリを1つに限定し、権限も Contents の読み書きだけに絞った
 * Fine-grained PAT を使うことで、万一漏れた場合の被害を最小限にしています。
 * ------------------------------------------------------------------- */

window.GitHubAPI = (function () {
  const TOKEN_STORAGE_KEY = "gh_pat";

  function getStoredToken() {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  }

  function storeToken(token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
  }

  /** 無効になったトークンを保存領域から取り除く（401が返ったときに使う） */
  function clearToken() {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  /**
   * 保存済みのトークンを返します。無ければ入力を求め、保存してから返します。
   * @returns {Promise<string>}
   */
  async function ensureToken() {
    let token = getStoredToken();
    if (token) return token;

    token = window.prompt(
      "GitHubのPersonal Access Token（Fine-grained、対象リポジトリの Contents: Read and write 権限）を入力してください。\n" +
        "一度入力すればこの端末に保存され、次回からは入力不要になります。"
    );
    if (!token || !token.trim()) {
      throw new Error("トークンが入力されなかったため、登録を中止しました。");
    }
    storeToken(token);
    return token.trim();
  }

  function apiUrl(path) {
    const { GITHUB_OWNER, GITHUB_REPO } = window.AppConfig;
    return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  }

  function authHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /** 日本語を含む文字列を、GitHub APIが要求するBase64形式に変換する */
  function toBase64(text) {
    const utf8Bytes = new TextEncoder().encode(text);
    let binary = "";
    utf8Bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  /**
   * 現在のファイルの sha を取得します。ファイルが存在しない場合（新規作成時）は
   * null を返します。
   *
   * @param {string} path
   * @param {string} token
   * @returns {Promise<string|null>}
   */
  async function fetchCurrentSha(path, token) {
    const response = await fetch(`${apiUrl(path)}?ref=${window.AppConfig.GITHUB_BRANCH}`, {
      headers: authHeaders(token),
    });

    if (response.status === 404) return null; // 新規ファイル
    if (response.status === 401) {
      clearToken();
      throw new Error("GitHubトークンが無効です。次回操作時に再入力を求めます。");
    }
    if (!response.ok) {
      throw new Error(`ファイル情報の取得に失敗しました（status: ${response.status}）`);
    }

    const data = await response.json();
    return data.sha;
  }

  /**
   * 実際にファイルをコミットします（sha不一致で1回だけ自動リトライ）。
   *
   * @param {string} path
   * @param {string} csvText
   * @param {string} commitMessage
   * @param {string} token
   * @param {boolean} isRetry
   * @returns {Promise<Object>} GitHub APIのレスポンスJSON
   */
  async function putFile(path, csvText, commitMessage, token, isRetry) {
    const sha = await fetchCurrentSha(path, token);

    const response = await fetch(apiUrl(path), {
      method: "PUT",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        content: toBase64(csvText),
        branch: window.AppConfig.GITHUB_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });

    if (response.status === 409 && !isRetry) {
      // 直前で取得したshaが、書き込み時点では既に古くなっていた（競合）ケース。
      // 最新のshaを取得し直して、1回だけ自動的に再試行する。
      return putFile(path, csvText, commitMessage, token, true);
    }

    if (response.status === 401) {
      clearToken();
      throw new Error("GitHubトークンが無効です。次回操作時に再入力を求めます。");
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(
        `GitHubへの保存に失敗しました（status: ${response.status}${
          errorBody.message ? `: ${errorBody.message}` : ""
        }）`
      );
    }

    return response.json();
  }

  /**
   * CSVファイルをコミットします。入力層から呼び出す唯一の窓口です。
   *
   * @param {string} path 例: "data/electricity.csv"
   * @param {string} csvText 書き込むCSVの全文
   * @param {string} commitMessage
   * @returns {Promise<{success: boolean, stub: boolean}>}
   */
  async function commitCSV(path, csvText, commitMessage) {
    const token = await ensureToken();
    await putFile(path, csvText, commitMessage, token, false);
    return { success: true, stub: false };
  }

  return { commitCSV, clearToken };
})();
