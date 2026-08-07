/**
 * aggregate.js
 * -----------------------------------------------------------------------
 * CSVから読み込んだ Record 配列を、画面が直接使える形（集計済みの値）に
 * 変換するための関数群です（ステップ6・7で設計したデータモデルに対応）。
 *
 * home.js や charts.js は、ここにある関数を呼び出すだけで済むようにし、
 * 合計・絞り込みなどの計算ロジックをこのファイルに集約します。
 * こうしておくことで、将来「年度の区切りを変えたい」等の仕様変更があっても
 * このファイルだけを直せば全画面に反映されます。
 * ------------------------------------------------------------------- */

window.Aggregate = (function () {
  // ===========================================================
  // 内部ユーティリティ（年月の計算まわり）
  // ===========================================================

  /** 今日の日付から "YYYY-MM" 形式の文字列を作る */
  function currentYearMonth() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  /** "YYYY-MM" を deltaMonths ヶ月分ずらした "YYYY-MM" を返す（負数で過去へ） */
  function shiftYearMonth(yearMonth, deltaMonths) {
    const [y, m] = yearMonth.split("-").map(Number);
    const date = new Date(y, m - 1 + deltaMonths, 1);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, "0");
    return `${ny}-${nm}`;
  }

  /** "YYYY-MM" から前年同月の "YYYY-MM" を返す */
  function previousYearSameMonth(yearMonth) {
    return shiftYearMonth(yearMonth, -12);
  }

  // ===========================================================
  // 期間フィルタ（ステップ7で設計した filter オブジェクトの解釈）
  //   { type: 'preset', preset: '6m' | '12m' | 'this-year' | 'all' }
  //   { type: 'year', year: 2026 }
  //   { type: 'custom', start: 'YYYY-MM', end: 'YYYY-MM' }
  // ===========================================================

  /**
   * filter条件に応じて、対象となる year_month の範囲 [start, end] を返します。
   * "all" や範囲外は null を返し、呼び出し側で「絞り込みなし」として扱います。
   *
   * @param {Object} filter
   * @returns {{start: string, end: string} | null}
   */
  function resolveFilterRange(filter) {
    if (!filter || filter.type === "preset") {
      const preset = filter ? filter.preset : "12m";
      const nowYM = currentYearMonth();

      if (preset === "all") return null;
      if (preset === "this-year") {
        const year = nowYM.slice(0, 4);
        return { start: `${year}-01`, end: `${year}-12` };
      }
      const months = preset === "6m" ? 6 : 12; // デフォルトは12ヶ月
      return { start: shiftYearMonth(nowYM, -(months - 1)), end: nowYM };
    }

    if (filter.type === "year") {
      return { start: `${filter.year}-01`, end: `${filter.year}-12` };
    }

    if (filter.type === "custom") {
      return { start: filter.start, end: filter.end };
    }

    return null;
  }

  /** records から、指定範囲（両端含む）に入るものだけを抽出する */
  function filterByRange(records, range) {
    if (!range) return records;
    return records.filter(
      (r) => r.yearMonth >= range.start && r.yearMonth <= range.end
    );
  }

  // ===========================================================
  // 単一カテゴリ向けの集計
  // ===========================================================

  /**
   * 最新月のRecordを返します（records が year_month 昇順であることが前提）。
   * @param {{records: Array<Object>}} categoryData
   */
  function getLatestRecord(categoryData) {
    const records = categoryData.records;
    return records.length > 0 ? records[records.length - 1] : null;
  }

  /**
   * 指定した年の年間累計金額を返します。
   * @param {{records: Array<Object>}} categoryData
   * @param {number|string} year
   */
  function getYearTotal(categoryData, year) {
    const prefix = `${year}-`;
    return categoryData.records
      .filter((r) => r.yearMonth.startsWith(prefix))
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * 指定した年月の「前年同月」のRecordを返します（無ければnull）。
   * @param {{records: Array<Object>}} categoryData
   * @param {string} yearMonth "YYYY-MM"
   */
  function getSameMonthLastYear(categoryData, yearMonth) {
    const targetYM = previousYearSameMonth(yearMonth);
    return categoryData.records.find((r) => r.yearMonth === targetYM) || null;
  }

  /**
   * 単一カテゴリの月別推移データ（期間フィルタ適用済み）を返します。
   * 使用量（usage）も含めて返すので、1カテゴリだけ選択時の表示に使います。
   *
   * @param {{records: Array<Object>}} categoryData
   * @param {Object} filter
   * @returns {Array<{yearMonth: string, amount: number, usage: number|null}>}
   */
  function getMonthlySeries(categoryData, filter) {
    const range = resolveFilterRange(filter);
    return filterByRange(categoryData.records, range).map((r) => ({
      yearMonth: r.yearMonth,
      amount: r.amount,
      usage: r.usage,
    }));
  }

  // ===========================================================
  // 複数カテゴリ横断の集計
  // ===========================================================

  /**
   * 選択されたカテゴリの月別推移を返します。
   * - 選択が1件のときは、そのカテゴリの usage も含めて返す（単体表示）
   * - 選択が2件以上のときは、金額のみを合算して返す（使用量は単位が
   *   異なるため合算できないという、ステップ7の修正で決めたルール）
   *
   * @param {Array<{id:string, records: Array<Object>}>} categoryDataList
   * @param {string[]} selectedIds
   * @param {Object} filter
   * @returns {Array<{yearMonth: string, amount: number, usage: number|null}>}
   */
  function getSelectedMonthlySeries(categoryDataList, selectedIds, filter) {
    const selected = categoryDataList.filter((c) => selectedIds.includes(c.id));

    if (selected.length === 1) {
      return getMonthlySeries(selected[0], filter);
    }

    const range = resolveFilterRange(filter);

    // 月ごとの合計金額をMapに集計する（該当月が存在しないカテゴリは0として扱う）
    const totalsByMonth = new Map();
    for (const categoryData of selected) {
      const records = filterByRange(categoryData.records, range);
      for (const r of records) {
        totalsByMonth.set(r.yearMonth, (totalsByMonth.get(r.yearMonth) || 0) + r.amount);
      }
    }

    return Array.from(totalsByMonth.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([yearMonth, amount]) => ({ yearMonth, amount, usage: null }));
  }

  /**
   * 全カテゴリの中で最も新しい登録日時（registered_at）を返します。
   * ホーム画面の「更新日時」表示に使います。
   *
   * @param {Array<{records: Array<Object>}>} categoryDataList
   * @returns {string} ISO8601文字列（データが無ければ空文字）
   */
  function getLastUpdatedAt(categoryDataList) {
    let latest = "";
    for (const categoryData of categoryDataList) {
      for (const r of categoryData.records) {
        if (r.registeredAt > latest) latest = r.registeredAt;
      }
    }
    return latest;
  }

  /**
   * ホーム画面のサマリーカードに必要な値をまとめて生成します。
   * home.js はこの戻り値をそのまま描画するだけで済みます。
   *
   * @param {Array<{id:string, label:string, color:string, records: Array<Object>}>} categoryDataList
   * @returns {{
   *   monthlyCards: Array<{id:string, label:string, amount:number, color:string}>,
   *   monthlyTotal: number,
   *   yearlyTotal: number,
   *   lastUpdatedAt: string
   * }}
   */
  function getHomeSummary(categoryDataList) {
    const currentYear = currentYearMonth().slice(0, 4);

    const monthlyCards = categoryDataList.map((categoryData) => {
      const latest = getLatestRecord(categoryData);
      return {
        id: categoryData.id,
        label: categoryData.label,
        amount: latest ? latest.amount : 0,
        color: categoryData.color,
      };
    });

    // 「今月合計」は、各カテゴリの最新登録月の金額を単純合算する。
    // カテゴリごとに最新の登録月がずれる場合がある（例:電気は今月分登録済み、
    // 水道はまだ先月分のまま）ことを踏まえた割り切った定義であることに注意。
    const monthlyTotal = monthlyCards.reduce((sum, c) => sum + c.amount, 0);

    const yearlyTotal = categoryDataList.reduce(
      (sum, categoryData) => sum + getYearTotal(categoryData, currentYear),
      0
    );

    return {
      monthlyCards,
      monthlyTotal,
      yearlyTotal,
      lastUpdatedAt: getLastUpdatedAt(categoryDataList),
    };
  }

  /**
   * 全カテゴリを横断した「年ごとの合計金額」を返します（年間累計グラフ用）。
   * データに存在する年のうち、新しい方から yearsCount 件だけ返します。
   *
   * @param {Array<{records: Array<Object>}>} categoryDataList
   * @param {number|'all'} yearsCount 表示する年数。'all'なら全期間
   * @returns {Array<{year: number, amount: number}>} 古い年→新しい年の順
   */
  function getYearlyTotals(categoryDataList, yearsCount) {
    const years = getAvailableYears(categoryDataList); // 新しい順で返ってくる
    const targetYears =
      yearsCount === "all" ? years : years.slice(0, Number(yearsCount));

    return targetYears
      .slice() // 破壊的操作を避けるためコピー
      .sort((a, b) => a - b) // グラフは古い年→新しい年の順に並べたい
      .map((year) => ({
        year,
        amount: categoryDataList.reduce(
          (sum, categoryData) => sum + getYearTotal(categoryData, year),
          0
        ),
      }));
  }

  /**
   * 全カテゴリを横断した、対象月とその前年同月の金額を比較します（前年同月比較グラフ用）。
   *
   * @param {Array<{records: Array<Object>}>} categoryDataList
   * @param {string} targetYearMonth "YYYY-MM"
   * @returns {{
   *   targetYearMonth: string,
   *   previousYearMonth: string,
   *   currentAmount: number,
   *   previousAmount: number
   * }}
   */
  function getYoYComparison(categoryDataList, targetYearMonth) {
    const previousYearMonth = previousYearSameMonth(targetYearMonth);

    const sumAt = (yearMonth) =>
      categoryDataList.reduce((sum, categoryData) => {
        const record = categoryData.records.find((r) => r.yearMonth === yearMonth);
        return sum + (record ? record.amount : 0);
      }, 0);

    return {
      targetYearMonth,
      previousYearMonth,
      currentAmount: sumAt(targetYearMonth),
      previousAmount: sumAt(previousYearMonth),
    };
  }

  /**
   * 全カテゴリを横断して、データが存在する year_month の一覧を新しい順で返します。
   * 前年同月比較の「対象月」プルダウンの選択肢生成に使います。
   *
   * @param {Array<{records: Array<Object>}>} categoryDataList
   * @returns {string[]}
   */
  function getAvailableYearMonths(categoryDataList) {
    const set = new Set();
    for (const categoryData of categoryDataList) {
      for (const r of categoryData.records) set.add(r.yearMonth);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }

  /**
   * CSVに実際に存在する年の一覧（新しい順）を返します。
   * 期間フィルタの「年で絞り込み」プルダウンの選択肢生成に使います。
   *
   * @param {Array<{records: Array<Object>}>} categoryDataList
   * @returns {number[]}
   */
  function getAvailableYears(categoryDataList) {
    const years = new Set();
    for (const categoryData of categoryDataList) {
      for (const r of categoryData.records) {
        years.add(Number(r.yearMonth.slice(0, 4)));
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }

  return {
    currentYearMonth,
    shiftYearMonth,
    previousYearSameMonth,
    resolveFilterRange,
    getLatestRecord,
    getYearTotal,
    getSameMonthLastYear,
    getMonthlySeries,
    getSelectedMonthlySeries,
    getLastUpdatedAt,
    getHomeSummary,
    getAvailableYears,
    getYearlyTotals,
    getYoYComparison,
    getAvailableYearMonths,
  };
})();
