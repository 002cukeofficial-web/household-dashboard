/**
 * csv.js
 * -----------------------------------------------------------------------
 * CSVの「文字列」と、画面やロジックで扱いやすい「オブジェクト（Record）」
 * を相互に変換するための関数群です。
 *
 * ステップ5（CSV設計）で決めた列構成に対応しています。
 *   year_month, amount, usage, memo, input_method, registered_at
 *
 * このファイルの責務は「変換」だけです。
 * 合計や平均などの計算は行いません（それは lib/aggregate.js の役割）。
 * GitHubへの実際の読み書き（API呼び出し）も行いません（lib/github-api.js の役割）。
 * ------------------------------------------------------------------- */

window.CSVLib = (function () {
  // CSVの列の並び順。ここを変更すれば全体に反映される。
  const COLUMNS = [
    "year_month",
    "amount",
    "usage",
    "memo",
    "input_method",
    "registered_at",
  ];

  /**
   * CSVのテキストを行×列の2次元配列に分解します。
   * ダブルクォートで囲まれた値（カンマや改行を含む場合）にも対応しています。
   *
   * @param {string} text
   * @returns {string[][]}
   */
  function parseCSVText(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    // 末尾の改行や空行による空配列の混入を避けるため、最後にtrimしてから処理する
    const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    for (let i = 0; i < src.length; i++) {
      const char = src[i];

      if (inQuotes) {
        if (char === '"') {
          if (src[i + 1] === '"') {
            // "" はエスケープされた " 一文字を表す
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }

    // 最終行（末尾に改行がない場合）を拾う
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    // 空行（末尾の改行などで生じる ['']）を除外
    return rows.filter((r) => !(r.length === 1 && r[0] === ""));
  }

  /**
   * 1つの値をCSV用に適切にエスケープします。
   * カンマ・ダブルクォート・改行を含む場合のみダブルクォートで囲みます。
   *
   * @param {string|number|null|undefined} value
   * @returns {string}
   */
  function escapeCSVField(value) {
    const str = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * CSVテキスト（ヘッダー行を含む）を Record の配列に変換します。
   *
   * @param {string} text
   * @returns {Array<Object>} Record配列（ステップ6のRecord型に対応）
   */
  function parseRecords(text) {
    // Excelで保存した際に付与されるBOM(\uFEFF)を取り除く
    const cleanText = text.replace(/^\uFEFF/, "");
    const rows = parseCSVText(cleanText);
    if (rows.length === 0) return [];

    const header = rows[0];
    const dataRows = rows.slice(1);

    return dataRows.map((row) => {
      const raw = {};
      header.forEach((colName, index) => {
        raw[colName] = row[index] !== undefined ? row[index] : "";
      });

      return {
        yearMonth: raw.year_month || "",
        amount: raw.amount === "" ? 0 : Number(raw.amount),
        // 使用量は該当しないカテゴリもあるため、空文字は null として扱う
        usage: raw.usage === "" || raw.usage === undefined ? null : Number(raw.usage),
        memo: raw.memo || "",
        inputMethod: raw.input_method || "manual",
        registeredAt: raw.registered_at || "",
      };
    });
  }

  /**
   * Record の配列を、書き込み用のCSVテキスト（ヘッダー行つき）に変換します。
   * year_month の昇順に並べ替えてから出力するため、呼び出し側で
   * 並び順を気にする必要はありません。
   *
   * Excelで開いても日本語が文字化けしないよう、先頭にBOMを付与します
   * （ステップ5で決めた「UTF-8 with BOM」の方針）。
   *
   * @param {Array<Object>} records
   * @returns {string}
   */
  function stringifyRecords(records) {
    const sorted = [...records].sort((a, b) =>
      a.yearMonth < b.yearMonth ? -1 : a.yearMonth > b.yearMonth ? 1 : 0
    );

    const lines = [COLUMNS.join(",")];

    for (const record of sorted) {
      const row = [
        record.yearMonth,
        record.amount,
        record.usage === null || record.usage === undefined ? "" : record.usage,
        record.memo || "",
        record.inputMethod || "manual",
        record.registeredAt || "",
      ].map(escapeCSVField);
      lines.push(row.join(","));
    }

    const BOM = "\uFEFF";
    return BOM + lines.join("\r\n") + "\r\n";
  }

  /**
   * 新しいRecordを配列に登録します。
   * 同じ year_month が既に存在する場合は「上書き」し、
   * 存在しない場合は新規追加します（ステップ5で決めたルール）。
   *
   * 元の配列は変更せず、新しい配列を返します（副作用を避けるため）。
   *
   * @param {Array<Object>} records
   * @param {Object} newRecord
   * @returns {Array<Object>}
   */
  function upsertRecord(records, newRecord) {
    const existingIndex = records.findIndex(
      (r) => r.yearMonth === newRecord.yearMonth
    );
    const updated = [...records];
    if (existingIndex >= 0) {
      updated[existingIndex] = newRecord;
    } else {
      updated.push(newRecord);
    }
    return updated;
  }

  /**
   * 指定したパスのCSVファイルを取得し、Record配列として返します。
   * 読み込みはGitHub Pagesが公開している静的ファイルへの直接fetchで行うため、
   * 認証やAPI呼び出しは不要です（ステップ2で決めた読み込み経路）。
   *
   * @param {string} path 例: "data/electricity.csv"
   * @returns {Promise<Array<Object>>}
   */
  async function fetchRecords(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`CSVの取得に失敗しました（${path}, status: ${response.status}）`);
    }
    const text = await response.text();
    return parseRecords(text);
  }

  return {
    COLUMNS,
    parseCSVText,
    escapeCSVField,
    parseRecords,
    stringifyRecords,
    upsertRecord,
    fetchRecords,
  };
})();
