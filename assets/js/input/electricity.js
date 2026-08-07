/**
 * electricity.js
 * -----------------------------------------------------------------------
 * register/electricity.html の手入力フォームを制御します。
 *
 * 流れ:
 *   1. 既存の electricity.csv を読み込んでおく（重複年月の警告に使う）
 *   2. 入力内容を検証する
 *   3. Record を作り、CSVLib.upsertRecord() で既存データに反映する
 *   4. CSVLib.stringifyRecords() でCSVテキストに変換する
 *   5. GitHubAPI.commitCSV() でコミットする（現時点ではスタブ。ステップ14で本実装）
 *
 * 電気代・水道代のどちらも最終的にはこの5ステップと同じ形でCSVへ反映されます。
 * 水道代側（water-ocr.js）は「値の取得方法」が手入力ではなくOCRになるだけで、
 * 3〜5のロジックは基本的に同じ形になります。
 * ------------------------------------------------------------------- */

(function () {
  const CSV_LOCAL_PATH = "../data/electricity.csv"; // fetch()での読み込み用（このページから見た相対パス）
  const CSV_REPO_PATH = "data/electricity.csv"; // GitHub Contents API用（リポジトリルートから見たパス）

  const form = document.getElementById("electricity-form");
  const yearMonthInput = document.getElementById("year-month");
  const amountInput = document.getElementById("amount");
  const usageInput = document.getElementById("usage");
  const memoInput = document.getElementById("memo");
  const formError = document.getElementById("form-error");
  const overwriteWarning = document.getElementById("form-overwrite-warning");
  const submitButton = document.getElementById("submit-button");
  const submitStatus = document.getElementById("submit-status");

  /** @type {Array<Object>} ページ読み込み時に取得した既存のRecord一覧 */
  let existingRecords = [];

  /** 今日の日付から "YYYY-MM" を作る（aggregate.jsを読み込んでいないページなので個別に用意） */
  function currentYearMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function showError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function hideError() {
    formError.hidden = true;
    formError.textContent = "";
  }

  /** 入力内容を検証する。問題なければ null、問題があればエラーメッセージを返す */
  function validate() {
    if (!/^\d{4}-\d{2}$/.test(yearMonthInput.value)) {
      return "対象年月を選択してください。";
    }
    if (amountInput.value === "" || Number(amountInput.value) < 0) {
      return "請求額は0以上の数値で入力してください。";
    }
    if (usageInput.value !== "" && Number(usageInput.value) < 0) {
      return "使用量は0以上の数値で入力してください。";
    }
    return null;
  }

  /** 選択中の年月が既存データと重複しているかどうかで警告表示を切り替える */
  function updateOverwriteWarning() {
    const exists = existingRecords.some((r) => r.yearMonth === yearMonthInput.value);
    overwriteWarning.hidden = !exists;
  }

  async function loadExistingRecords() {
    try {
      existingRecords = await window.CSVLib.fetchRecords(CSV_PATH);
    } catch (error) {
      // 初回登録などでCSVがまだ存在しない場合もあり得るため、
      // ここでは致命的エラーにはせず、空配列として続行する
      console.warn("既存データの取得に失敗しました（初回登録の場合は正常です）:", error);
      existingRecords = [];
    }
    updateOverwriteWarning();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    hideError();

    const validationError = validate();
    if (validationError) {
      showError(validationError);
      return;
    }

    const newRecord = {
      yearMonth: yearMonthInput.value,
      amount: Number(amountInput.value),
      usage: usageInput.value === "" ? null : Number(usageInput.value),
      memo: memoInput.value.trim(),
      inputMethod: "manual",
      registeredAt: new Date().toISOString(),
    };

    const updatedRecords = window.CSVLib.upsertRecord(existingRecords, newRecord);
    const csvText = window.CSVLib.stringifyRecords(updatedRecords);
    const isOverwrite = existingRecords.some((r) => r.yearMonth === newRecord.yearMonth);
    const commitMessage = `${isOverwrite ? "更新" : "追加"}: 電気代 ${newRecord.yearMonth}`;

    submitButton.disabled = true;
    submitStatus.textContent = "登録処理中...";

    try {
      const result = await window.GitHubAPI.commitCSV(CSV_PATH, csvText, commitMessage);

      if (result.stub) {
        // ステップ14でGitHub連携が実装されるまでの暫定表示
        submitStatus.textContent =
          "（確認用）入力内容は正しく処理されました。実際のGitHubへの保存はステップ14で有効になります。";
      } else {
        submitStatus.textContent = "登録しました。";
      }

      existingRecords = updatedRecords;
      updateOverwriteWarning();
    } catch (error) {
      console.error("登録に失敗しました:", error);
      showError("登録に失敗しました。通信環境を確認して、もう一度お試しください。");
      submitStatus.textContent = "";
    } finally {
      submitButton.disabled = false;
    }
  }

  yearMonthInput.value = currentYearMonth();
  yearMonthInput.addEventListener("change", updateOverwriteWarning);
  form.addEventListener("submit", handleSubmit);

  loadExistingRecords();
})();
