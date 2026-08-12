/**
 * water-ocr.js
 * -----------------------------------------------------------------------
 * register/water.html を制御します。
 *
 * 流れ:
 *   1. 画像を選択／撮影 → 向きを補正しながら圧縮 → プレビュー表示
 *   2. 「OCRで読み取る」→ Apps ScriptのWebアプリへ画像を送信
 *   3. 返ってきた年月・請求額・使用量を確認フォームに反映（確認・修正可能）
 *   4. 登録 → electricity.js と同じ形で CSVLib.upsertRecord → GitHubAPI.commitCSV
 *
 * OCR結果の信頼性は完璧ではないため、必ず確認画面を経由してから
 * 登録する設計にしています（ステップ3で決めた方針）。
 * ------------------------------------------------------------------- */

(function () {
  const CSV_LOCAL_PATH = "../data/water.csv"; // fetch()での読み込み用（このページから見た相対パス）
  const CSV_REPO_PATH = "data/water.csv"; // GitHub Contents API用（リポジトリルートから見たパス）
  const MAX_IMAGE_DIMENSION = 1600; // 長辺の最大ピクセル数（これ以上は縮小する）
  const JPEG_QUALITY = 0.82;

  // --- STEP A: アップロード ---
  const stepUpload = document.getElementById("step-upload");
  const receiptImageCameraInput = document.getElementById("receipt-image-camera");
  const receiptImageGalleryInput = document.getElementById("receipt-image-gallery");
  const receiptPreview = document.getElementById("receipt-preview");
  const uploadError = document.getElementById("upload-error");
  const runOcrButton = document.getElementById("run-ocr-button");
  const ocrStatus = document.getElementById("ocr-status");

  // --- STEP B: 確認・修正 ---
  const stepConfirm = document.getElementById("step-confirm");
  const waterForm = document.getElementById("water-form");
  const yearMonthInput = document.getElementById("water-year-month");
  const amountInput = document.getElementById("water-amount");
  const usageInput = document.getElementById("water-usage");
  const memoInput = document.getElementById("water-memo");
  const ocrNote = document.getElementById("water-ocr-note");
  const formError = document.getElementById("water-form-error");
  const overwriteWarning = document.getElementById("water-overwrite-warning");
  const backButton = document.getElementById("back-to-upload-button");
  const submitButton = document.getElementById("water-submit-button");
  const submitStatus = document.getElementById("water-submit-status");

  /** 圧縮・向き補正済みの画像（base64、"data:image/jpeg;base64,"を含まない部分だけ保持） */
  let processedImageBase64 = null;
  /** ページ読み込み時に取得した既存のRecord一覧（重複年月の警告に使う） */
  let existingRecords = [];

  // ===========================================================
  // 画像の圧縮
  // ===========================================================
  // 【向き（回転）補正について】
  // 以前はEXIFのOrientation情報を自前で解析して回転補正するコードを
  // ここに書いていましたが、現在の主要ブラウザ（Chrome・Safari・Firefox）は
  // 画像を読み込む時点でEXIFの向きを自動的に反映してくれるため、
  // 自前の補正コードを実行すると「補正が二重にかかってしまい、
  // かえって向きがおかしくなる」不具合が起きていました。
  // そのため、向き補正はブラウザに任せ、ここでは縮小のみを行います。

  /**
   * 画像ファイルを読み込み、長辺が MAX_IMAGE_DIMENSION を超えないように
   * 縮小したJPEGのdata URLを返します。向き補正はブラウザに任せています。
   *
   * @param {File} file
   * @returns {Promise<string>} "data:image/jpeg;base64,...." 形式の文字列
   */
  function processImageFile(file) {
    return new Promise((resolve, reject) => {
      const blobUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error("画像の読み込みに失敗しました"));
      };
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);

        // img.width / img.height は、ブラウザが既にEXIFの向きを反映した後の
        // 見た目通りの寸法になっている
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
        const outputWidth = Math.round(img.width * scale);
        const outputHeight = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, outputWidth, outputHeight);

        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = blobUrl;
    });
  }

  // ===========================================================
  // STEP A: 画像選択・OCR実行
  // ===========================================================

  /**
   * 選ばれた画像ファイルを処理する共通処理。
   * カメラ撮影・アルバム選択のどちらの入力欄からも呼ばれる。
   * @param {File|undefined} file
   * @param {HTMLInputElement} otherInput もう片方の入力欄（選択状態をクリアするため）
   */
  async function handleImageFileSelected(file, otherInput) {
    uploadError.hidden = true;
    runOcrButton.disabled = true;
    processedImageBase64 = null;

    if (!file) return;

    // カメラ・アルバムどちらか一方だけを「選択中」の状態にする
    // （両方に値が残っていると、どちらの画像を使うのか分かりにくくなるため）
    otherInput.value = "";

    if (!file.type.startsWith("image/")) {
      uploadError.textContent = "画像ファイルを選択してください。";
      uploadError.hidden = false;
      return;
    }

    try {
      ocrStatus.textContent = "画像を処理しています...";
      const dataUrl = await processImageFile(file);
      processedImageBase64 = dataUrl.split(",")[1]; // "data:image/jpeg;base64," を除いた部分

      receiptPreview.src = dataUrl;
      receiptPreview.hidden = false;
      runOcrButton.disabled = false;
      ocrStatus.textContent = "";
    } catch (error) {
      console.error("画像の処理に失敗しました:", error);
      uploadError.textContent = "画像の処理に失敗しました。別の画像でお試しください。";
      uploadError.hidden = false;
      ocrStatus.textContent = "";
    }
  }

  receiptImageCameraInput.addEventListener("change", () => {
    handleImageFileSelected(receiptImageCameraInput.files[0], receiptImageGalleryInput);
  });

  receiptImageGalleryInput.addEventListener("change", () => {
    handleImageFileSelected(receiptImageGalleryInput.files[0], receiptImageCameraInput);
  });

  runOcrButton.addEventListener("click", async () => {
    if (!processedImageBase64) return;

    runOcrButton.disabled = true;
    ocrStatus.textContent = "OCRで読み取り中...（数秒かかる場合があります）";
    uploadError.hidden = true;

    try {
      const response = await fetch(window.AppConfig.OCR_ENDPOINT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: processedImageBase64,
          mimeType: "image/jpeg",
          secret: window.AppConfig.OCR_SHARED_SECRET,
        }),
      });

      if (!response.ok) {
        throw new Error(`OCRサーバーへの接続に失敗しました（status: ${response.status}）`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "OCR処理に失敗しました");
      }

      showConfirmStep(result.extracted);
    } catch (error) {
      console.error("OCRに失敗しました:", error);
      uploadError.textContent = `OCRの読み取りに失敗しました: ${error.message || "原因不明のエラーです。"}`;
      uploadError.hidden = false;
      ocrStatus.textContent = "";
      runOcrButton.disabled = false;
    }
  });

  // ===========================================================
  // STEP B: 確認・修正・登録
  // ===========================================================

  /** 今日の日付から "YYYY-MM" を作る */
  function currentYearMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  async function loadExistingRecords() {
    try {
      existingRecords = await window.CSVLib.fetchRecords(CSV_LOCAL_PATH);
    } catch (error) {
      console.warn("既存データの取得に失敗しました（初回登録の場合は正常です）:", error);
      existingRecords = [];
    }
  }

  /** OCR結果表示直後に呼ぶ。警告表示のみ切り替え、OCRが読み取った値は上書きしない */
  function updateOverwriteWarning() {
    const exists = existingRecords.some((r) => r.yearMonth === yearMonthInput.value);
    overwriteWarning.hidden = !exists;
    overwriteWarning.textContent = "同じ年月のデータが既に登録されています。登録すると上書きされます。";
  }

  /**
   * ユーザーが確認画面で年月を手動変更したときに呼ぶ。
   * その年月に既存データがあれば、請求額・使用量・備考へ読み込んで表示する
   * （OCRが誤って別の月として読み取った場合の手直しにも使える）。
   * 既存データが無ければ入力欄を空に戻す。
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

  /**
   * OCR結果を確認フォームに反映して、STEP Bの画面に切り替えます。
   * 読み取れなかった項目は空欄のままにし、必ず人の目で確認・入力してもらいます。
   *
   * @param {{yearMonth: string|null, amount: number|null, usage: number|null}} extracted
   */
  function showConfirmStep(extracted) {
    yearMonthInput.value = extracted.yearMonth || currentYearMonth();
    amountInput.value = extracted.amount !== null && extracted.amount !== undefined ? extracted.amount : "";
    usageInput.value = extracted.usage !== null && extracted.usage !== undefined ? extracted.usage : "";
    memoInput.value = "";

    const missingFields = [];
    if (!extracted.yearMonth) missingFields.push("対象年月");
    if (extracted.amount === null || extracted.amount === undefined) missingFields.push("請求額");
    if (extracted.usage === null || extracted.usage === undefined) missingFields.push("使用量");

    ocrNote.textContent =
      missingFields.length > 0
        ? `OCRで自動入力しました。ただし「${missingFields.join("・")}」は読み取れなかったため、内容をご確認・ご入力ください。`
        : "OCRで自動入力しました。内容に間違いがないかご確認ください。";

    updateOverwriteWarning();

    stepUpload.hidden = true;
    stepConfirm.hidden = false;
    runOcrButton.disabled = false;
    ocrStatus.textContent = "";
  }

  backButton.addEventListener("click", () => {
    stepConfirm.hidden = true;
    stepUpload.hidden = false;
  });

  yearMonthInput.addEventListener("change", syncFormWithExistingRecord);

  async function handleSubmit(event) {
    event.preventDefault();
    formError.hidden = true;

    if (!/^\d{4}-\d{2}$/.test(yearMonthInput.value)) {
      formError.textContent = "対象年月を入力してください。";
      formError.hidden = false;
      return;
    }
    if (amountInput.value === "" || Number(amountInput.value) < 0) {
      formError.textContent = "請求額は0以上の数値で入力してください。";
      formError.hidden = false;
      return;
    }

    const newRecord = {
      yearMonth: yearMonthInput.value,
      amount: Number(amountInput.value),
      usage: usageInput.value === "" ? null : Number(usageInput.value),
      memo: memoInput.value.trim(),
      inputMethod: "ocr",
      registeredAt: new Date().toISOString(),
    };

    const updatedRecords = window.CSVLib.upsertRecord(existingRecords, newRecord);
    const csvText = window.CSVLib.stringifyRecords(updatedRecords);
    const isOverwrite = existingRecords.some((r) => r.yearMonth === newRecord.yearMonth);
    const commitMessage = `${isOverwrite ? "更新" : "追加"}: 水道代 ${newRecord.yearMonth}（OCR）`;

    submitButton.disabled = true;
    submitStatus.textContent = "登録処理中...";

    try {
      const result = await window.GitHubAPI.commitCSV(CSV_REPO_PATH, csvText, commitMessage);
      submitStatus.textContent = result.stub
        ? "（確認用）入力内容は正しく処理されました。実際のGitHubへの保存はステップ14で有効になります。"
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

  waterForm.addEventListener("submit", handleSubmit);

  loadExistingRecords();
})();
