/**
 * Code.gs
 * -----------------------------------------------------------------------
 * 水道代の領収書画像をOCRし、年月・請求額・使用量を抽出して返す
 * Google Apps Script（ウェブアプリ）です。
 *
 * デプロイ方法の概要:
 *   1. https://script.google.com で新しいプロジェクトを作成し、このファイルの
 *      内容を貼り付ける（appsscript.jsonの内容も反映させる）
 *   2. 「サービス」からDrive API（Advanced Drive Service）を有効にする
 *   3. スクリプトプロパティに SHARED_SECRET を設定する
 *      （メニュー: プロジェクトの設定 > スクリプト プロパティ）
 *      → assets/js/config.js の OCR_SHARED_SECRET と同じ値にすること
 *   4. 「デプロイ」>「新しいデプロイ」>「ウェブアプリ」として公開する
 *      - 実行するユーザー: 自分（あなたのGoogleアカウントの権限でDrive APIを使うため）
 *      - アクセスできるユーザー: 全員
 *        （静的サイトから直接叩く都合上、匿名アクセスを許可する必要がある。
 *          これはconfig.jsのコメントにある通り、完全な認証にはならない点に注意）
 *   5. 発行されたウェブアプリのURLを assets/js/config.js の OCR_ENDPOINT_URL に設定する
 * ------------------------------------------------------------------- */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // --- 簡易な合言葉チェック（本格的な認証ではなく、あくまで抑止目的） ---
    const expectedSecret = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET");
    if (!expectedSecret || body.secret !== expectedSecret) {
      return jsonResponse({ success: false, error: "unauthorized" });
    }

    const extracted = extractFieldsFromImage(body.image, body.mimeType || "image/jpeg");
    return jsonResponse({ success: true, extracted: extracted });
  } catch (error) {
    return jsonResponse({ success: false, error: String(error) });
  }
}

/**
 * base64画像からOCRでテキストを取得し、年月・請求額・使用量を抽出します。
 * OCR変換で作った一時ファイルは、テキスト取得後に必ず削除します
 * （ステップ3で決めた「画像やドキュメントをGoogleドライブに残さない」方針）。
 *
 * @param {string} base64Image
 * @param {string} mimeType
 * @returns {{yearMonth: string|null, amount: number|null, usage: number|null}}
 */
function extractFieldsFromImage(base64Image, mimeType) {
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Image), mimeType, "receipt.jpg");

  // Drive APIのOCR変換機能で、画像からテキストを抽出したGoogleドキュメントを作る
  const resource = {
    title: "ocr-temp-" + new Date().getTime(),
    mimeType: MimeType.GOOGLE_DOCS,
  };
  const ocrFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: "ja" });

  let text = "";
  try {
    const doc = DocumentApp.openById(ocrFile.id);
    text = doc.getBody().getText();
  } finally {
    // 成功しても失敗しても、一時ファイルは必ず削除する
    Drive.Files.remove(ocrFile.id);
  }

  return parseReceiptText(text);
}

/**
 * OCRで得たテキストから、年月・請求額・使用量を正規表現で抜き出します。
 *
 * 領収書のフォーマットは水道局によって異なるため、これはあくまで
 * 「よくある表記パターン」に対する簡易的な抽出です。
 * 読み取れなかった項目は null を返し、必ず確認画面で人の目によるチェックを挟みます。
 *
 * @param {string} text
 * @returns {{yearMonth: string|null, amount: number|null, usage: number|null}}
 */
function parseReceiptText(text) {
  let yearMonth = null;
  // 例: "2026年01月" "2026/01" "2026-01" のような表記に対応
  const ymMatch = text.match(/(20\d{2})[年\/\-]\s*(\d{1,2})\s*月?/);
  if (ymMatch) {
    yearMonth = ymMatch[1] + "-" + ("0" + ymMatch[2]).slice(-2);
  }

  let amount = null;
  // 例: "ご請求金額 4,550円" "お支払金額：4550円" のような表記に対応
  const amountMatch = text.match(/(?:ご請求金額|請求金額|お支払[い]?金額|合計金額|合計)[^\d]{0,10}([\d,]+)\s*円/);
  if (amountMatch) {
    amount = Number(amountMatch[1].replace(/,/g, ""));
  }

  let usage = null;
  // 例: "ご使用水量 19.5m3" "使用量：19.5㎥" のような表記に対応
  const usageMatch = text.match(/(?:ご使用水量|使用水量|ご使用量|使用量)[^\d]{0,10}([\d.]+)\s*(?:m3|m³|㎥|立方メートル)/);
  if (usageMatch) {
    usage = Number(usageMatch[1]);
  }

  return { yearMonth: yearMonth, amount: amount, usage: usage };
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
