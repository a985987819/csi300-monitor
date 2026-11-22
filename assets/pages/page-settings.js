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
      dark.addEventListener("change", function () {
        var t = dark.checked ? "dark" : "light";
        persist({ theme: t });
        if (window.Shell) window.Shell.applyTheme(t);
      });
    },
    activate: function () {},
    deactivate: function () {}
  };
})();
