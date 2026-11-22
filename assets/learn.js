/* ═══════════ 指标百科 · 学习模块（行模式 · 六维度详情 · 33种SVG图示） ═══════════ */
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

  /* ═══════════ SVG 图示生成器（33 种） ═══════════ */
  var DG_W = 200, DG_H = 72;
  var UP = "#e05a5a", DOWN = "#1fa363", TEAL = "#0d9488", BLUE = "#5C6BC0",
      DIM = "var(--text-dim)", BORDER = "var(--t-border)";
  function dgSvg(inner, w, h) {
    return '<svg viewBox="0 0 ' + (w || DG_W) + ' ' + (h || DG_H) + '" class="learn-dg">' + (inner || "") + "</svg>";
  }
  function txt(x, y, s, fill, size, anchor, weight) {
    return '<text x="' + x + '" y="' + y + '" font-size="' + (size || 9) + '" fill="' + (fill || DIM) + '"' +
      (anchor ? ' text-anchor="' + anchor + '"' : "") + (weight ? ' font-weight="' + weight + '"' : "") + '>' + s + "</text>";
  }
  function arrowDef(id, color) {
    return '<defs><marker id="' + id + '" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><path d="M0 0 L5 2 L0 4" fill="' + (color || UP) + '"/></marker></defs>';
  }

  /* ── K线 ── */
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
      var col = up ? UP : DOWN;
      var x = i * bw + bw / 2;
      var top = Math.min(k.o, k.c), bot = Math.max(k.o, k.c);
      s += '<line x1="' + (x + bw * 0.15).toFixed(1) + '" y1="' + k.h + '" x2="' + (x + bw * 0.15).toFixed(1) + '" y2="' + k.l + '" stroke="' + col + '" stroke-width="1"/>';
      s += '<rect x="' + (x + bw * 0.1).toFixed(1) + '" y="' + top + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + (bot - top).toFixed(1) + '" fill="' + col + '" rx="1"/>';
    });
    return dgSvg(s);
  }
  /* ── 量能柱 ── */
  function dgBar() {
    var s = "";
    var bars = [40, 65, 30, 80, 55, 72, 45, 90, 60, 75, 50, 85];
    bars.forEach(function (h, i) {
      var x = i * (DG_W / bars.length) + 2;
      var col = h > 60 ? UP : "#57c48c";
      s += '<rect x="' + x.toFixed(1) + '" y="' + (DG_H - h * 0.7) + '" width="' + (DG_W / bars.length - 3).toFixed(1) + '" height="' + (h * 0.7) + '" fill="' + col + '" rx="2" opacity="0.8"/>';
    });
    return dgSvg(s);
  }
  /* ── 振荡器（超买超卖线） ── */
  function dgOscillator() {
    var pts = "";
    var vals = [50, 35, 25, 30, 45, 62, 75, 68, 55, 48, 38, 28, 22, 30, 42, 55, 68, 72, 60, 48];
    vals.forEach(function (v, i) {
      var x = i * (DG_W / (vals.length - 1));
      var y = DG_H * (1 - v / 100) * 0.9 + 3;
      pts += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    });
    return dgSvg('<line x1="0" y1="' + (DG_H * 0.1) + '" x2="' + DG_W + '" y2="' + (DG_H * 0.1) + '" stroke="#d8434a" stroke-dasharray="3 3" opacity="0.5"/>' +
      '<line x1="0" y1="' + (DG_H * 0.7) + '" x2="' + DG_W + '" y2="' + (DG_H * 0.7) + '" stroke="#1fa363" stroke-dasharray="3 3" opacity="0.5"/>' +
      '<path d="' + pts + '" fill="none" stroke="' + BLUE + '" stroke-width="1.8"/>' +
      txt(3, DG_H * 0.1 + 4, "70", "#d8434a") + txt(3, DG_H * 0.7 + 4, "30", "#1fa363"));
  }
  /* ── 布林通道 ── */
  function dgBand() {
    var up = "0,18 30,14 60,16 90,10 120,12 150,8 180,10 200,6";
    var lo = "0,58 30,54 60,56 90,50 120,52 150,48 180,50 200,46";
    var mid = "0,38 30,34 60,36 90,30 120,32 150,28 180,30 200,26";
    return dgSvg('<polyline points="' + up + '" fill="none" stroke="' + BLUE + '" stroke-width="1" stroke-dasharray="4 2"/>' +
      '<polyline points="' + mid + '" fill="none" stroke="' + TEAL + '" stroke-width="1.5"/>' +
      '<polyline points="' + lo + '" fill="none" stroke="' + BLUE + '" stroke-width="1" stroke-dasharray="4 2"/>' +
      '<polygon points="' + up + " " + lo.split(" ").reverse().join(" ") + '" fill="' + TEAL + '" opacity="0.08"/>' +
      txt(DG_W - 30, 16, "上轨", DIM) + txt(DG_W - 30, DG_H - 8, "下轨", DIM));
  }
  /* ── 情绪仪表盘 ── */
  function dgGauge() {
    var score = 26;
    var zones = [[0, 30, "#1fa363"], [30, 45, "#8bc48c"], [45, 60, "#c9cfda"], [60, 80, "#ec7d7d"], [80, 100, "#a51c1c"]];
    var s = "";
    zones.forEach(function (z) {
      var x1 = z[0] / 100 * DG_W, x2 = z[1] / 100 * DG_W;
      s += '<rect x="' + x1.toFixed(1) + '" y="28" width="' + (x2 - x1).toFixed(1) + '" height="10" fill="' + z[2] + '" rx="1"/>';
    });
    var px = score / 100 * DG_W;
    s += '<polygon points="' + px.toFixed(1) + ',28 ' + (px - 5).toFixed(1) + ',20 ' + (px + 5).toFixed(1) + ',20" fill="#26314a"/>';
    s += txt(px.toFixed(1), 14, score, "#26314a", 12, "middle", "700");
    s += txt(4, DG_H - 4, "0 弱市") + txt(DG_W - 12, DG_H - 4, "100 强势", DIM, 9, "end");
    return dgSvg(s, DG_W, DG_H + 4);
  }
  /* ── 红绿光谱条 ── */
  function dgSpectrum(label) {
    return dgSvg('<defs><linearGradient id="sg_' + (label || "d") + '" x1="0" x2="1"><stop offset="0%" stop-color="#0c7a3e"/><stop offset="25%" stop-color="#57c48c"/><stop offset="50%" stop-color="#c9cfda"/><stop offset="75%" stop-color="#ec7d7d"/><stop offset="100%" stop-color="#a51c1c"/></linearGradient></defs>' +
      '<rect x="0" y="' + (DG_H / 2 - 7) + '" width="' + DG_W + '" height="14" rx="7" fill="url(#sg_' + (label || "d") + ')"/>' +
      '<polygon points="' + DG_W / 2 + ',' + (DG_H / 2 - 12) + " " + (DG_W / 2 - 6) + ',' + (DG_H / 2 - 2) + " " + (DG_W / 2 + 6) + ',' + (DG_H / 2 - 2) + '" fill="#26314a"/>' +
      txt(4, DG_H / 2 + 26, "低 / 便宜", DIM) + txt(DG_W - 4, DG_H / 2 + 26, "高 / 昂贵", DIM, 9, "end"));
  }
  /* ── 左右对照 ── */
  function dgSplitH(left, right) {
    return dgSvg('<line x1="' + DG_W / 2 + '" y1="5" x2="' + DG_W / 2 + '" y2="' + (DG_H - 5) + '" stroke="' + BORDER + '" stroke-dasharray="4 3"/>' +
      txt(8, 20, left || "正", UP, 11, undefined, "600") +
      txt(DG_W - 8, 20, right || "负", DOWN, 11, "end", "600") +
      '<rect x="8" y="' + (DG_H / 2 - 5) + '" width="' + (DG_W / 2 - 16) + '" height="10" rx="3" fill="' + UP + '" opacity="0.2"/>' +
      '<rect x="' + (DG_W / 2 + 8) + '" y="' + (DG_H / 2 - 5) + '" width="' + (DG_W / 2 - 16) + '" height="10" rx="3" fill="' + DOWN + '" opacity="0.2"/>');
  }
  /* ── 资金流 ── */
  function dgFlow() {
    return dgSvg(arrowDef("afL") + arrowDef("afR", DOWN) +
      '<line x1="20" y1="20" x2="' + (DG_W - 30) + '" y2="20" stroke="' + UP + '" stroke-width="2" marker-end="url(#afL)"/>' +
      txt(DG_W / 2, 14, "资金流入 →", DIM, 10, "middle") +
      '<line x1="' + (DG_W - 30) + '" y1="' + (DG_H - 20) + '" x2="30" y2="' + (DG_H - 20) + '" stroke="' + DOWN + '" stroke-width="2" marker-end="url(#afR)"/>' +
      txt(DG_W / 2, DG_H - 10, "← 资金流出", DIM, 10, "middle"));
  }
  /* ── 均线交叉 ── */
  function dgMaCross() {
    return dgSvg('<path d="M0,55 C40,50 60,45 90,42 C120,38 150,42 200,38" fill="none" stroke="#8a96b0" stroke-width="1.5" stroke-dasharray="4 2"/>' +
      '<path d="M0,48 C40,52 60,58 90,62 C120,66 150,58 200,52" fill="none" stroke="' + DOWN + '" stroke-width="1.5" stroke-dasharray="4 2"/>' +
      '<path d="M0,60 C40,58 60,50 90,45 C120,42 150,35 200,28" fill="none" stroke="' + TEAL + '" stroke-width="2"/>' +
      txt(8, 46, "MA20") + txt(8, 58, "MA60") + txt(DG_W - 30, 24, "价格"));
  }
  /* ── 净值曲线与最大回撤 ── */
  function dgNavCurve() {
    return dgSvg('<defs><linearGradient id="nv" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="' + TEAL + '" stop-opacity="0.15"/><stop offset="100%" stop-color="' + TEAL + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="M0,15 C30,18 60,14 90,22 C120,28 130,20 150,25 C170,30 180,24 200,28 L200,' + DG_H + ' L0,' + DG_H + ' Z" fill="url(#nv)"/>' +
      '<path d="M0,15 C30,18 60,14 90,22 C120,28 130,20 150,25 C170,30 180,24 200,28" fill="none" stroke="' + TEAL + '" stroke-width="2"/>' +
      '<circle cx="90" cy="22" r="3" fill="#d8434a"/>' + txt(90, 38, "峰值", "#d8434a", 9, "middle") +
      '<line x1="90" y1="22" x2="150" y2="' + (DG_H - 8) + '" stroke="#d8434a" stroke-dasharray="3 3"/>' +
      txt(150, DG_H - 4, "最大回撤", "#d8434a", 9, "middle"));
  }
  /* ── 普通曲线 ── */
  function dgCurve() {
    return dgSvg('<path d="M0,' + (DG_H - 5) + ' C60,' + (DG_H - 8) + ' 100,30 140,25 180,22 ' + DG_W + ',15 ' + DG_W + ',12" fill="none" stroke="' + TEAL + '" stroke-width="2"/>' +
      '<circle cx="60" cy="' + (DG_H - 6) + '" r="3" fill="' + TEAL + '"/><circle cx="140" cy="25" r="3" fill="' + TEAL + '"/>' +
      txt(60, DG_H - 10, "短期", DIM, 9, "middle") + txt(140, 38, "中期", DIM, 9, "middle") +
      txt(DG_W - 20, 10, "长期", DIM, 9, "middle"));
  }
  /* ── 久期条 ── */
  function dgDurationBar(len) {
    var w = Math.max(20, Math.min(DG_W - 20, (len || 5) / 10 * DG_W));
    return dgSvg('<rect x="0" y="' + (DG_H / 2 - 8) + '" width="' + w.toFixed(0) + '" height="16" rx="4" fill="' + TEAL + '" opacity="0.3"/>' +
      '<rect x="0" y="' + (DG_H / 2 - 8) + '" width="' + (w * 0.3).toFixed(0) + '" height="16" rx="4" fill="' + TEAL + '"/>' +
      txt((w + 8).toFixed(0), DG_H / 2 + 5, (len || 5) + "年", DIM, 11) +
      txt(4, DG_H - 4, "利率敏感度随久期增长", DIM, 8.5));
  }
  /* ── 评级阶梯 ── */
  function dgRatingLadder() {
    var ratings = [["AAA", "#0c7a3e"], ["AA", "#1fa363"], ["A", "#57c48c"], ["BBB", "#c9cfda"], ["BB", "#ec7d7d"], ["B", "#d8434a"], ["CCC", "#a51c1c"]];
    var s = "";
    ratings.forEach(function (r, i) {
      var y = 8 + i * 9;
      s += '<rect x="' + (DG_W / 2 - 30) + '" y="' + y + '" width="60" height="7" rx="2" fill="' + r[1] + '"/>' +
        txt(DG_W / 2 + 36, y + 6, r[0], DIM);
    });
    return dgSvg(s + '<line x1="' + (DG_W / 2 - 40) + '" y1="' + (8 + 3.5 * 9) + '" x2="' + (DG_W / 2 + 70) + '" y2="' + (8 + 3.5 * 9) + '" stroke="' + DIM + '" stroke-dasharray="2 2" opacity="0.6"/>' +
      txt(DG_W / 2 - 42, 8 + 3.5 * 9 + 3, "投资级↑", DIM, 8, "end"), DG_W, 72);
  }
  /* ── 收益率曲线 ── */
  function dgTermStructure() {
    return dgSvg('<path d="M0,60 C40,55 80,48 120,42 C160,38 180,32 200,28" fill="none" stroke="' + TEAL + '" stroke-width="2"/>' +
      '<line x1="0" y1="50" x2="200" y2="50" stroke="#c9cfda" stroke-dasharray="3 3"/>' +
      txt(20, DG_H - 8, "短期") + txt(180, 20, "长期") +
      txt(100, 18, "收益率曲线", TEAL, 10, "middle"));
  }
  /* ── 两期增长对比柱 ── */
  function dgGrowthBar() {
    return dgSvg('<rect x="30" y="40" width="34" height="24" rx="3" fill="' + "#8a96b0" + '" opacity="0.55"/>' +
      '<rect x="76" y="22" width="34" height="42" rx="3" fill="' + TEAL + '"/>' +
      arrowDef("gbA") + '<path d="M64 44 C78 38 88 30 96 24" fill="none" stroke="' + UP + '" stroke-width="1.6" stroke-dasharray="3 2" marker-end="url(#gbA)"/>' +
      txt(47, 70, "上期", DIM, 9, "middle") + txt(93, 70, "本期", DIM, 9, "middle") +
      txt(120, 34, "+28%", UP, 12, undefined, "700") + txt(120, 48, "增长率", DIM, 9));
  }
  /* ── 利润瀑布 ── */
  function dgWaterfall() {
    var bars = [
      { x: 8, y: 14, h: 50, c: TEAL, t: "收入" },
      { x: 46, y: 34, h: 30, c: UP, t: "成本" },
      { x: 84, y: 44, h: 20, c: UP, t: "费用" },
      { x: 122, y: 52, h: 12, c: "#57c48c", t: "净利" },
    ];
    var s = '<line x1="0" y1="64" x2="200" y2="64" stroke="' + BORDER + '"/>';
    bars.forEach(function (b) {
      s += '<rect x="' + b.x + '" y="' + b.y + '" width="30" height="' + b.h + '" rx="2" fill="' + b.c + '" opacity="0.85"/>' + txt(b.x + 15, 70, b.t, DIM, 8.5, "middle");
    });
    return dgSvg(s + '<line x1="38" y1="14" x2="46" y2="34" stroke="' + DIM + '" stroke-dasharray="2 2"/><line x1="76" y1="34" x2="84" y2="44" stroke="' + DIM + '" stroke-dasharray="2 2"/><line x1="114" y1="44" x2="122" y2="52" stroke="' + DIM + '" stroke-dasharray="2 2"/>');
  }
  /* ── 利润 vs 现金流双柱 ── */
  function dgCashflow() {
    var s = '<line x1="0" y1="60" x2="200" y2="60" stroke="' + BORDER + '"/>';
    var pairs = [[20, 36, 18, 32, "第1年"], [78, 40, 34, 26, "第2年"], [136, 34, 44, 28, "第3年"]];
    pairs.forEach(function (p) {
      s += '<rect x="' + p[0] + '" y="' + (60 - p[2]) + '" width="18" height="' + p[2] + '" rx="2" fill="' + BLUE + '" opacity="0.75"/>' +
        '<rect x="' + (p[0] + 22) + '" y="' + (60 - p[3]) + '" width="18" height="' + p[3] + '" rx="2" fill="' + TEAL + '" opacity="0.85"/>' +
        txt(p[0] + 19, 70, p[4], DIM, 8.5, "middle");
    });
    return dgSvg(s + '<rect x="8" y="2" width="9" height="7" rx="2" fill="' + BLUE + '" opacity="0.75"/>' + txt(20, 8, "净利润", DIM, 8) +
      '<rect x="58" y="2" width="9" height="7" rx="2" fill="' + TEAL + '" opacity="0.85"/>' + txt(70, 8, "经营现金流", DIM, 8));
  }
  /* ── 资产负债堆叠 ── */
  function dgDebtStack() {
    return dgSvg('<rect x="10" y="16" width="180" height="26" rx="4" fill="#3b82f6" opacity="0.25"/>' +
      '<rect x="10" y="16" width="82" height="26" rx="4" fill="#3b82f6" opacity="0.7"/>' +
      '<rect x="10" y="50" width="180" height="14" rx="3" fill="#f59e0b" opacity="0.2"/>' +
      '<rect x="10" y="50" width="50" height="14" rx="3" fill="#f59e0b" opacity="0.75"/>' +
      txt(52, 32, "自有权益 55%", "#fff", 9, "middle", "700") + txt(140, 32, "负债 45%", DIM, 9, "middle") +
      txt(88, 61, "其中付息债务 28%", DIM, 8.5, "middle") + txt(10, 12, "总资产", DIM, 8.5));
  }
  /* ── 覆盖倍数（EBIT vs 利息） ── */
  function dgCoverage() {
    return dgSvg('<rect x="14" y="18" width="52" height="40" rx="3" fill="' + TEAL + '" opacity="0.85"/>' +
      '<rect x="14" y="48" width="52" height="10" rx="3" fill="' + UP + '" opacity="0.9"/>' +
      txt(40, 68, "经营收益", DIM, 8.5, "middle") +
      '<line x1="84" y1="48" x2="112" y2="48" stroke="' + DIM + '" stroke-dasharray="3 2"/>' + arrowDef("cvA", DIM) +
      '<line x1="84" y1="48" x2="108" y2="48" stroke="' + DIM + '" stroke-width="1.2" marker-end="url(#cvA)"/>' +
      '<rect x="128" y="42" width="52" height="16" rx="3" fill="' + UP + '" opacity="0.55"/>' +
      txt(154, 54, "利息 4×", "#fff", 9, "middle", "700") + txt(154, 32, "覆盖倍数", DIM, 9, "middle"));
  }
  /* ── 周转循环 ── */
  function dgTurnoverCycle() {
    var boxes = [["存货", 12], ["销售", 62], ["应收", 112], ["现金", 162]];
    var s = arrowDef("tcA", TEAL);
    boxes.forEach(function (b) {
      s += '<rect x="' + b[1] + '" y="24" width="30" height="16" rx="8" fill="' + TEAL + '" opacity="0.14"/>' +
        txt(b[1] + 15, 35, b[0], TEAL, 9, "middle", "600");
      if (b[1] < 162) s += '<line x1="' + (b[1] + 32) + '" y1="32" x2="' + (b[1] + 46) + '" y2="32" stroke="' + TEAL + '" stroke-width="1.5" marker-end="url(#tcA)"/>';
    });
    s += '<path d="M177 44 C150 60 60 60 24 44" fill="none" stroke="' + DIM + '" stroke-width="1.2" stroke-dasharray="3 3"/>' +
      arrowDef("tcB", DIM) + '<path d="M28 46 L24 44" stroke="none"/>' +
      txt(100, 62, "循环越快 → 占用资金越少", DIM, 8.5, "middle");
    return dgSvg(s);
  }
  /* ── 收入费用拆分条 ── */
  function dgExpenseSplit() {
    var segs = [["成本", 70, TEAL], ["销售费", 30, UP], ["管理费", 22, "#f59e0b"], ["研发费", 18, BLUE], ["净利", 60, "#57c48c"]];
    var s = "", x = 8;
    segs.forEach(function (g) {
      s += '<rect x="' + x + '" y="26" width="' + g[1] + '" height="18" rx="3" fill="' + g[2] + '" opacity="0.8"/>';
      if (g[1] > 24) s += txt(x + g[1] / 2, 38, g[0], "#fff", 8.5, "middle");
      x += g[1] + 3;
    });
    return dgSvg(s + txt(8, 16, "收入 100% 的拆分去向", DIM, 9) + txt(8, 62, "费用占比 = 费用 ÷ 收入", DIM, 9));
  }
  /* ── 收益-风险散点 ── */
  function dgRiskScatter() {
    var dots = [[40, 44, BLUE], [70, 36, TEAL], [100, 28, TEAL], [130, 40, BLUE], [160, 22, UP], [88, 50, "#8a96b0"]];
    var s = '<line x1="10" y1="58" x2="190" y2="10" stroke="' + DIM + '" stroke-width="1" stroke-dasharray="4 3"/>' +
      txt(30, 66, "低风险", DIM, 8.5) + txt(150, 66, "高风险", DIM, 8.5) +
      txt(8, 14, "收益", DIM, 8.5);
    dots.forEach(function (d) {
      s += '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="4" fill="' + d[2] + '" opacity="0.8"/>';
    });
    s += '<circle cx="100" cy="28" r="7" fill="none" stroke="' + TEAL + '" stroke-width="1.2"/>' + txt(110, 26, "优秀区", TEAL, 8.5);
    return dgSvg(s);
  }
  /* ── 基金 vs 基准散点（alpha） ── */
  function dgAlphaScatter() {
    var s = '<line x1="10" y1="62" x2="190" y2="8" stroke="' + DIM + '" stroke-width="1" stroke-dasharray="4 3"/>' +
      txt(14, 12, "基准收益", DIM, 8.5) + txt(150, 66, "基准", DIM, 8.5);
    [[50, 48], [90, 40], [130, 24], [160, 14]].forEach(function (d) {
      s += '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="4" fill="' + TEAL + '" opacity="0.8"/>';
    });
    s += '<circle cx="90" cy="40" r="6.5" fill="none" stroke="' + UP + '" stroke-width="1.3"/>' +
      txt(70, 34, "在虚线上方 = 有超额", UP, 8.5);
    return dgSvg(s);
  }
  /* ── 基金 vs 基准双线 + 差值带（跟踪） ── */
  function dgNavVsBench() {
    return dgSvg('<path d="M0,40 C30,36 60,38 90,32 C120,28 150,30 200,22" fill="none" stroke="' + DIM + '" stroke-width="1.6" stroke-dasharray="5 3"/>' +
      '<path d="M0,42 C30,40 60,34 90,30 C120,26 150,28 200,20" fill="none" stroke="' + TEAL + '" stroke-width="2"/>' +
      '<polygon points="0,40 30,36 60,38 90,32 120,28 150,30 200,22 200,20 150,28 120,26 90,30 60,34 30,40 0,42" fill="' + TEAL + '" opacity="0.12"/>' +
      txt(10, 52, "基金", TEAL, 9) + txt(10, 62, "基准(虚线)", DIM, 9) + txt(150, 16, "偏离带", DIM, 8.5));
  }
  /* ── 价格-收益率反向曲线 ── */
  function dgPriceYtm() {
    return dgSvg('<path d="M10,14 C60,20 110,40 150,52 C170,58 185,60 195,62" fill="none" stroke="' + TEAL + '" stroke-width="2"/>' +
      '<line x1="10" y1="64" x2="196" y2="64" stroke="' + BORDER + '"/><line x1="10" y1="8" x2="10" y2="64" stroke="' + BORDER + '"/>' +
      arrowDef("pyA", DIM) + '<line x1="60" y1="30" x2="80" y2="24" stroke="' + DIM + '" stroke-width="1" marker-end="url(#pyA)"/>' +
      txt(100, 20, "利率↑ 价格↓", UP, 9) +
      txt(150, 68, "收益率", DIM, 8.5, "middle") + txt(4, 14, "价格", DIM, 8.5));
  }
  /* ── 凸性弯曲对比 ── */
  function dgConvexCurve() {
    return dgSvg('<line x1="10" y1="64" x2="196" y2="64" stroke="' + BORDER + '"/>' +
      '<line x1="14" y1="60" x2="60" y2="14" stroke="' + DIM + '" stroke-width="1.4" stroke-dasharray="4 3"/>' +
      '<path d="M14,60 Q60,52 100,30 T190,10" fill="none" stroke="' + TEAL + '" stroke-width="2"/>' +
      txt(120, 24, "实际(弯)", TEAL, 9) + txt(24, 30, "久期(直)", DIM, 9) +
      txt(150, 68, "收益率→", DIM, 8.5));
  }
  /* ── 两线利差带 ── */
  function dgSpreadBand() {
    return dgSvg('<path d="M0,30 C40,32 80,28 120,26 C160,24 180,25 200,24" fill="none" stroke="' + DIM + '" stroke-width="1.5"/>' +
      '<path d="M0,44 C40,46 80,42 120,40 C160,38 180,39 200,38" fill="none" stroke="' + UP + '" stroke-width="1.8"/>' +
      '<polygon points="0,30 40,32 80,28 120,26 160,24 180,25 200,24 200,38 180,39 160,38 120,40 80,42 40,46 0,44" fill="' + UP + '" opacity="0.12"/>' +
      txt(8, 24, "基准(国债)", DIM, 8.5) + txt(8, 56, "信用债", UP, 8.5) +
      txt(140, 34, "利差", UP, 9, undefined, "600"));
  }
  /* ── 环形占比 ── */
  function dgPieRing() {
    var r = 22, cx = 52, cy = 36, C = 2 * Math.PI * r;
    var segs = [[0.55, TEAL], [0.25, BLUE], [0.2, "#f59e0b"]];
    var s = "";
    var off = 0;
    segs.forEach(function (g) {
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + g[1] + '" stroke-width="13" stroke-dasharray="' + (C * g[0]).toFixed(1) + " " + (C * (1 - g[0])).toFixed(1) + '" stroke-dashoffset="' + (-C * off).toFixed(1) + '" transform="rotate(-90 ' + cx + " " + cy + ')"/>';
      off += g[0];
    });
    s += txt(92, 28, "55%", TEAL, 9, undefined, "700") + txt(122, 28, "第一类", DIM, 8.5) +
      txt(92, 44, "25%", BLUE, 9, undefined, "700") + txt(122, 44, "第二类", DIM, 8.5) +
      txt(92, 60, "20%", "#f59e0b", 9, undefined, "700") + txt(122, 60, "其他", DIM, 8.5);
    return dgSvg(s, DG_W, DG_H);
  }
  /* ── 付息时间轴 ── */
  function dgTimelinePay() {
    return dgSvg('<line x1="10" y1="36" x2="190" y2="36" stroke="' + BORDER + '" stroke-width="1.5"/>' +
      arrowDef("tpA", TEAL) + '<line x1="186" y1="36" x2="192" y2="36" stroke="' + TEAL + '" marker-end="url(#tpA)"/>' +
      [[30, "付息日"], [90, "计息中"], [150, "下一付息日"]].map(function (p, i) {
        return '<circle cx="' + p[0] + '" cy="36" r="5" fill="' + (i === 1 ? "#f59e0b" : TEAL) + '"/>' + txt(p[0], 52, p[1], DIM, 8.5, "middle");
      }).join("") +
      txt(90, 22, "应计利息逐日累积", "#f59e0b", 9, "middle", "600"));
  }
  /* ── 折溢价双柱 ── */
  function dgPriceGap() {
    return dgSvg('<rect x="40" y="18" width="40" height="40" rx="3" fill="' + TEAL + '" opacity="0.85"/>' +
      '<rect x="100" y="12" width="40" height="46" rx="3" fill="' + UP + '" opacity="0.8"/>' +
      txt(60, 66, "净值", DIM, 9, "middle") + txt(120, 66, "市价", DIM, 9, "middle") +
      '<line x1="82" y1="16" x2="98" y2="12" stroke="' + UP + '" stroke-dasharray="3 2"/>' +
      txt(146, 30, "溢价 +2%", UP, 10, undefined, "700") + txt(146, 44, "买贵了", DIM, 8.5));
  }
  /* ── 杠杆放大 ── */
  function dgRepoLeverage() {
    return dgSvg('<rect x="20" y="34" width="56" height="24" rx="4" fill="' + TEAL + '" opacity="0.85"/>' +
      '<rect x="80" y="34" width="34" height="24" rx="4" fill="' + BLUE + '" opacity="0.6"/>' +
      txt(48, 49, "自有", "#fff", 9, "middle", "700") + txt(97, 49, "借入", "#fff", 9, "middle", "700") +
      arrowDef("rlA", TEAL) + '<line x1="124" y1="46" x2="148" y2="46" stroke="' + TEAL + '" stroke-width="1.5" marker-end="url(#rlA)"/>' +
      '<rect x="152" y="30" width="40" height="32" rx="4" fill="' + TEAL + '" opacity="0.3"/>' +
      txt(172, 49, "1.4×", TEAL, 12, "middle", "700") + txt(100, 68, "总资产 ÷ 净资产 = 杠杆率", DIM, 8.5, "middle"));
  }
  /* ── 公式卡（PD×LGD×EAD） ── */
  function dgFormulaCard() {
    var boxes = [["PD", TEAL], ["LGD", BLUE], ["EAD", "#f59e0b"]];
    var s = "", x = 8;
    boxes.forEach(function (b, i) {
      s += '<rect x="' + x + '" y="22" width="34" height="24" rx="5" fill="' + b[1] + '" opacity="0.18"/><rect x="' + x + '" y="22" width="34" height="24" rx="5" fill="none" stroke="' + b[1] + '" stroke-width="1.2"/>' +
        txt(x + 17, 37, b[0], b[1], 9.5, "middle", "700");
      x += 34;
      if (i < 2) { s += txt(x + 5, 38, "×", DIM, 13, "middle", "700"); x += 14; }
    });
    s += txt(x + 8, 38, "= ECL", UP, 11, undefined, "700");
    return dgSvg(s + txt(100, 62, "违约率 × 损失率 × 敞口", DIM, 9, "middle"));
  }
  /* ── 定投摊低成本 ── */
  function dgDcaDots() {
    var pts = [[10, 30], [40, 44], [70, 54], [100, 38], [130, 26], [160, 34], [190, 22]];
    var s = '<path d="M' + pts.map(function (p) { return p[0] + "," + p[1]; }).join(" L") + '" fill="none" stroke="' + TEAL + '" stroke-width="1.8"/>';
    pts.forEach(function (p, i) {
      s += '<circle cx="' + p[0] + '" cy="' + (p[1] + 8) + '" r="3.5" fill="' + (p[1] > 40 ? UP : BLUE) + '" opacity="0.85"/>';
    });
    s += txt(50, 14, "跌时买多 ↑", UP, 9) + txt(150, 14, "涨时买少 ↓", BLUE, 9) + txt(100, 68, "固定日期自动买入", DIM, 8.5, "middle");
    return dgSvg(s);
  }

  var DG_MAP = {
    kline: dgKline, bar: dgBar, oscillator: dgOscillator, band: dgBand,
    gauge: dgGauge, spectrum: function () { return dgSpectrum("d"); },
    curve: dgCurve, flow: dgFlow, ma_cross: dgMaCross, nav_curve: dgNavCurve,
    duration_bar: function () { return dgDurationBar(5); },
    rating_ladder: dgRatingLadder, term_structure: dgTermStructure, split_h: dgSplitH,
    growth_bar: dgGrowthBar, waterfall: dgWaterfall, cashflow: dgCashflow,
    debt_stack: dgDebtStack, coverage: dgCoverage, turnover_cycle: dgTurnoverCycle,
    expense_split: dgExpenseSplit, risk_scatter: dgRiskScatter, alpha_scatter: dgAlphaScatter,
    nav_vs_bench: dgNavVsBench, price_ytm: dgPriceYtm, convex_curve: dgConvexCurve,
    spread_band: dgSpreadBand, pie_ring: dgPieRing, timeline_pay: dgTimelinePay,
    price_gap: dgPriceGap, repo_leverage: dgRepoLeverage, formula_card: dgFormulaCard,
    dca_dots: dgDcaDots,
  };
  function dgFor(type) {
    var fn = DG_MAP[type];
    return fn ? fn() : "";
  }

  /* ═══════════ 频率徽标与搜索 ═══════════ */
  function freqChip(idx) {
    if (idx < 8) return '<span class="learn-freq hot">高频</span>';
    if (idx < 20) return '<span class="learn-freq">常用</span>';
    return '<span class="learn-freq adv">进阶</span>';
  }
  function fuzzyMatch(query, item) {
    if (!query) return true;
    var q = query.toLowerCase().replace(/\s+/g, "");
    var hay = (item.n + " " + item.en + " " + (item.cat || "") + " " + (item.one || "") + " " + (item.tags || "")).toLowerCase();
    if (hay.indexOf(q) >= 0) return true;
    if (item.py && item.py.indexOf(q) >= 0) return true;
    /* 多关键词：全部命中才算匹配 */
    var parts = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return parts.every(function (p) { return fuzzyMatch(p, item); });
    return false;
  }

  /* ═══════════ 渲染 ═══════════ */
  function render() {
    var host = $("learnBody");
    if (!host) return;
    var items = LEARN_DATA[activeCat] || [];
    var filtered = items.filter(function (item) { return fuzzyMatch(searchTerm, item); });
    var total = items.length;
    if (!filtered.length) {
      host.innerHTML = '<div class="learn-empty">未找到匹配指标（搜索：' + esc(searchTerm) + ' · 全库 ' + total + ' 条）</div>';
      return;
    }
    var opened = openSet[activeCat] || {};
    var html = '<div class="learn-rows">';
    filtered.forEach(function (item, idx) {
      var isOpen = !!opened[item.n];
      html += '<div class="learn-item' + (isOpen ? " open" : "") + '" data-n="' + esc(item.n) + '">';
      html += '<div class="learn-row" role="button" tabindex="0" aria-expanded="' + isOpen + '">';
      html += '<span class="learn-rank">' + (idx + 1) + "</span>";
      html += '<span class="learn-name">' + esc(item.n) + "</span>";
      html += '<span class="learn-en">' + esc(item.en) + "</span>";
      html += '<span class="learn-cat">' + esc(item.cat || "") + "</span>";
      html += '<span class="learn-one">' + esc(item.one || "") + "</span>";
      html += freqChip(idx);
      html += '<span class="learn-caret">▾</span>';
      html += "</div>";
      if (isOpen) html += detailHtml(item);
      html += "</div>";
    });
    html += "</div>";
    host.innerHTML = html;
  }
  function detailHtml(item) {
    var h = '<div class="learn-detail">';
    h += '<div class="learn-detail-main">';
    h += '<div class="learn-p"><b class="learn-label">第一性原理</b>' + esc(item.p) + "</div>";
    if (item.hi || item.lo) {
      h += '<div class="learn-hl"><span class="learn-label">高低含义</span>' +
        '<span class="learn-hi"><i>高</i>' + esc(item.hi || "--") + "</span>" +
        '<span class="learn-lo"><i>低</i>' + esc(item.lo || "--") + "</span></div>";
    }
    if (item.use) {
      h += '<div class="learn-use"><b class="learn-label use">如何使用</b>' + esc(item.use) + "</div>";
    }
    if (item.lim) {
      h += '<div class="learn-lim"><b class="learn-label lim">局限误区</b>' + esc(item.lim) + "</div>";
    }
    if (item.fx) {
      h += '<div class="learn-fx"><span class="learn-label">计算</span><code>' + esc(item.fx) + "</code></div>";
    }
    h += "</div>";
    var dgHtml = dgFor(item.dg);
    if (dgHtml) {
      h += '<div class="learn-dg-wrap">' + dgHtml + "</div>";
    }
    h += "</div>";
    return h;
  }

  /* ═══════════ 展开/收起（事件委托，动画平滑） ═══════════ */
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
        var det = wrap.querySelector(".learn-detail");
        if (det) {
          det.style.maxHeight = det.scrollHeight + "px";
          requestAnimationFrame(function () {
            det.style.maxHeight = "0";
            det.style.opacity = "0";
            setTimeout(function () { render(); }, 160);
          });
        } else { render(); }
        if (openSet[activeCat]) delete openSet[activeCat][name];
      } else {
        if (!openSet[activeCat]) openSet[activeCat] = {};
        openSet[activeCat][name] = true;
        render();
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

  /* ═══════════ 初始化 ═══════════ */
  document.addEventListener("DOMContentLoaded", function () {
    var pill = document.querySelector('.nav-pill[data-tab="learn"]');
    if (!pill) return;
    pill.addEventListener("click", function () {
      if (!$("learnBody") || !$("learnBody").innerHTML.trim()) render();
    });
    var searchEl = $("learnSearch");
    if (searchEl) {
      var tId = null;
      searchEl.addEventListener("input", function () {
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
    bindRows();
    render();
  });
})();
