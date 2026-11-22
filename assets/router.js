/* ═══════════ Hash 路由：每个 tab 一个独立页面组件，各自导航到不同路由 ═══════════
   路由表：#/broad 宽基 · #/bond 债基 · #/fav 我的自选 · #/market 市场 · #/learn 学习 · #/settings 设置
   页面组件通过 window.AppPages.<id> = { mount(root), activate(params), deactivate() } 注册；
   chunk 脚本按需懒加载（首次访问才拉取），已挂载的页面在 DOM 中保留（切回时状态不丢）。 */
(function () {
  "use strict";

  var ROUTES = {
    broad:    { nav: "broad",    title: "宽基",     page: "fund",     rootId: "page-broad",
                scripts: ["assets/pages/page-fundtable.js", "assets/app.js"], params: { group: "broad" } },
    bond:     { nav: "bond",     title: "债基",     page: "fund",     rootId: "page-broad",
                scripts: ["assets/pages/page-fundtable.js", "assets/app.js"], params: { group: "bond" } },
    fav:      { nav: "fav",      title: "我的自选", page: "fund",     rootId: "page-broad",
                scripts: ["assets/pages/page-fundtable.js", "assets/app.js"], params: { group: "fav" } },
    market:   { nav: "market",   title: "市场",     page: "market",   rootId: "page-market",
                scripts: ["assets/pages/page-market.js"], params: {} },
    learn:    { nav: "learn",    title: "学习",     page: "learn",    rootId: "page-learn",
                scripts: ["assets/learn-data.js", "assets/pages/page-learn.js"], params: {} },
    settings: { nav: "settings", title: "设置",     page: "settings", rootId: "page-settings",
                scripts: ["assets/pages/page-settings.js"], params: {} },
  };
  var DEFAULT_ROUTE = "broad";

  window.AppPages = window.AppPages || {};

  var appEl = null;
  var currentId = null;
  var routeGen = 0;          /* 路由代际：chunk 加载期间的并发切换作废旧路由 */
  var chunkCache = {};       /* src -> Promise */
  /* 会话级缓存穿透：每次整页加载用新查询串拉取 chunk，
     避免部署后 10 分钟窗口内浏览器回放旧组件（Pages max-age=600） */
  var SESS = "s=" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function loadScript(src) {
    if (chunkCache[src]) return chunkCache[src];
    var url = src + (src.indexOf("?") >= 0 ? "&" : "?") + SESS;
    chunkCache[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        delete chunkCache[src];   /* 允许重试 */
        reject(new Error("脚本加载失败：" + src));
      };
      document.head.appendChild(s);
    });
    return chunkCache[src];
  }
  function loadScripts(list) {
    var p = Promise.resolve();
    list.forEach(function (src) {
      p = p.then(function () { return loadScript(src); });
    });
    return p;
  }

  function parseHash() {
    var h = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
    return ROUTES[h] ? h : DEFAULT_ROUTE;
  }

  function showShellError(msg) {
    appEl.innerHTML = "";
    var d = document.createElement("main");
    d.className = "page active";
    d.innerHTML = '<div class="stub-card" style="margin:60px auto;max-width:520px">' +
      "<h2>页面加载失败</h2><p class='stub-dim'>" + msg + "</p>" +
      '<p style="margin-top:14px"><button class="btn btn-green" id="routeRetry">⟳ 重试</button></p></div>';
    appEl.appendChild(d);
    d.querySelector("#routeRetry").addEventListener("click", function () {
      route(true);
    });
  }

  /* 激活目标路由：懒加载 chunk → 挂载 → activate；期间旧路由作废 */
  function route(force) {
    var id = parseHash();
    if (id === currentId && !force) return;
    var gen = ++routeGen;
    var r = ROUTES[id];
    currentId = id;
    /* 导航高亮即时反馈（chunk 加载前），体感上先切 tab 再等内容 */
    document.querySelectorAll(".nav-pill").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === r.nav);
    });
    document.title = "流通基金概览 · " + r.title;

    loadScripts(r.scripts).then(function () {
      if (gen !== routeGen) return;   /* 期间用户已切走 */
      var root = document.getElementById(r.rootId);
      var mod = window.AppPages[r.page];
      if (!root) {
        root = document.createElement("main");
        root.id = r.rootId;
        root.className = "page";
        appEl.appendChild(root);
      }
      if (mod && !mod._mounted) {
        mod._mounted = true;
        mod.mount(root);
      }
      /* 隐藏其它已挂载页面，显示当前页 */
      document.querySelectorAll("#app > .page").forEach(function (p) {
        p.classList.toggle("active", p === root);
      });
      if (mod && mod.activate) mod.activate(r.params || {});
    }).catch(function (e) {
      if (gen !== routeGen) return;
      showShellError((e && e.message) || String(e));
    });
  }

  function init() {
    appEl = document.getElementById("app");
    /* 顶部导航：点击只改 hash，路由统一处理 */
    document.getElementById("topnav").addEventListener("click", function (ev) {
      var btn = ev.target.closest(".nav-pill");
      if (!btn) return;
      var tab = btn.getAttribute("data-tab");
      if (!ROUTES[tab]) return;
      if (parseHash() === tab) route(true);   /* 同页重复点击 = 强制重路由 */
      else location.hash = "#/" + tab;
    });
    window.addEventListener("hashchange", function () { route(false); });
    /* 空路由 / 未知路由归一到默认页（replace 避免多余历史记录） */
    if (!location.hash || !ROUTES[(location.hash || "").replace(/^#\/?/, "").split("?")[0]]) {
      location.replace("#/" + DEFAULT_ROUTE);
    }
    route(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AppRouter = { go: function (id) { if (ROUTES[id]) location.hash = "#/" + id; }, route: route };
})();
