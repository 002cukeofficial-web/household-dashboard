/**
 * nav.js
 * -----------------------------------------------------------------------
 * ヘッダーのナビゲーション（.site-nav）に、electricity・water以外の
 * カテゴリへの登録リンクを categories.json から自動的に追加します。
 *
 * 電気代・水道代は専用の登録画面（register/electricity.html, water.html）を
 * 持つため、そのリンクはこれまで通りHTMLに静的に書かれたままにしておき、
 * それ以外の新しいカテゴリだけをこのスクリプトが動的に追加します。
 * これにより、手入力タイプの新規カテゴリを追加してもナビの手動編集が不要になります。
 * ------------------------------------------------------------------- */

(async function () {
  const nav = document.querySelector(".site-nav");
  if (!nav || !window.AppConfig) return;

  // すでに静的に用意されている専用ページのカテゴリID
  const STATIC_CATEGORY_IDS = ["electricity", "water"];

  try {
    const categories = await window.AppConfig.loadCategories();

    // 既存の「電気代登録」リンクのhrefから、現在のページが
    // ルート（index.html）側なのか register/ 配下なのかを判定する。
    // 例: href="register/electricity.html" → registerBase = "register/"
    //     href="electricity.html"          → registerBase = ""
    const anchors = Array.from(nav.querySelectorAll("a"));
    const electricityLink = anchors.find((a) => a.getAttribute("href").endsWith("electricity.html"));
    if (!electricityLink) return; // 想定外のページ構成の場合は何もしない
    const registerBase = electricityLink.getAttribute("href").replace(/electricity\.html$/, "");

    categories
      .filter((c) => !STATIC_CATEGORY_IDS.includes(c.id))
      .forEach((category) => {
        const link = document.createElement("a");
        link.href = `${registerBase}manual.html?category=${encodeURIComponent(category.id)}`;
        link.textContent = `${category.label}登録`;

        // 今まさにこのカテゴリの登録画面を開いている場合はハイライトする
        const params = new URLSearchParams(window.location.search);
        if (window.location.pathname.endsWith("manual.html") && params.get("category") === category.id) {
          link.classList.add("is-active");
        }

        nav.appendChild(link);
      });
  } catch (error) {
    // ナビの拡張に失敗しても、既存の固定リンクは表示され続けるため、
    // ページ全体を壊さないようログだけ出して静かに諦める
    console.warn("ナビゲーションの動的生成に失敗しました:", error);
  }
})();
