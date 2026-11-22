/* ═══════════ 页面组件：基金筛选表格（宽基 #/broad · 债基 #/bond · 我的自选 #/fav 共用） ═══════════
   本文件在 assets/app.js（筛选引擎）加载前执行：先注入页面骨架 DOM，
   引擎脚本顶层对 #tbody/#thead/#tableScroll 等元素的捕获才能命中。
   路由切换分组由 window.FundEngine.activateRoute(group) 完成（见 app.js）。 */
(function () {
  "use strict";

  var TEMPLATE =
    '<section class="filter-bar">' +
      '<label class="kw-label" for="kwInput">筛选</label>' +
      '<input id="kwInput" type="text" autocomplete="off" spellcheck="false" placeholder="简称 / 代码 / 经理 / 管理人 / 拼音缩写">' +
      '<div class="meta-line">' +
        '<b class="meta-title" id="metaTitle">宽基 - 沪深300指数基金</b>' +
        '<span class="meta-dim">&nbsp;共 <span id="countTotal">-</span> 只 · 来源：天天基金网</span>' +
        '<span class="mode-chip" id="modeChip"><i class="chip-dot"></i><span id="modeText">检测数据源…</span></span>' +
        '<span class="info-tip" tabindex="0">ⓘ<span class="info-bubble" id="infoBubble"></span></span>' +
        '<a class="clear-filter" id="clearFilter">× 清空筛选</a>' +
        '<span class="meta-filtered" id="filteredNote"></span>' +
      '</div>' +
      '<div class="export-group">' +
        '<button class="btn btn-green" id="btnExportPage">⟋ 导出当前页</button>' +
        '<button class="btn btn-white" id="btnExportExcel">⭳ 导出 Excel</button>' +
      '</div>' +
    '</section>' +
    '<div class="tabs-row">' +
      '<nav class="idx-tabs" id="idxTabs"><!-- 指数子标签由 JS 生成 --></nav>' +
      '<span class="tabs-sep"></span>' +
      '<div class="co-pick" id="coPick">' +
        '<button type="button" class="co-pick-btn" id="coBtn">' +
          '<span class="co-dot cur"></span>公司：全部<span class="caret">▾</span>' +
        '</button>' +
        '<div class="co-pop" id="coPop" hidden>' +
          '<input id="coSearch" type="text" autocomplete="off" spellcheck="false" placeholder="公司名 / 拼音首字母（如 hx、yfd）">' +
          '<div class="co-list" id="coList"></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="cols-bar">' +
      '<button type="button" class="cols-toggle" id="btnCols" title="选择表格显示的列">☰ 列设置 <span class="cols-count" id="colsCount"></span><span class="caret">▾</span></button>' +
      '<span class="cols-hint">表头 ? 可查看指标说明 · 漏斗可按列筛选</span>' +
      '<div class="cols-pop" id="colsPop" hidden>' +
        '<section class="col-checks" id="colChecks"><!-- 分组列勾选由 JS 生成 --></section>' +
      '</div>' +
    '</div>' +
    '<section class="table-wrap" id="tableWrap">' +
      '<div class="table-scroll" id="tableScroll">' +
        '<table class="fund-table" id="fundTable">' +
          '<thead id="thead"><!-- JS --></thead>' +
          '<tbody id="tbody"><!-- JS --></tbody>' +
        '</table>' +
        '<div class="empty-tip" id="emptyTip" hidden>无匹配基金</div>' +
      '</div>' +
    '</section>' +
    '<footer class="page-foot" id="pageFoot">数据来源：天天基金网（fund.eastmoney.com）公开数据 · 实时获取 · 仅用于个人研究筛选，不构成投资建议</footer>';

  /* 先于引擎脚本注入骨架：#tbody 等顶层捕获依赖此 DOM */
  var root = document.createElement("main");
  root.id = "page-broad";
  root.className = "page";
  root.innerHTML = TEMPLATE;
  document.getElementById("app").appendChild(root);

  window.AppPages = window.AppPages || {};
  window.AppPages.fund = {
    mount: function () { /* 骨架已在本脚本加载时注入 */ },
    activate: function (params) {
      var group = (params && params.group) || "broad";
      if (window.FundEngine) window.FundEngine.activateRoute(group);
    },
    deactivate: function () {}
  };
})();
