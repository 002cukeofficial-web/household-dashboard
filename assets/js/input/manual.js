/**
 * manual.js
 * -----------------------------------------------------------------------
 * register/manual.html を制御します。
 *
 * electricity.js とほぼ同じ処理内容ですが、対象カテゴリを固定せず
 * URLの ?category=xxx と categories.json から動的に決定する点だけが違います。
 *
 * 【拡張性のポイント】
 * 手入力タイプの新しいカテゴリ（例: NHK・固定資産税・クレジットカードなど）を
 * 追加するときは、以下の2つを行うだけで登録画面が使えるようになります。
 *   1. data/<category>.csv を作成する（ヘッダー行だけでOK）
 *   2. data/categories.json にエントリを1つ追加する
 * このHTML・このJSファイルは一切変更する必要がありません。
 * ------------------------------------------------------------------- */

(function () {
  const params = new URLSearchParams(window.location.search);
  const categoryId = params.get("category");

  const pageTitle = document.getElementById("page-title");
  const pageHeading = document.getElementById("page-heading");
  const pageDescription = document.getElementById("page-description");
  const categoryError = document.getElementById("category-error");
  const form = document.getElementById("manual-form");

  const yearMonthInput = document.getElementById("year-month");
  const amountInput = document.getElementById("amount");
  const usageGroup = document.getElementById("usage-group");
  const usageLabel = document.getElementById("usage-label");
  const usageInput = document.getElementById("usage");
  const memoInput = document.getElementById("memo");
  const formError = document.getElementById("form-error");
  const overwriteWarning = document.getElementById("form-overwrite-warning");
  const submitButton = document.getElementById("submit-button");
  const submitStatus = document.getElementById("submit-status");

  let category = null; // categories.json から見つかったカテゴリ情報
  let csvLocalPath = ""; // fetch()での読み込み用（このページから見た相対パス）
  let csvRepoPath = ""; // GitHub Contents API用（リポジトリルートから見たパス）
  let existingRecords = [];

  function currentYearMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * 選択中の年月に既存データがあれば、請求額・使用量・備考へ読み込んで表示する。
   * 未登録の年月に切り替えた場合は入力欄を空に戻す。
   */
  function syncFormWithExistingRecord() {
    const existing = existingRecords.find((r) => r.yearMonth === yearMonthInput.value);

    overwriteWarning.hidden = !existing;

    if (existing) {
      overwriteWarning.textContent =
        "この年月は既に登録されています。現在の登録内容を表示しています。登録すると上書きされます。";
      amountInput.value = existing.amount;
      usageInput.value = existing.usage === null || existing.usage === undefined ? "" : existing.usage;
      memoInput.value = existing.memo || "";
    } else {
      amountInput.value = "";
      usageInput.value = "";
      memoInput.value = "";
    }
  }

  async function init() {
    if (!categoryId) {
      categoryError.hidden = false;
      return;
    }

    let categories;
    try {
      categories = await window.AppConfig.loadCategories();
    } catch (error) {
      console.error("カテゴリ情報の取得に失敗しました:", error);
      categoryError.hidden = false;
      return;
    }

    category = categories.find((c) => c.id === categoryId);
    if (!category) {
      categoryError.hidden = false;
      return;
    }

    // categories.json の csv はリポジトリルートから見た相対パス（例: "data/gas.csv"）。
    // fetch()での読み込みには「../」を付けたページ相対パスが必要で、
    // GitHub Contents APIへの書き込みにはルート相対パスのまま渡す必要がある。
    csvLocalPath = `../${category.csv}`;
    csvRepoPath = category.csv;

    // --- 画面の見出し・ラベルをカテゴリに合わせて差し替える ---
    pageTitle.textContent = `${category.label}登録 | わが家の光熱費ダッシュボード`;
    pageHeading.textContent = `${category.label}を登録`;
    pageDescription.textContent = `${category.label}の請求書を見ながら、以下の項目を入力してください。`;

    if (category.hasUsage) {
      usageLabel.textContent = `使用量${category.unit ? `（${category.unit}）` : ""}`;
    } else {
      // 使用量の概念がないカテゴリ（NHK・固定資産税・クレジットカードなど）は入力欄ごと隠す
      usageGroup.hidden = true;
    }

    yearMonthInput.value = currentYearMonth();
    form.hidden = false;

    try {
      existingRecords = await window.CSVLib.fetchRecords(csvLocalPath);
    } catch (error) {
      console.warn("既存データの取得に失敗しました（初回登録の場合は正常です）:", error);
      existingRecords = [];
    }
    syncFormWithExistingRecord();

    yearMonthInput.addEventListener("change", syncFormWithExistingRecord);
    form.addEventListener("submit", handleSubmit);
  }

  function validate() {
    if (!/^\d{4}-\d{2}$/.test(yearMonthInput.value)) {
      return "対象年月を選択してください。";
    }
    if (amountInput.value === "" || Number(amountInput.value) < 0) {
      return "請求額は0以上の数値で入力してください。";
    }
    if (category.hasUsage && usageInput.value !== "" && Number(usageInput.value) < 0) {
      return "使用量は0以上の数値で入力してください。";
    }
    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    formError.hidden = true;

    const validationError = validate();
    if (validationError) {
      formError.textContent = validationError;
      formError.hidden = false;
      return;
    }

    const newRecord = {
      yearMonth: yearMonthInput.value,
      amount: Number(amountInput.value),
      usage: category.hasUsage && usageInput.value !== "" ? Number(usageInput.value) : null,
      memo: memoInput.value.trim(),
      inputMethod: "manual",
      registeredAt: new Date().toISOString(),
    };

    const updatedRecords = window.CSVLib.upsertRecord(existingRecords, newRecord);
    const csvText = window.CSVLib.stringifyRecords(updatedRecords);
    const isOverwrite = existingRecords.some((r) => r.yearMonth === newRecord.yearMonth);
    const commitMessage = `${isOverwrite ? "更新" : "追加"}: ${category.label} ${newRecord.yearMonth}`;

    submitButton.disabled = true;
    submitStatus.textContent = "登録処理中...";

    try {
      const result = await window.GitHubAPI.commitCSV(csvRepoPath, csvText, commitMessage);
      submitStatus.textContent = result.stub
        ? "（確認用）入力内容は正しく処理されました。"
        : "登録しました。";
      existingRecords = updatedRecords;
      // 登録直後は自分自身と一致して警告が出てしまうため、単純に隠す
      overwriteWarning.hidden = true;
    } catch (error) {
      console.error("登録に失敗しました:", error);
      formError.textContent = `登録に失敗しました: ${error.message || "原因不明のエラーです。"}`;
      formError.hidden = false;
      submitStatus.textContent = "";
    } finally {
      submitButton.disabled = false;
    }
  }

  init();
})();
