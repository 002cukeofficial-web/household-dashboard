/**
 * charts.js
 * -----------------------------------------------------------------------
 * Chart.jsを使って3種類のグラフ（月別推移・年間累計・前年同月比較）を
 * 描画するための関数群です。
 *
 * データの取得・集計は行いません（lib/aggregate.js の役割）。
 * このファイルは「集計済みのデータを受け取って描画するだけ」に責務を絞ります。
 *
 * 同じcanvasに対して再描画する際は、Chart.jsのインスタンスを作り直す前に
 * 必ず古いインスタンスをdestroy()する必要があるため、canvasIdごとに
 * インスタンスを保持しておきます。
 * ------------------------------------------------------------------- */

window.ChartsLib = (function () {
  /** @type {Object<string, Chart>} canvasId をキーにしたChart.jsインスタンス */
  const instances = {};

  /** CSSの --color-accent 変数の値を取得する（JSとCSSで色をずらさないため） */
  function getAccentColor() {
    return getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim() || "#2F6FED";
  }

  /** 金額を「¥12,345」の形式に整形する */
  function formatYen(value) {
    return "¥" + Number(value).toLocaleString("ja-JP");
  }

  /** 既存のグラフがあれば破棄してから、新しいChartインスタンスを登録する共通処理 */
  function renderChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    if (instances[canvasId]) {
      instances[canvasId].destroy();
    }
    instances[canvasId] = new Chart(canvas.getContext("2d"), config);
    return instances[canvasId];
  }

  /**
   * 月別推移グラフ（折れ線）を描画します。
   *
   * @param {string} canvasId
   * @param {Array<{yearMonth:string, amount:number, usage:number|null}>} series
   * @param {{color?: string, unit?: string}} options
   */
  function renderMonthlyTrend(canvasId, series, options) {
    const color = (options && options.color) || getAccentColor();
    // 使用量は「1カテゴリだけ選択しているとき」だけ渡ってくる想定
    // （2カテゴリ以上選択時は aggregate.js 側で usage が null になる）
    const hasUsage = series.length > 0 && series.every((s) => s.usage !== null);

    const datasets = [
      {
        label: "金額（円）",
        data: series.map((s) => s.amount),
        borderColor: color,
        backgroundColor: color,
        yAxisID: "yAmount",
        tension: 0.25,
      },
    ];

    if (hasUsage) {
      datasets.push({
        label: `使用量（${(options && options.unit) || ""}）`,
        data: series.map((s) => s.usage),
        borderColor: "#8A93A3",
        backgroundColor: "#8A93A3",
        borderDash: [4, 3],
        yAxisID: "yUsage",
        tension: 0.25,
      });
    }

    return renderChart(canvasId, {
      type: "line",
      data: { labels: series.map((s) => s.yearMonth), datasets },
      options: {
        responsive: true,
        scales: {
          yAmount: {
            position: "left",
            beginAtZero: true,
            ticks: { callback: (v) => formatYen(v) },
          },
          ...(hasUsage
            ? {
                yUsage: {
                  position: "right",
                  beginAtZero: true,
                  grid: { drawOnChartArea: false },
                },
              }
            : {}),
        },
        plugins: {
          // 常時ラベル表示はせず、ホバー／タップ時のツールチップで正確な値を見せる方針
          tooltip: {
            callbacks: {
              label: (ctx) =>
                ctx.dataset.yAxisID === "yAmount"
                  ? `${ctx.dataset.label}: ${formatYen(ctx.parsed.y)}`
                  : `${ctx.dataset.label}: ${ctx.parsed.y}`,
            },
          },
        },
      },
    });
  }

  /**
   * 年間累計グラフ（棒グラフ）を描画します。
   *
   * @param {string} canvasId
   * @param {Array<{year:number, amount:number}>} series
   */
  function renderYearlyTotal(canvasId, series) {
    const color = getAccentColor();
    return renderChart(canvasId, {
      type: "bar",
      data: {
        labels: series.map((s) => `${s.year}年`),
        datasets: [
          {
            label: "年間累計（円）",
            data: series.map((s) => s.amount),
            backgroundColor: color,
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => formatYen(v) } },
        },
        plugins: {
          tooltip: { callbacks: { label: (ctx) => formatYen(ctx.parsed.y) } },
        },
      },
    });
  }

  /**
   * 前年同月比較グラフ（棒グラフ、2本並び）を描画します。
   *
   * @param {string} canvasId
   * @param {{targetYearMonth:string, previousYearMonth:string, currentAmount:number, previousAmount:number}} comparison
   */
  function renderYoY(canvasId, comparison) {
    const color = getAccentColor();
    return renderChart(canvasId, {
      type: "bar",
      data: {
        labels: [comparison.previousYearMonth, comparison.targetYearMonth],
        datasets: [
          {
            label: "金額（円）",
            data: [comparison.previousAmount, comparison.currentAmount],
            backgroundColor: ["#C7D6F5", color],
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => formatYen(v) } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => formatYen(ctx.parsed.y) } },
        },
      },
    });
  }

  return { renderMonthlyTrend, renderYearlyTotal, renderYoY, formatYen };
})();
