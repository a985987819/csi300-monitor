/* ═══════════ 指标百科 · 学习模块（行模式：hover高亮+阴影，点击展开详情） ═══════════ */
(function () {
  "use strict";

  var activeCat = "stock";
  var searchTerm = "";
  var openSet = {};            /* 已展开的指标名集合（按分类记忆） */
  var LEARN_DATA = window.LEARN_DATA || { stock: [], fund: [], bond: [] };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ── SVG 图示生成器 ── */
  var DG_W = 200, DG_H = 72;
  function dgSvg(inner, w, h) {
    return '<svg viewBox="0 0 ' + (w || DG_W) + ' ' + (h || DG_H) + '" class="learn-dg">' + (inner || "") + "</svg>";
  }
  function dgKline() {
    var s = "";
    var candles = [
      { o: 40, c: 30, h: 24, l: 48 }, { o: 30, c: 22, h: 18, l: 34 }, { o: 22, c: 28, h: 16, l: 32 },
      { o: 28, c: 20, h: 15, l: 36 }, { o: 20, c: 30, h: 14, l: 34 }, { o: 30, c: 26, h: 18, l: 40 },
      { o: 26, c: 18, h: 12, l: 30 }, { o: 18, c: 25, h: 10, l: 28 }, { o: 25, c: 32, h: 14, l: 38 },
    ];
    var bw = DG_W / candles.length;
    candles.forEach(function (k, i) {
      var up = k.c < k.o;
      var col = up ? "#e05a5a" : "#1fa363";
      var x = i * bw + bw / 2;
      var top = Math.min(k.o, k.c), bot = Math.max(k.o, k.c);
      s += '<line x1="' + (x + bw * 0.15).toFixed(1) + '" y1="' + k.h + '" x2="' + (x + bw * 0.15).toFixed(1) + '" y2="' + k.l + '" stroke="' + col + '" stroke-width="1"/>';
      s += '<rect x="' + (x + bw * 0.1).toFixed(1) + '" y="' + top + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + (bot - top).toFixed(1) + '" fill="' + col + '" rx="1"/>';
    });
    return dgSvg(s, DG_W, DG_H);
  }
  function dgBar() {
    var s = "";
    var bars = [40, 65, 30, 80, 55, 72, 45, 90, 60, 75, 50, 85];
    bars.forEach(function (h, i) {
      var x = i * (DG_W / bars.length) + 2;
      var col = h > 60 ? "#e05a5a" : "#57c48c";
      s += '<rect x="' + x.toFixed(1) + '" y="' + (DG_H - h * 0.7) + '" width="' + (DG_W / bars.length - 3).toFixed(1) + '" height="' + (h * 0.7) + '" fill="' + col + '" rx="2" opacity="0.8"/>';
    });
    return dgSvg(s);
  }
  function dgOscillator() {
    var pts = "";
    var vals = [50, 35, 25, 30, 45, 62, 75, 68, 55, 48, 38, 28, 22, 30, 42, 55, 68, 72, 60, 48];
    vals.forEach(function (v, i) {
      var x = i * (DG_W / (vals.length - 1));
      var y = DG_H * (1 - v / 100) * 0.9 + 3;
      pts += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    });
    return dgSvg('<line x1="0" y1="' + DG_H * 0.1 + '" x2="' + DG_W + '" y2="' + DG_H * 0.1 + '" stroke="#d8434a" stroke-dasharray="3 3" opacity="0.5"/>' +
      '<line x1="0" y1="' + DG_H * 0.7 + '" x2="' + DG_W + '" y2="' + DG_H * 0.7 + '" stroke="#1fa363" stroke-dasharray="3 3" opacity="0.5"/>' +
      '<path d="' + pts + '" fill="none" stroke="#5C6BC0" stroke-width="1.8"/>' +
      '<text x="3" y="' + (DG_H * 0.1 + 4) + '" font-size="9" fill="#d8434a">70</text>' +
      '<text x="3" y="' + (DG_H * 0.7 + 4) + '" font-size="9" fill="#1fa363">30</text>');
  }
  function dgBand() {
    var up = "0,18 30,14 60,16 90,10 120,12 150,8 180,10 200,6";
    var lo = "0,58 30,54 60,56 90,50 120,52 150,48 180,50 200,46";
    var mid = "0,38 30,34 60,36 90,30 120,32 150,28 180,30 200,26";
    return dgSvg('<polyline points="' + up + '" fill="none" stroke="#5C6BC0" stroke-width="1" stroke-dasharray="4 2"/>' +
      '<polyline points="' + mid + '" fill="none" stroke="#0d9488" stroke-width="1.5"/>' +
      '<polyline points="' + lo + '" fill="none" stroke="#5C6BC0" stroke-width="1" stroke-dasharray="4 2"/>' +
      '<polygon points="' + up + " " + lo.split(" ").reverse().join(" ") + '" fill="#0d9488" opacity="0.08"/>');
  }
  function dgGauge() {
    var score = 26;
    var zones = [
      [0, 30, "#1fa363"], [30, 45, "#8bc48c"], [45, 60, "#c9cfda"], [60, 80, "#ec7d7d"], [80, 100, "#a51c1c"],
    ];
    var s = "";
    zones.forEach(function (z) {
      var x1 = z[0] / 100 * DG_W, x2 = z[1] / 100 * DG_W;
      s += '<rect x="' + x1.toFixed(1) + '" y="28" width="' + (x2 - x1).toFixed(1) + '" height="10" fill="' + z[2] + '" rx="1"/>';
    });
    var px = score / 100 * DG_W;
    s += '<polygon points="' + px.toFixed(1) + ',' + 28 + ' ' + (px - 5).toFixed(1) + ',' + 20 + ' ' + (px + 5).toFixed(1) + ',' + 20 + '" fill="#26314a"/>';
    s += '<text x="' + px.toFixed(1) + '" y="14" font-size="12" font-weight="700" text-anchor="middle" fill="#26314a">' + score + '</text>';
    s += '<text x="4" y="' + (DG_H - 4) + '" font-size="9" fill="#6b7280">0</text>';
    s += '<text x="' + (DG_W - 12) + '" y="' + (DG_H - 4) + '" font-size="9" fill="#6b7280">100</text>';
    return dgSvg(s, DG_W, DG_H + 4);
  }
  function dgSpectrum(label) {
    return dgSvg('<defs><linearGradient id="sg_' + (label || "d") + '" x1="0" x2="1"><stop offset="0%" stop-color="#0c7a3e"/><stop offset="25%" stop-color="#57c48c"/><stop offset="50%" stop-color="#c9cfda"/><stop offset="75%" stop-color="#ec7d7d"/><stop offset="100%" stop-color="#a51c1c"/></linearGradient></defs>' +
      '<rect x="0" y="' + (DG_H / 2 - 7) + '" width="' + DG_W + '" height="14" rx="7" fill="url(#sg_' + (label || "d") + ')"/>' +
      '<polygon points="' + DG_W / 2 + ',' + (DG_H / 2 - 12) + ' ' + (DG_W / 2 - 6) + ',' + (DG_H / 2 - 2) + ' ' + (DG_W / 2 + 6) + ',' + (DG_H / 2 - 2) + '" fill="#26314a"/>');
  }
  function dgSplitH(left, right) {
    return dgSvg('<line x1="' + DG_W / 2 + '" y1="5" x2="' + DG_W / 2 + '" y2="' + (DG_H - 5) + '" stroke="var(--t-border)" stroke-dasharray="4 3"/>' +
      '<text x="8" y="20" font-size="11" fill="#e05a5a" font-weight="600">' + (left || "正") + '</text>' +
      '<text x="' + (DG_W - 8) + '" y="20" text-anchor="end" font-size="11" fill="#1fa363" font-weight="600">' + (right || "负") + '</text>' +
      '<rect x="8" y="' + (DG_H / 2 - 5) + '" width="' + (DG_W / 2 - 16) + '" height="10" rx="3" fill="#e05a5a" opacity="0.2"/>' +
      '<rect x="' + (DG_W / 2 + 8) + '" y="' + (DG_H / 2 - 5) + '" width="' + (DG_W / 2 - 16) + '" height="10" rx="3" fill="#1fa363" opacity="0.2"/>');
  }
  function dgCurve() {
    return dgSvg('<path d="M0,' + (DG_H - 5) + ' C60,' + (DG_H - 8) + ' 100,30 140,25 180,22 ' + DG_W + ',15 ' + DG_W + ',12" fill="none" stroke="#0d9488" stroke-width="2"/>' +
      '<circle cx="60" cy="' + (DG_H - 6) + '" r="3" fill="#0d9488"/><circle cx="140" cy="25" r="3" fill="#0d9488"/>' +
      '<text x="60" y="' + (DG_H - 10) + '" font-size="9" fill="var(--text-dim)" text-anchor="middle">短期</text>' +
      '<text x="140" y="38" font-size="9" fill="var(--text-dim)" text-anchor="middle">中期</text>' +
      '<text x="' + (DG_W - 20) + '" y="10" font-size="9" fill="var(--text-dim)" text-anchor="middle">长期</text>');
  }
  function dgFlow() {
    return dgSvg('<defs><marker id="af" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><path d="M0 0 L5 2 L0 4" fill="#e05a5a"/></marker></defs>' +
      '<line x1="20" y1="20" x2="' + (DG_W - 30) + '" y2="20" stroke="#e05a5a" stroke-width="2" marker-end="url(#af)"/>' +
      '<text x="' + DG_W / 2 + '" y="14" text-anchor="middle" font-size="10" fill="var(--text-dim)">资金流入 →</text>' +
      '<line x1="' + (DG_W - 30) + '" y1="' + (DG_H - 20) + '" x2="30" y2="' + (DG_H - 20) + '" stroke="#1fa363" stroke-width="2" marker-end="url(#af)"/>' +
      '<text x="' + DG_W / 2 + '" y="' + (DG_H - 10) + '" text-anchor="middle" font-size="10" fill="var(--text-dim)">← 资金流出</text>');
  }
  function dgMaCross() {
    return dgSvg('<path d="M0,55 C40,50 60,45 90,42 C120,38 150,42 200,38" fill="none" stroke="#8a96b0" stroke-width="1.5" stroke-dasharray="4 2"/>' +
      '<path d="M0,48 C40,52 60,58 90,62 C120,66 150,58 200,52" fill="none" stroke="#1fa363" stroke-width="1.5" stroke-dasharray="4 2"/>' +
      '<path d="M0,60 C40,58 60,50 90,45 C120,42 150,35 200,28" fill="none" stroke="#0d9488" stroke-width="2"/>' +
      '<text x="8" y="46" font-size="9" fill="var(--text-dim)">MA20</text>' +
      '<text x="8" y="58" font-size="9" fill="var(--text-dim)">MA60</text>' +
      '<text x="' + (DG_W - 30) + '" y="24" font-size="9" fill="var(--text-dim)">价格</text>');
  }
  function dgNavCurve() {
    return dgSvg('<defs><linearGradient id="nv" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#0d9488" stop-opacity="0.15"/><stop offset="100%" stop-color="#0d9488" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="M0,15 C30,18 60,14 90,22 C120,28 130,20 150,25 C170,30 180,24 200,28 L200,' + DG_H + ' L0,' + DG_H + ' Z" fill="url(#nv)"/>' +
      '<path d="M0,15 C30,18 60,14 90,22 C120,28 130,20 150,25 C170,30 180,24 200,28" fill="none" stroke="#0d9488" stroke-width="2"/>' +
      '<circle cx="90" cy="22" r="3" fill="#d8434a"/><text x="90" y="38" font-size="9" fill="#d8434a" text-anchor="middle">峰值</text>' +
      '<line x1="90" y1="22" x2="150" y2="' + (DG_H - 8) + '" stroke="#d8434a" stroke-dasharray="3 3"/>' +
      '<text x="150" y="' + (DG_H - 4) + '" font-size="9" fill="#d8434a" text-anchor="middle">最大回撤</text>');
  }
  function dgDurationBar(len) {
    var w = Math.max(20, Math.min(DG_W - 20, (len || 5) / 10 * DG_W));
    return dgSvg('<rect x="0" y="' + (DG_H / 2 - 8) + '" width="' + w.toFixed(0) + '" height="16" rx="4" fill="#0d9488" opacity="0.3"/>' +
      '<rect x="0" y="' + (DG_H / 2 - 8) + '" width="' + (w * 0.3).toFixed(0) + '" height="16" rx="4" fill="#0d9488"/>' +
      '<text x="' + (w + 8).toFixed(0) + '" y="' + (DG_H / 2 + 5) + '" font-size="11" fill="var(--text-dim)">' + (len || 5) + '年</text>');
  }
  function dgRatingLadder() {
    var ratings = [["AAA", "#0c7a3e"], ["AA", "#1fa363"], ["A", "#57c48c"], ["BBB", "#c9cfda"], ["BB", "#ec7d7d"], ["B", "#d8434a"], ["CCC", "#a51c1c"]];
    var s = "";
    ratings.forEach(function (r, i) {
      var y = 8 + i * 9;
      s += '<rect x="' + (DG_W / 2 - 30) + '" y="' + y + '" width="60" height="7" rx="2" fill="' + r[1] + '"/>' +
        '<text x="' + (DG_W / 2 + 36) + '" y="' + (y + 6) + '" font-size="9" fill="var(--text-dim)">' + r[0] + '</text>';
    });
    return dgSvg(s, DG_W, 72);
  }
  function dgTermStructure() {
    return dgSvg('<path d="M0,60 C40,55 80,48 120,42 C160,38 180,32 200,28" fill="none" stroke="#0d9488" stroke-width="2"/>' +
      '<line x1="0" y1="50" x2="200" y2="50" stroke="#c9cfda" stroke-dasharray="3 3"/>' +
      '<text x="20" y="' + (DG_H - 8) + '" font-size="9" fill="var(--text-dim)">短期</text>' +
      '<text x="180" y="20" font-size="9" fill="var(--text-dim)">长期</text>' +
      '<text x="100" y="18" font-size="10" fill="#0d9488" text-anchor="middle">收益率曲线</text>');
  }

  var DG_MAP = {
    kline: dgKline, bar: dgBar, oscillator: dgOscillator, band: dgBand,
    gauge: dgGauge, spectrum: function () { return dgSpectrum("d"); },
    curve: dgCurve, flow: dgFlow, ma_cross: dgMaCross, nav_curve: dgNavCurve,
    duration_bar: function () { return dgDurationBar(5); },
    rating_ladder: dgRatingLadder, term_structure: dgTermStructure, split_h: dgSplitH,
  };
  function dgFor(type) {
    var fn = DG_MAP[type];
    return fn ? fn() : "";
  }

  /* ── 搜索：名称 / 英文 / 标签 / 拼音首字母 ── */
  function fuzzyMatch(query, item) {
    if (!query) return true;
    var q = query.toLowerCase().replace(/\s+/g, "");
    if (item.n.toLowerCase().indexOf(q) >= 0) return true;
    if (item.en.toLowerCase().indexOf(q) >= 0) return true;
    if (item.tags && item.tags.toLowerCase().indexOf(q) >= 0) return true;
    if (item.py && item.py.indexOf(q) >= 0) return true;
    /* 多关键词：全部命中才算匹配 */
    var parts = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return parts.every(function (p) { return fuzzyMatch(p, item); });
    return false;
  }

  /* ── 行模式渲染 ── */
  function render() {
    var host = $("learnBody");
    if (!host) return;
    var items = LEARN_DATA[activeCat] || [];
    var filtered = items.filter(function (item) {
      return fuzzyMatch(searchTerm, item);
    });
    if (!filtered.length) {
      host.innerHTML = '<div class="learn-empty">未找到匹配指标（搜索：' + esc(searchTerm) + '）</div>';
      return;
    }
    var openKey = activeCat, opened = openSet[openKey] || {};
    var html = '<div class="learn-rows">';
    filtered.forEach(function (item, idx) {
      var isOpen = !!opened[item.n];
      html += '<div class="learn-item' + (isOpen ? " open" : "") + '" data-n="' + esc(item.n) + '">';
      /* ── 行头：常驻可见 ── */
      html += '<div class="learn-row" role="button" tabindex="0" aria-expanded="' + isOpen + '">';
      html += '<span class="learn-rank">' + (idx + 1) + "</span>";
      html += '<span class="learn-name">' + esc(item.n) + "</span>";
      html += '<span class="learn-en">' + esc(item.en) + "</span>";
      html += '<span class="learn-one">' + esc(item.one || "") + "</span>";
      html += '<span class="learn-star" title="使用频率">' + starRating((25 - Math.min(25, item.f * 5)) / 25 * 100) + "</span>";
      html += '<span class="learn-caret">▾</span>';
      html += "</div>";
      /* ── 展开详情 ── */
      if (isOpen) {
        html += detailHtml(item);
      }
      html += "</div>";
    });
    html += "</div>";
    host.innerHTML = html;
  }
  function detailHtml(item) {
    var h = '<div class="learn-detail">';
    h += '<div class="learn-p"><b class="learn-label">第一性原理</b>' + esc(item.p) + "</div>";
    if (item.hi || item.lo) {
      h += '<div class="learn-hl"><span class="learn-label">高低含义</span>' +
        '<span class="learn-hi"><i>高</i>' + esc(item.hi || "--") + "</span>" +
        '<span class="learn-lo"><i>低</i>' + esc(item.lo || "--") + "</span></div>";
    }
    if (item.fx) {
      h += '<div class="learn-fx"><span class="learn-label">计算</span><code>' + esc(item.fx) + "</code></div>";
    }
    var dgHtml = dgFor(item.dg);
    if (dgHtml) {
      h += '<div class="learn-dg-wrap">' + dgHtml + "</div>";
    }
    h += "</div>";
    return h;
  }
  function starRating(score) {
    var s = Math.max(0, Math.min(100, score));
    var full = Math.floor(s / 20), half = (s % 20) >= 10, dots = 5 - full - (half ? 1 : 0);
    return "★".repeat(full) + (half ? "☆" : "") + "·".repeat(dots);
  }

  /* ── 展开/收起（事件委托，动画平滑） ── */
  function bindRows() {
    var host = $("learnBody");
    if (!host || host._learnBound) return;
    host._learnBound = true;
    host.addEventListener("click", function (ev) {
      var row = ev.target.closest(".learn-row");
      if (!row) return;
      var wrap = row.parentElement;
      var name = wrap.getAttribute("data-n");
      var isOpen = wrap.classList.contains("open");
      if (isOpen) {
        /* 收起：先压缩高度再移除，动画自然 */
        var det = wrap.querySelector(".learn-detail");
        if (det) {
          det.style.maxHeight = det.scrollHeight + "px";
          requestAnimationFrame(function () {
            det.style.maxHeight = "0";
            det.style.opacity = "0";
            setTimeout(function () { render(); }, 160);
          });
        } else { render(); }
        delete openSet[activeCat][name];
      } else {
        if (!openSet[activeCat]) openSet[activeCat] = {};
        openSet[activeCat][name] = true;
        render();
        /* 展开：从 0 → 自动高度过渡 */
        var el = host.querySelector('.learn-item[data-n="' + name.replace(/"/g, "") + '"] .learn-detail');
        if (el) {
          var target = el.scrollHeight;
          el.style.maxHeight = "0";
          el.style.opacity = "0";
          requestAnimationFrame(function () {
            el.style.maxHeight = target + "px";
            el.style.opacity = "1";
            setTimeout(function () { el.style.maxHeight = "none"; }, 220);
          });
        }
      }
    });
    host.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var row = ev.target.closest(".learn-row");
      if (row) { ev.preventDefault(); row.click(); }
    });
  }

  /* ── 初始化 ── */
  document.addEventListener("DOMContentLoaded", function () {
    var pill = document.querySelector('.nav-pill[data-tab="learn"]');
    if (!pill) return;
    pill.addEventListener("click", function () {
      ensureLearn();
      render();
    });
    var searchEl = $("learnSearch");
    if (searchEl) {
      var tId = null;
      searchEl.addEventListener("input", function () {
        /* 150ms 防抖，避免大列表连续重渲染 */
        clearTimeout(tId);
        var v = this.value.trim();
        tId = setTimeout(function () { searchTerm = v; render(); }, 150);
      });
    }
    var navFloat = $("learnNavFloat");
    if (navFloat) {
      navFloat.addEventListener("click", function (ev) {
        var b = ev.target.closest("button[data-cat]");
        if (!b || b.classList.contains("on")) return;
        activeCat = b.getAttribute("data-cat");
        navFloat.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
        searchTerm = "";
        var se = $("learnSearch");
        if (se) se.value = "";
        render();
      });
      navFloat.querySelectorAll("button").forEach(function (x) {
        x.classList.toggle("on", x.getAttribute("data-cat") === activeCat);
      });
    }
    function ensureLearn() {
      if (!$("learnBody") || !$("learnBody").innerHTML.trim()) render();
    }
    bindRows();
    render();
  });
})();
