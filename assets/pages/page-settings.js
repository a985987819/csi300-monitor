/* ═══════════ 页面组件：设置（#/settings） ═══════════
   输入绑定与持久化在本组件；引擎（app.js）监听 hs300:settings 事件刷新渲染，
   主题通过 Shell.applyTheme 应用（assets/core/shell.js）。 */
(function () {
  "use strict";

  var TEMPLATE =
    '<div class="stub-card settings-card">' +
      '<h2>设置</h2>' +
      '<label class="setting-row"><input type="checkbox" id="optDark"> 深色模式（默认浅色）</label>' +
      '<label class="setting-row"><input type="checkbox" id="optDense"> 紧凑行高（表格行高 26px）</label>' +
      '<label class="setting-row"><input type="checkbox" id="optColor"> 涨跌着色（正红负绿，A股口径）</label>' +
      '<label class="setting-row"><input type="checkbox" id="optGood"> 指标优选高亮（绿色 = 达到市场通用优秀标准，如夏普≥1、回撤≤10%）</label>' +
      '<label class="setting-row"><input type="checkbox" id="optCache"> 使用本地缓存（1 个月同步期内直接读取，不重新请求）</label>' +
      '<div class="settings-group">' +
        '<h3>数据获取管理</h3>' +
        '<div class="setting-row-inline">' +
          '<label class="setting-row" for="optPace">获取节奏（两次请求最小间隔）</label>' +
          '<select id="optPace">' +
            '<option value="110">较快 · 110ms</option>' +
            '<option value="140">标准 · 140ms</option>' +
            '<option value="220">保守 · 220ms</option>' +
            '<option value="400">极保守 · 400ms</option>' +
          '</select>' +
        '</div>' +
        '<p class="stub-dim">节奏越保守越不容易触发接口限流；修改立即对后续请求生效。</p>' +
        '<div class="settings-btns">' +
          '<button type="button" class="btn btn-green" id="mgRefresh">⟳ 强制刷新数据（跳过缓存）</button>' +
          '<button type="button" class="btn btn-ghost" id="mgPause">⏸ 暂停获取</button>' +
          '<button type="button" class="btn btn-white" id="mgClear">清空本地数据缓存</button>' +
        '</div>' +
        '<p class="stub-dim" id="mgStatus">—</p>' +
      '</div>' +
      '<p class="stub-dim">设置会自动保存到本地浏览器。数据通过 server.py 中继实时调用天天基金公开接口。</p>' +
    '</div>';

  var $ = window.Util.$;

  window.AppPages = window.AppPages || {};
  window.AppPages.settings = {
    mount: function (root) {
      root.innerHTML = TEMPLATE;
      var st = (window.Shell && window.Shell.readSettings()) || {};
      var dark = $("optDark"), dense = $("optDense"), colorize = $("optColor"),
          good = $("optGood"), useCache = $("optCache");
      dark.checked = st.theme === "dark";
      dense.checked = !!st.dense;
      colorize.checked = !!st.colorize;
      good.checked = st.good === undefined ? true : !!st.good;
      useCache.checked = st.useCache === undefined ? true : !!st.useCache;

      function persist(patch) {
        var s = (window.Shell && window.Shell.mergeSettings(patch)) || {};
        document.dispatchEvent(new CustomEvent("hs300:settings", { detail: s }));
      }
      dense.addEventListener("change", function () {
        persist({ dense: dense.checked });
      });
      colorize.addEventListener("change", function () {
        persist({ colorize: colorize.checked });
      });
      good.addEventListener("change", function () {
        persist({ good: good.checked });
      });
      useCache.addEventListener("change", function () {
        persist({ useCache: useCache.checked });
      });

      /* ── 数据获取管理（按钮移入设置页；操作经 FundEngine 桥） ── */
      var paceSel = $("optPace");
      var paceSt = (window.Shell && window.Shell.readSettings()) || {};
      paceSel.value = String(paceSt.paceMs === undefined ? 140 : paceSt.paceMs);
      if (window.FundEngine) paceSel.value = String(window.FundEngine.getPaceMs());
      paceSel.addEventListener("change", function () {
        var ms = parseInt(paceSel.value, 10) || 140;
        persist({ paceMs: ms });
        if (window.FundEngine) window.FundEngine.setPaceMs(ms);
        mgStatus("获取节奏已调整为 " + (window.FundEngine ? window.FundEngine.getPaceMs() : ms) + "ms" + (window.FundEngine ? "" : "（引擎加载后生效）"));
      });
      function mgStatus(t) { $("mgStatus").textContent = t; }
      function engineReady() {
        if (window.FundEngine) return true;
        mgStatus("数据引擎尚未加载：先访问一次「宽基 / 债基 / 我的自选」任一页签后再使用此处按钮。");
        return false;
      }
      $("mgRefresh").addEventListener("click", function () {
        if (!engineReady()) return;
        var ok = window.FundEngine.refreshForce();
        mgStatus(ok ? "已跳过缓存，正在重新拉取「" + window.FundEngine.activeLabel() + "」数据…" : "当前无正在展示的数据页。");
      });
      $("mgPause").addEventListener("click", function () {
        if (!engineReady()) return;
        if (!window.FundEngine.isLoading()) { mgStatus("当前没有进行中的获取任务（仅在数据加载时可暂停）。"); return; }
        var toPause = !window.FundEngine.isPaused();
        window.FundEngine.setPaused(toPause);
        this.textContent = toPause ? "▶ 继续获取" : "⏸ 暂停获取";
        mgStatus(toPause ? "已暂停：请求在队列中挂起，点「继续获取」恢复。" : "已恢复获取。");
      });
      $("mgClear").addEventListener("click", function () {
        if (!engineReady()) return;
        window.FundEngine.clearCacheAll();
        mgStatus("本地数据缓存已清空（主题与显示设置保留）。如需最新数据请再点「强制刷新」。");
      });
      function syncPauseBtn() {
        if (!window.FundEngine) return;
        var p = window.FundEngine.isPaused();
        $("mgPause").textContent = p ? "▶ 继续获取" : "⏸ 暂停获取";
      }
      document.addEventListener("hs300:settings", syncPauseBtn);
      syncPauseBtn();
      dark.addEventListener("change", function () {
        var t = dark.checked ? "dark" : "light";
        persist({ theme: t });
        if (window.Shell) window.Shell.applyTheme(t);
      });
    },
    activate: function () {
      if (window.FundEngine) {
        var paceSel = $("optPace");
        if (paceSel) paceSel.value = String(window.FundEngine.getPaceMs());
        var p = window.FundEngine.isPaused();
        var pb = $("mgPause");
        if (pb) pb.textContent = p ? "▶ 继续获取" : "⏸ 暂停获取";
      }
    },
    deactivate: function () {}
  };
})();
