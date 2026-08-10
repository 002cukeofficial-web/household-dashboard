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

  /**
   * 選択中の年月に既存データがあれば、請求額・使用量・備考へ読み込んで表示する。
   * これにより、登録画面を開いた・年月を変更しただけで「その月は登録済みかどうか」
   * 「登録済みなら何円だったか」がグラフ画面に戻らなくても確認できる。
   * 既存データが無い年月に切り替えた場合は、入力欄を空に戻す。
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

  async function loadExistingRecords() {
    try {
      existingRecords = await window.CSVLib.fetchRecords(CSV_LOCAL_PATH);
    } catch (error) {
      // 初回登録などでCSVがまだ存在しない場合もあり得るため、
      // ここでは致命的エラーにはせず、空配列として続行する
      console.warn("既存データの取得に失敗しました（初回登録の場合は正常です）:", error);
      existingRecords = [];
    }
    syncFormWithExistingRecord();
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
      const result = await window.GitHubAPI.commitCSV(CSV_REPO_PATH, csvText, commitMessage);

      if (result.stub) {
        // ステップ14でGitHub連携が実装されるまでの暫定表示
        submitStatus.textContent =
          "（確認用）入力内容は正しく処理されました。実際のGitHubへの保存はステップ14で有効になります。";
      } else {
        submitStatus.textContent = "登録しました。";
      }

      existingRecords = updatedRecords;
      // 登録直後は「今まさに登録した月」がexistingRecordsに含まれるため、
      // ここでupdateOverwriteWarning()を呼ぶと自分自身と一致して警告が出てしまう。
      // 登録成功直後は単純に警告を隠す（次に年月を変更したときに改めて判定される）。
      overwriteWarning.hidden = true;
    } catch (error) {
      console.error("登録に失敗しました:", error);
      showError(
        `登録に失敗しました: ${error.message || "原因不明のエラーです。"}`
      );
      submitStatus.textContent = "";
    } finally {
      submitButton.disabled = false;
    }
  }

  yearMonthInput.value = currentYearMonth();
  yearMonthInput.addEventListener("change", syncFormWithExistingRecord);
  form.addEventListener("submit", handleSubmit);

  loadExistingRecords();
})();
