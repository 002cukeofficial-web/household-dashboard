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
  let csvPath = "";
  let existingRecords = [];

  function currentYearMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function updateOverwriteWarning() {
    const exists = existingRecords.some((r) => r.yearMonth === yearMonthInput.value);
    overwriteWarning.hidden = !exists;
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

    // register/ 配下のページなので、categories.json に書かれたルート相対パスへ「../」を付与する
    csvPath = `../${category.csv}`;

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
      existingRecords = await window.CSVLib.fetchRecords(csvPath);
    } catch (error) {
      console.warn("既存データの取得に失敗しました（初回登録の場合は正常です）:", error);
      existingRecords = [];
    }
    updateOverwriteWarning();

    yearMonthInput.addEventListener("change", updateOverwriteWarning);
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
      const result = await window.GitHubAPI.commitCSV(csvPath, csvText, commitMessage);
      submitStatus.textContent = result.stub
        ? "（確認用）入力内容は正しく処理されました。"
        : "登録しました。";
      existingRecords = updatedRecords;
      updateOverwriteWarning();
    } catch (error) {
      console.error("登録に失敗しました:", error);
      formError.textContent = "登録に失敗しました。通信環境を確認して、もう一度お試しください。";
      formError.hidden = false;
      submitStatus.textContent = "";
    } finally {
      submitButton.disabled = false;
    }
  }

  init();
})();
