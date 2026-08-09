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
  const CSV_PATH = "../data/water.csv";
  const MAX_IMAGE_DIMENSION = 1600; // 長辺の最大ピクセル数（これ以上は縮小する）
  const JPEG_QUALITY = 0.82;

  // --- STEP A: アップロード ---
  const stepUpload = document.getElementById("step-upload");
  const receiptImageInput = document.getElementById("receipt-image");
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
  // 画像のEXIF向き補正 + 圧縮
  // ===========================================================

  /**
   * JPEGのバイナリからEXIFのOrientation値を読み取ります。
   * 情報が無い・JPEGでない場合は 1（補正不要）を返します。
   * ライブラリを追加せず、必要最小限のタグだけを自前で読み取る実装です。
   *
   * @param {ArrayBuffer} arrayBuffer
   * @returns {number} 1〜8のOrientation値
   */
  function readExifOrientation(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1; // JPEGでない

    let offset = 2;
    while (offset < view.byteLength) {
      const marker = view.getUint16(offset);
      offset += 2;
      if (marker === 0xffe1) {
        // APP1（Exif）セグメント
        const exifStart = offset + 2;
        if (view.getUint32(exifStart + 0) !== 0x45786966) return 1; // "Exif" ではない

        const tiffOffset = exifStart + 6;
        const little = view.getUint16(tiffOffset) === 0x4949; // "II" ならリトルエンディアン
        const firstIfdOffset = view.getUint32(tiffOffset + 4, little);
        const entriesOffset = tiffOffset + firstIfdOffset;
        const entryCount = view.getUint16(entriesOffset, little);

        for (let i = 0; i < entryCount; i++) {
          const entryOffset = entriesOffset + 2 + i * 12;
          const tag = view.getUint16(entryOffset, little);
          if (tag === 0x0112) {
            // Orientationタグ
            return view.getUint16(entryOffset + 8, little);
          }
        }
        return 1;
      } else if ((marker & 0xff00) !== 0xff00) {
        break; // JPEGのマーカーでなくなったら終了
      } else {
        offset += view.getUint16(offset);
      }
    }
    return 1;
  }

  /**
   * Orientation値に応じて、canvasへの描画時の回転・反転を適用します。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} orientation
   * @param {number} width
   * @param {number} height
   */
  function applyOrientationTransform(ctx, orientation, width, height) {
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, height, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, height, width); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, width); break;
      default: break; // 1: 補正不要
    }
  }

  /**
   * 画像ファイルを読み込み、EXIFの向きを補正しつつ、長辺が
   * MAX_IMAGE_DIMENSION を超えないように縮小したJPEGのdata URLを返します。
   *
   * @param {File} file
   * @returns {Promise<string>} "data:image/jpeg;base64,...." 形式の文字列
   */
  function processImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      reader.onload = () => {
        const arrayBuffer = reader.result;
        const orientation = readExifOrientation(arrayBuffer);

        const blobUrl = URL.createObjectURL(new Blob([arrayBuffer]));
        const img = new Image();
        img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);

          // 90度・270度回転の場合は縦横を入れ替える
          const swapDimensions = orientation >= 5 && orientation <= 8;
          const naturalWidth = swapDimensions ? img.height : img.width;
          const naturalHeight = swapDimensions ? img.width : img.height;

          const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(naturalWidth, naturalHeight));
          const outputWidth = Math.round(naturalWidth * scale);
          const outputHeight = Math.round(naturalHeight * scale);

          const canvas = document.createElement("canvas");
          canvas.width = outputWidth;
          canvas.height = outputHeight;
          const ctx = canvas.getContext("2d");

          ctx.save();
          // 補正の回転はスケール前の実寸に対して行い、その後まとめて縮小して描画する
          const drawScale = scale;
          ctx.scale(drawScale, drawScale);
          applyOrientationTransform(ctx, orientation, img.width, img.height);
          ctx.drawImage(img, 0, 0);
          ctx.restore();

          resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
        };
        img.src = blobUrl;
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // ===========================================================
  // STEP A: 画像選択・OCR実行
  // ===========================================================

  receiptImageInput.addEventListener("change", async () => {
    uploadError.hidden = true;
    runOcrButton.disabled = true;
    processedImageBase64 = null;

    const file = receiptImageInput.files[0];
    if (!file) return;

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
      uploadError.textContent =
        "OCRの読み取りに失敗しました。電波状況をご確認のうえ、再度お試しいただくか、手入力に切り替えてください。";
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
      existingRecords = await window.CSVLib.fetchRecords(CSV_PATH);
    } catch (error) {
      console.warn("既存データの取得に失敗しました（初回登録の場合は正常です）:", error);
      existingRecords = [];
    }
  }

  function updateOverwriteWarning() {
    const exists = existingRecords.some((r) => r.yearMonth === yearMonthInput.value);
    overwriteWarning.hidden = !exists;
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

  yearMonthInput.addEventListener("change", updateOverwriteWarning);

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
      const result = await window.GitHubAPI.commitCSV(CSV_PATH, csvText, commitMessage);
      submitStatus.textContent = result.stub
        ? "（確認用）入力内容は正しく処理されました。実際のGitHubへの保存はステップ14で有効になります。"
        : "登録しました。";
      existingRecords = updatedRecords;
      updateOverwriteWarning();
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
