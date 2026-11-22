/* ═══════════ 应用壳服务（全路由共享）：主题 / 时钟 / 自选角标 / 滚动感知玻璃 ═══════════
   各页面组件（assets/pages/*.js）按路由懒加载；壳层只负责跨页面共享的顶栏能力。 */
(function () {
  "use strict";

  var LS_SETTINGS = "hs300.settings.v1";
  var FAV_KEY = "hs300.fav.v1";
  var $ = window.Util.$;
  var store = window.Util.store;

  /* 全局错误诊断钩子：任何未捕获异常留档 window.__lastGlobalErr，便于远程排查 */
  window.addEventListener("error", function (ev) {
    window.__lastGlobalErr = { t: Date.now(), msg: ev.message, src: ev.filename && ev.filename.split("/").pop() + ":" + ev.lineno };
    if (window.console) console.warn("[shell] 全局错误:", ev.message);
  });
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev.reason;
    window.__lastGlobalErr = { t: Date.now(), msg: (r && (r.message || String(r))) || "unhandledrejection" };
    if (window.console) console.warn("[shell] 未处理的 Promise 拒绝:", r);
  });

  function readSettings() {
    var st = store.get(LS_SETTINGS, {});
    return st && typeof st === "object" ? st : {};
  }
  function mergeSettings(patch) {
    return store.merge(LS_SETTINGS, patch);
  }

  /* ── 主题（设置页与顶栏按钮共用） ── */
  function applyTheme(t) {
    document.documentElement.classList.toggle("dark", t === "dark");
    var b = $("btnTheme");
    if (b) b.textContent = (t === "dark") ? "☀️" : "🌙";
  }

  /* ── 服务器时钟（北京时间）与开闭市状态 ── */
  function tickClock() {
    var now = new Date();
    var parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(now);
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    var st = $("serverTime");
    if (st) st.textContent = map.year + "-" + map.month + "-" + map.day + " " + map.hour + ":" + map.minute + ":" + map.second;
    var wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(now);
    var mins = (+map.hour) * 60 + (+map.minute);
    var open = wd !== "Sat" && wd !== "Sun" && ((mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900));
    var ms = $("marketStatus");
    if (ms) ms.textContent = open ? "开市" : "休市";
  }

  /* ── 我的自选角标（自选页签未挂载时也能显示数量；引擎保存自选后亦委托此处） ── */
  function refreshFavBadge() {
    var n = 0;
    var faved = store.get(FAV_KEY, {});
    if (faved && typeof faved === "object") n = Object.keys(faved).length;
    var b = $("favBadge");
    if (b) b.textContent = n;
  }

  function init() {
    var st = readSettings();
    if (st.theme === "dark") applyTheme("dark"); else applyTheme("light");
    var b = $("btnTheme");
    if (b) {
      b.addEventListener("click", function () {
        var t = document.documentElement.classList.contains("dark") ? "light" : "dark";
        mergeSettings({ theme: t });
        applyTheme(t);
        document.dispatchEvent(new CustomEvent("hs300:settings", { detail: readSettings() }));
      });
    }
    tickClock();
    setInterval(tickClock, 1000);
    refreshFavBadge();

    /* ── 顶栏滚动感知：滚动后加深玻璃底色，保证下方内容透过时文字对比度 ── */
    var bar = document.querySelector(".topbar");
    if (bar) {
      var ticking = false;
      function update() {
        ticking = false;
        var y = window.scrollY || window.pageYOffset || 0;
        var page = document.querySelector(".page.active");
        if (page) y += page.scrollTop || 0;
        bar.classList.toggle("scrolled", y > 8);
      }
      function queue() {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
      }
      window.addEventListener("scroll", queue, { passive: true });
      document.addEventListener("scroll", function (ev) {
        if (ev.target && ev.target.nodeType === 1 && ev.target.classList && ev.target.classList.contains("page")) queue();
      }, { capture: true, passive: true });
      update();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.Shell = { applyTheme: applyTheme, refreshFavBadge: refreshFavBadge, mergeSettings: mergeSettings, readSettings: readSettings };
})();
