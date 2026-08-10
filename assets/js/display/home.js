/**
 * home.js
 * -----------------------------------------------------------------------
 * ホーム画面（index.html）の制御を行います。
 *   1. categories.json と各CSVを読み込む
 *   2. サマリーカードを描画する
 *   3. カテゴリ複数選択・期間フィルタのUIを組み立てる
 *   4. lib/aggregate.js で集計し、display/charts.js に渡してグラフを描画する
 *
 * データの取得・集計・描画は、それぞれ csv.js / aggregate.js / charts.js に
 * 責務を委ね、このファイルは「画面の状態管理と橋渡し」に専念します。
 * ------------------------------------------------------------------- */

(function () {
  /** @type {Array<{id:string,label:string,csv:string,unit:string,hasUsage:boolean,color:string,records:Array<Object>}>} */
  let categoryDataList = [];

  /** 現在チェックが入っているカテゴリID（月別推移グラフの選択状態） */
  let selectedIds = [];

  /** 月別推移グラフの現在の期間フィルタ */
  let currentFilter = { type: "preset", preset: "12m" };

  // ===========================================================
  // 初期化
  // ===========================================================

  async function init() {
    // --- ① データ読み込み・サマリーカード（グラフ描画より重要度が高い部分） ---
    try {
      const categories = await window.AppConfig.loadCategories();

      categoryDataList = await Promise.all(
        categories.map(async (category) => {
          const records = await window.CSVLib.fetchRecords(category.csv);
          return { ...category, records };
        })
      );

      selectedIds = categoryDataList.map((c) => c.id); // 初期状態は全カテゴリ選択（総合計）

      renderSummaryCards();
      renderLastUpdated();
    } catch (error) {
      console.error("データの読み込みに失敗しました:", error);
      const container = document.getElementById("summary-cards");
      if (container) {
        container.innerHTML =
          '<p class="form-error">データの読み込みに失敗しました。しばらくしてから再度お試しください。</p>';
      }
      return; // カテゴリ・CSVすら読み込めていない場合は、この先のグラフ処理も意味が無いため中断
    }

    // --- ② グラフ描画（Chart.jsのCDN読み込み失敗など、①とは別の理由で失敗しうる部分） ---
    // ①が成功していれば、こちらが失敗してもサマリーカードの表示は保たれる。
    try {
      setupCategoryCheckboxes();
      setupPeriodFilter();
      renderMonthlyTrendChart();

      setupYearlyTotalControl();
      renderYearlyTotalChart();

      setupYoyControl();
      renderYoyChart();
    } catch (error) {
      console.error("グラフの描画に失敗しました:", error);
      document.querySelectorAll(".chart-panel").forEach((panel) => {
        if (!panel.querySelector(".form-error")) {
          const message = document.createElement("p");
          message.className = "form-error";
          message.textContent = "グラフの描画に失敗しました。しばらくしてから再度お試しください。";
          panel.appendChild(message);
        }
      });
    }
  }

  // ===========================================================
  // サマリーカード・更新日時
  // ===========================================================

  function buildCardElement(label, amount, accentColor) {
    const card = document.createElement("div");
    card.className = "summary-card";
    if (accentColor) card.style.borderLeftColor = accentColor;
    card.innerHTML = `
      <p class="summary-card__label"></p>
      <p class="summary-card__value"></p>
    `;
    card.querySelector(".summary-card__label").textContent = label;
    card.querySelector(".summary-card__value").textContent =
      window.ChartsLib.formatYen(amount);
    return card;
  }

  function renderSummaryCards() {
    const summary = window.Aggregate.getHomeSummary(categoryDataList);
    const container = document.getElementById("summary-cards");
    container.innerHTML = "";

    summary.monthlyCards.forEach((card) => {
      container.appendChild(
        buildCardElement(`今月${card.label}`, card.amount, card.color)
      );
    });
    container.appendChild(buildCardElement("今月合計", summary.monthlyTotal, null));
    container.appendChild(buildCardElement("年間累計", summary.yearlyTotal, null));
  }

  function renderLastUpdated() {
    const iso = window.Aggregate.getLastUpdatedAt(categoryDataList);
    const el = document.getElementById("last-updated");
    if (!iso) {
      el.textContent = "登録されているデータがありません";
      return;
    }
    const date = new Date(iso);
    const formatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    el.textContent = `更新日時: ${formatted}`;
  }

  // ===========================================================
  // カテゴリ複数選択チップ
  // ===========================================================

  function setupCategoryCheckboxes() {
    const container = document.getElementById("category-checkboxes");
    const toggleAllButton = document.getElementById("toggle-all-categories");

    function buildCheckboxes() {
      container.innerHTML = "";
      categoryDataList.forEach((category) => {
        const label = document.createElement("label");
        const isSelected = selectedIds.includes(category.id);
        if (isSelected) label.classList.add("is-selected");

        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = isSelected;
        input.value = category.id;

        input.addEventListener("change", () => {
          // 最低1カテゴリは選択されている状態を保つ（0件だとグラフが描画できないため）
          if (!input.checked && selectedIds.length === 1 && selectedIds[0] === category.id) {
            input.checked = true;
            return;
          }
          if (input.checked) {
            if (!selectedIds.includes(category.id)) selectedIds.push(category.id);
          } else {
            selectedIds = selectedIds.filter((id) => id !== category.id);
          }
          label.classList.toggle("is-selected", input.checked);
          updateToggleAllLabel();
          updateUsageHiddenNote();
          renderMonthlyTrendChart();
        });

        label.appendChild(input);
        label.appendChild(document.createTextNode(category.label));
        container.appendChild(label);
      });
    }

    function updateToggleAllLabel() {
      toggleAllButton.textContent =
        selectedIds.length === categoryDataList.length ? "すべて解除" : "すべて選択";
    }

    function updateUsageHiddenNote() {
      document.getElementById("usage-hidden-note").hidden = selectedIds.length <= 1;
    }

    toggleAllButton.addEventListener("click", () => {
      // 全選択中なら先頭の1件だけ残す（0件にはしない）、そうでなければ全選択にする
      selectedIds =
        selectedIds.length === categoryDataList.length
          ? [categoryDataList[0].id]
          : categoryDataList.map((c) => c.id);
      buildCheckboxes();
      updateToggleAllLabel();
      updateUsageHiddenNote();
      renderMonthlyTrendChart();
    });

    buildCheckboxes();
    updateToggleAllLabel();
    updateUsageHiddenNote();
  }

  // ===========================================================
  // 期間フィルタ（月別推移グラフ用）
  // ===========================================================

  function setupPeriodFilter() {
    const presetButtons = Array.from(document.querySelectorAll(".filter-preset"));
    const yearSelect = document.getElementById("filter-year-select");
    const startSelect = document.getElementById("filter-start-month");
    const endSelect = document.getElementById("filter-end-month");

    // 「年で絞り込み」の選択肢
    window.Aggregate.getAvailableYears(categoryDataList).forEach((year) => {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = `${year}年`;
      yearSelect.appendChild(option);
    });

    // カスタム期間（開始／終了）の選択肢：古い順に並べる
    const yearMonths = window.Aggregate.getAvailableYearMonths(categoryDataList).slice().reverse();
    [startSelect, endSelect].forEach((select) => {
      yearMonths.forEach((ym) => {
        const option = document.createElement("option");
        option.value = ym;
        option.textContent = ym;
        select.appendChild(option);
      });
    });

    function clearOtherControls(except) {
      if (except !== "preset") presetButtons.forEach((b) => b.classList.remove("is-active"));
      if (except !== "year") yearSelect.value = "";
      if (except !== "custom") {
        startSelect.value = "";
        endSelect.value = "";
      }
    }

    presetButtons.forEach((button) => {
      button.addEventListener("click", () => {
        clearOtherControls("preset");
        presetButtons.forEach((b) => b.classList.remove("is-active"));
        button.classList.add("is-active");
        currentFilter = { type: "preset", preset: button.dataset.preset };
        renderMonthlyTrendChart();
      });
    });

    yearSelect.addEventListener("change", () => {
      if (!yearSelect.value) return;
      clearOtherControls("year");
      currentFilter = { type: "year", year: Number(yearSelect.value) };
      renderMonthlyTrendChart();
    });

    function handleCustomRangeChange() {
      if (!startSelect.value || !endSelect.value) return;
      clearOtherControls("custom");
      currentFilter = { type: "custom", start: startSelect.value, end: endSelect.value };
      renderMonthlyTrendChart();
    }
    startSelect.addEventListener("change", handleCustomRangeChange);
    endSelect.addEventListener("change", handleCustomRangeChange);
  }

  function renderMonthlyTrendChart() {
    const series = window.Aggregate.getSelectedMonthlySeries(
      categoryDataList,
      selectedIds,
      currentFilter
    );
    const singleCategory =
      selectedIds.length === 1
        ? categoryDataList.find((c) => c.id === selectedIds[0])
        : null;

    window.ChartsLib.renderMonthlyTrend("monthly-trend-chart", series, {
      color: singleCategory ? singleCategory.color : undefined,
      unit: singleCategory ? singleCategory.unit : undefined,
    });
  }

  // ===========================================================
  // 年間累計グラフ
  // ===========================================================

  function setupYearlyTotalControl() {
    document
      .getElementById("yearly-total-range")
      .addEventListener("change", renderYearlyTotalChart);
  }

  function renderYearlyTotalChart() {
    const rangeValue = document.getElementById("yearly-total-range").value;
    const series = window.Aggregate.getYearlyTotals(
      categoryDataList,
      rangeValue === "all" ? "all" : Number(rangeValue)
    );
    window.ChartsLib.renderYearlyTotal("yearly-total-chart", series);
  }

  // ===========================================================
  // 前年同月比較グラフ
  // ===========================================================

  function setupYoyControl() {
    const select = document.getElementById("yoy-target-month");
    const yearMonths = window.Aggregate.getAvailableYearMonths(categoryDataList); // 新しい順

    yearMonths.forEach((ym) => {
      const option = document.createElement("option");
      option.value = ym;
      option.textContent = ym;
      select.appendChild(option);
    });

    // デフォルトは最新月（今月分がまだ無ければ、データがある中で一番新しい月）
    if (yearMonths.length > 0) select.value = yearMonths[0];

    select.addEventListener("change", renderYoyChart);
  }

  function renderYoyChart() {
    const select = document.getElementById("yoy-target-month");
    if (!select.value) return;
    const comparison = window.Aggregate.getYoYComparison(categoryDataList, select.value);
    window.ChartsLib.renderYoY("yoy-chart", comparison);
  }

  // DOMの準備ができてから開始する
  document.addEventListener("DOMContentLoaded", init);
})();
