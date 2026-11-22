/* ═══════════ 市场全景（市场板块 · 双主题） ═══════════
   数据源：东方财富公开行情接口（push2/push2his，JSONP 直连，无需登录/中继，GitHub Pages 兼容）
   基准日规则：收盘后（15:05 起）统计当日；盘中/午休/盘前/节假日统计最近一个已收盘交易日
   字段实测（与日K交叉验证）：f3 今日涨跌幅 · f7 今日振幅 · f109 近5日 · f160 近10日 · f24 近60日 ·
   f25 年初至今 · f62 主力净流入 · f184 主力净占比 · f164 近5日主力净流入
   基准日窗口校正：含今日的窗口 ÷ (1+今日涨跌幅) = 截至基准日的窗口（代数精确，无漂移）
   近20日无现成字段 → 按各窗口榜单极值并集取候选，逐板块拉日K精确计算（按基准日缓存） */
(function () {
  "use strict";

  var LS_KEY = "hs300.mkt.v4";           // 按基准日缓存聚合结果

  var CLIST_HOSTS = ["push2.eastmoney.com", "33.push2.eastmoney.com", "99.push2.eastmoney.com"];
  var KLINE_HOSTS = ["push2his.eastmoney.com", "33.push2his.eastmoney.com"];
  var EM_UT = "ut=7eea3edcaed734bea9cbfc24409ed989";

  var INDEXES = [
    { key: "sh", secid: "1.000001", tx: "sh000001", name: "上证指数", tag: "沪市" },
    { key: "sz", secid: "0.399001", tx: "sz399001", name: "深证成指", tag: "深市" },
    { key: "cyb", secid: "0.399006", tx: "sz399006", name: "创业板指", tag: "创业板" },
    { key: "kc50", secid: "1.000688", tx: "sh000688", name: "科创50", tag: "科创50" },
    { key: "hs300", secid: "1.000300", tx: "sh000300", name: "沪深300", tag: "宽基" },
  ];

  // 观察个股（市场页底部【个股】部分）：资金流入动向 + 近20日对比
  var STOCKS = [
    { key: "sy", secid: "1.600031", tx: "sh600031", name: "三一重工" },
    { key: "lg", secid: "0.000528", tx: "sz000528", name: "柳工" },
    { key: "admai", secid: "0.000553", tx: "sz000553", name: "安道麦A" },
    { key: "zynp", secid: "0.002448", tx: "sz002448", name: "中原内配" },
    { key: "md", secid: "0.000333", tx: "sz000333", name: "美的集团" },
  ];

  /* ─────────── 估值与定投档位（skill P0：PE十年分位 + ERP + 定投规则） ─────────── */
  var VAL_INDEXES = [
    { key: "sh000300", name: "沪深300", secid: "1.000300" },
    { key: "sh000001", name: "上证指数", secid: "1.000001" },
    { key: "sz399006", name: "创业板指", secid: "0.399006" },
    { key: "sh000688", name: "科创50", secid: "1.000688" },
  ];
  // ETF观察（skill L2：行情/份额变动/折溢价——仅观察资金借道行为，不参与板块强度评分）
  var ETFS = [
    { secid: "1.560280", code: "560280", name: "工程机械ETF", theme: "工程机械" },
    { secid: "0.159870", code: "159870", name: "化工ETF", theme: "化工" },
    { secid: "1.563380", code: "563380", name: "商业航天ETF", theme: "商业航天" },
    { secid: "1.515880", code: "515880", name: "通信ETF", theme: "通信设备" },
    { secid: "1.560710", code: "560710", name: "船舶ETF", theme: "航海装备" },
  ];
  var STOCK_KLINE_FIELDS2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59";   // 标准规范全序（同 KLINE_FIELDS2）
  var STOCK_LINE = ["#0d9488", "#D81B60", "#F9A825", "#5C6BC0", "#EF6C00"];

  var CLIST_FIELDS = "f12,f14,f3,f7,f6,f62,f66,f72,f184,f109,f160,f24,f25,f164,f165,f128,f140,f136,f124";
  var KLINE_FIELDS2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59";   // 标准规范全序：日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅
  var FFLOW_FIELDS2 = "f51,f52,f57";               // 日期,主力净流入额,主力净占比

  var SNAP_V = 4;         // 快照结构版本（写入与读取必须同版本，否则快照永远命中不到）
  var gen = 0;            // 加载代际（强制刷新时作废旧加载）
  var loadingGen = -1;    // 正在进行的加载代际
  var currentBaseDate = null;   // 当前已渲染数据的基准日（自动切换判断用）
  var autoFetchDate = null;     // 收盘后自动切换：当日已尝试标记（幂等防重复）
  var autoFailAt = 0;           // 上次自动尝试失败时间（10分钟冷却后允许重试）

  /* ─────────── 数据源注册表（可在页面切换；不同源保持一致的渲染，缺失数据标注能力边界） ─────────── */
  var PROVIDERS = {
    em:   { label: "东方财富", caps: { boards: true, cloud: true, flow: true, emotion: true, events: true } },
    sina: { label: "新浪财经", caps: { boards: true, cloud: true, flow: false, emotion: false, events: false } },
    tx:   { label: "腾讯行情", caps: { boards: false, cloud: false, flow: false, emotion: false, events: false } },
  };
  var activeProvider = (function () {
    try {
      var p = localStorage.getItem("hs300.mkt.provider");
      return PROVIDERS[p] ? p : "em";
    } catch (e) { return "em"; }
  })();
  function lsKey() { return LS_KEY + "." + activeProvider; }
  function cap() { return PROVIDERS[activeProvider].caps; }
  function capNote(moduleName) {
    return '<div class="mkt-fail">' + esc(PROVIDERS[activeProvider].label) +
      " 数据源不提供" + esc(moduleName) + "数据——切换「东方财富」查看完整版。</div>";
  }

  /* ─────────── 基础工具（通用部分复用 assets/core/util.js） ─────────── */
  var $ = window.Util.$;
  var esc = window.Util.esc;
  var pad2 = window.Util.pad2;
  function bjNow() {
    var parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    var m = {};
    parts.forEach(function (p) { m[p.type] = p.value; });
    var wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(new Date());
    return { y: +m.year, mo: +m.month, d: +m.day, hh: +m.hour, mm: +m.minute, wd: wd,
             date: m.year + "-" + m.month + "-" + m.day, mins: (+m.hour) * 60 + (+m.minute) };
  }
  function isWeekend(wd) { return wd === "Sat" || wd === "Sun"; }
  // 是否已过收盘（工作日 15:05 后）：收盘后基准=当日，否则基准=最近已收盘交易日
  function afterClose(n) {
    n = n || bjNow();
    return !isWeekend(n.wd) && n.mins >= 905;
  }
  // 无网络时的近似基准日（缓存命中判断用；节假日会偏晚→触发重取，K线给出真基准）
  function approxBase() {
    var n = bjNow();
    if (afterClose(n)) return n.date;
    var t = new Date(n.y + "-" + pad2(n.mo) + "-" + pad2(n.d) + "T12:00:00+08:00");
    for (var i = 0; i < 10; i++) {
      t = new Date(t.getTime() - 86400000);
      var wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(t);
      if (!isWeekend(wd)) {
        return t.getUTCFullYear() + "-" + pad2(t.getUTCMonth() + 1) + "-" + pad2(t.getUTCDate());
      }
    }
    return n.date;
  }

  function num(v) {
    if (v === null || v === undefined || v === "-" || v === "") return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  function ymdShift(days) {
    var d = new Date(Date.now() + days * 86400000);
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }
  // 带横线日期位移（datacenter 过滤用）：dashShift("2026-11-19", -4) → "2026-11-15"
  function dashShift(dateStr, days) {
    var t = new Date(dateStr + "T12:00:00+08:00");
    t = new Date(t.getTime() + days * 86400000);
    return t.getUTCFullYear() + "-" + pad2(t.getUTCMonth() + 1) + "-" + pad2(t.getUTCDate());
  }
  function fmtPct(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return "--";
    var s = v.toFixed(digits === undefined ? 2 : digits);
    if (v > 0) s = "+" + s;
    return s + "%";
  }
  function fmtYi(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return "--";
    return (v / 1e8).toFixed(digits === undefined ? 2 : digits) + "亿";
  }
  function fmtClock(ts) {
    if (!ts) return "--";
    var d = new Date(ts);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function pctCls(v) {
    if (v === null || v === undefined || isNaN(v) || v === 0) return "mkt-dim-num";
    return v > 0 ? "mkt-num-up" : "mkt-num-down";
  }
  function tag(type) {
    if (type === "idx") return '<span class="mkt-tag mkt-tag-idx">指数</span>';
    return type === "ind" ? '<span class="mkt-tag mkt-tag-ind">行业</span>' : '<span class="mkt-tag mkt-tag-con">题材</span>';
  }

  /* ─────────── JSONP 通道（镜像轮换 + 节奏 + 退避重试） ─────────── */
  var jsonpSeq = 0;
  function jsonpOnce(host, path, timeout, cbParam) {
    return new Promise(function (resolve, reject) {
      var cbName = "__mkt" + (++jsonpSeq) + "_" + (Date.now() % 100000);
      var cbKey = cbParam || "cb";
      var url = "https://" + host + path + (path.indexOf("?") >= 0 ? "&" : "?") + cbKey + "=" + cbName;
      window.__mktLastUrl = url;   // 调试：最近一次JSONP请求URL
      var s = document.createElement("script");
      var done = false;
      var to = setTimeout(function () {
        if (done) return;
        done = true; cleanup(); reject(new Error("timeout"));
      }, timeout || 15000);
      function cleanup() {
        clearTimeout(to);
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[cbName] = function (data) {
        if (done) return;
        done = true; clearTimeout(to); cleanup();
        resolve(data);
      };
      s.onerror = function () {
        if (done) return;
        done = true; clearTimeout(to); cleanup();
        reject(new Error("error"));
      };
      s.src = url;
      document.head.appendChild(s);
    });
  }
  function makePacer(gap) {
    var next = 0;
    return function () {
      var now = Date.now();
      var slot = Math.max(now, next);
      next = slot + gap;
      return new Promise(function (res) {
        setTimeout(res, slot - now + Math.floor(Math.random() * 40));
      });
    };
  }
  var pace = makePacer(150);   // 约 6.7 请求/秒上限，配合镜像轮换与退避重试降低限流触发
  // 带主机轮换 + 退避重试的 JSONP；path 为接口路径与查询串（不含 cb）；cbParam=JSONP参数名（默认 cb，datacenter 用 callback）
  function fetchJsonp(path, hosts, tries, cbParam) {
    var attempt = 0;
    function run() {
      attempt++;
      var host = hosts[(attempt - 1) % hosts.length];
      return pace().then(function () {
        return jsonpOnce(host, path, 15000, cbParam);
      }).catch(function (e) {
        if (attempt < (tries || 3)) {
          return new Promise(function (res) { setTimeout(res, 500 * attempt + 300); }).then(run);
        }
        throw e;
      });
    }
    return run();
  }

  /* ─────────── 数据拉取 ─────────── */
  // 板块清单（分页直到取满 total）
  function fetchBoards(fs, onProgress) {
    var out = [];
    var total = Infinity;
    var pn = 1;
    function page() {
      if ((pn - 1) * 100 >= total) return Promise.resolve();
      var path = "/api/qt/clist/get?pn=" + pn + "&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=" + fs +
        "&fields=" + CLIST_FIELDS;
      return fetchJsonp(path, CLIST_HOSTS).then(function (d) {
        var data = d && d.data;
        if (!data || !data.diff || !data.diff.length) return;
        total = data.total || out.length;
        data.diff.forEach(function (r) { out.push(r); });
        if (onProgress) onProgress(out.length, total);
        pn++;
        return page();
      });
    }
    return page().then(function () { return out; });
  }

  // 日K → [{date, open, close, high, low, amount, amp, pct}]（标准规范全序解析）
  function fetchKline(secid, beg) {
    var path = "/api/qt/stock/kline/get?secid=" + secid +
      "&fields1=f1,f2,f3&fields2=" + KLINE_FIELDS2 + "&klt=101&fqt=1&beg=" + beg + "&end=20500101";
    return fetchJsonp(path, KLINE_HOSTS).then(function (d) {
      var klines = d && d.data && d.data.klines || [];
      var bars = [];
      for (var i = 0; i < klines.length; i++) {
        var p = klines[i].split(",");
        bars.push({ date: p[0], open: parseFloat(p[1]), close: parseFloat(p[2]), high: parseFloat(p[3]), low: parseFloat(p[4]),
                    amount: parseFloat(p[6]), amp: parseFloat(p[7]), pct: parseFloat(p[8]) });
      }
      return bars;
    });
  }

  // 板块资金流日K → [{date, mf, mr}]
  function fetchFflow(secid) {
    var path = "/api/qt/stock/fflow/daykline/get?lmt=40&klt=101&secid=" + secid +
      "&fields1=f1,f2,f3,f7&fields2=" + FFLOW_FIELDS2;
    return fetchJsonp(path, KLINE_HOSTS).then(function (d) {
      var klines = d && d.data && d.data.klines || [];
      var bars = [];
      for (var i = 0; i < klines.length; i++) {
        var p = klines[i].split(",");
        bars.push({ date: p[0], mf: parseFloat(p[1]), mr: parseFloat(p[2]) });
      }
      return bars;
    });
  }

  /* ─────────── 腾讯行情降级源（设计文档：主源失败时用腾讯行情补指数快照） ───────────
     qt.gtimg.cn 快照（GBK script，数字字段 ASCII 安全，已实测 [37]/1e4=成交额亿）；
     web.ifzq.gtimg.cn 日K（CORS 开放 ACAL:*，实测可用）。 */
  /* ─────────── 估值与定投档位数据层 ─────────── */
  var VAL_SNAP_KEY = "hs300.mkt.valsnap.v1";
  var VAL_INDEXES = [
    { tx: "sh000300", name: "沪深300", secid: "1.000300" },
    { tx: "sh000001", name: "上证指数", secid: "1.000001" },
    { tx: "sz399006", name: "创业板指", secid: "0.399006" },
    { tx: "sh000688", name: "科创50", secid: "1.000688" },
  ];
  // 腾讯快照批量获取指数PE-TTM/股息率（field [39]=PE-TTM / [49]=股息率%，已验证）
  function fetchValQuotes() {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; s.remove(); resolve({}); } }, 10000);
      s.src = "https://qt.gtimg.cn/q=" + VAL_INDEXES.map(function (ix) { return ix.tx; }).join(",");
      s.onload = function () {
        if (done) return;
        done = true; clearTimeout(to); s.remove();
        var out = {};
        VAL_INDEXES.forEach(function (ix) {
          try {
            var raw = window["v_" + ix.tx];
            if (typeof raw !== "string") return;
            var p = raw.split("~");
            out[ix.tx] = { pe: num(p[39]), dy: num(p[49]) };
          } catch (e) {}
        });
        resolve(out);
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); s.remove(); resolve({}); } };
      document.head.appendChild(s);
    });
  }
  // 中国货币网 10Y 国债收益率（GET 格式，已验证返回 total>0）
  function fetch10YYield() {
    var url = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/ClsYldCurvHis?lang=CN&reference=1&bondType=CYCC000&termId=10&pageSize=5&pageNum=1";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var data = d && d.data || {};
        var records = data.records || [];
        if (!records.length) return null;
        var last = records[records.length - 1];
        var yld = null;
        for (var k in last) {
          if (typeof last[k] === "number" && last[k] > 1 && last[k] < 8) { yld = last[k]; break; }
        }
        return yld !== null ? { yield: yld, date: data.endDateCN || "" } : null;
      }).catch(function () { return null; });
  }

  function fetchTxAmounts() {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; s.remove(); resolve(null); } }, 10000);
      s.src = "https://qt.gtimg.cn/q=" + INDEXES.map(function (ix) { return ix.tx; }).join(",");
      s.onload = function () {
        if (done) return;
        done = true; clearTimeout(to); s.remove();
        var out = {};
        INDEXES.forEach(function (ix) {
          try {
            var raw = window["v_" + ix.tx];
            if (typeof raw !== "string") return;
            var p = raw.split("~");
            var closeN = parseFloat(p[3]), pctN = parseFloat(p[32]), amtN = parseFloat(p[37]);
            out[ix.tx] = {
              close: isNaN(closeN) ? null : closeN,
              pct: isNaN(pctN) ? null : pctN,
              amtYi: isNaN(amtN) ? null : amtN / 1e4,   // 万元 → 亿
            };
          } catch (e) {}
        });
        resolve(out);
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); s.remove(); resolve(null); } };
      document.head.appendChild(s);
    });
  }
  function fetchTxKline(txCode) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
    return fetch("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + txCode + ",day,,,60,qfq",
      ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        var node = j && j.data && j.data[txCode] || {};
        var days = node.day || node.qfqday || [];
        var bars = [];
        for (var i = 0; i < days.length; i++) {
          bars.push({ date: days[i][0], open: parseFloat(days[i][1]), close: parseFloat(days[i][2]), high: parseFloat(days[i][3]), low: parseFloat(days[i][4]) });
        }
        return bars;
      }).catch(function (e) { clearTimeout(to); throw e; });
  }

  /* ─────────── 情绪温度（涨停/跌停/炸板池，push2ex 独立主机，CORS+JSONP 均开放） ─────────── */
  function fetchEmotionPool(type, dateNum) {
    var path = "/getTopic" + type + "Pool?" + EM_UT +
      "&dpt=wz.ztzt&Pageindex=0&pagesize=320&sort=fbt%3Aasc&date=" + dateNum;
    return fetchJsonp(path, ["push2ex.eastmoney.com"]).then(function (d) {
      var data = d && d.data;
      var pool = data && data.pool || [];
      var maxLb = 0, lbN = 0;
      pool.forEach(function (r) {
        var lbc = num(r.lbc) || 0;
        if (lbc > maxLb) maxLb = lbc;
        if (lbc >= 2) lbN++;
      });
      return { total: num(data && data.tc), maxLb: maxLb, lbN: lbN, n: pool.length };
    });
  }
  function fetchEmotion(baseDate) {
    var dateNum = baseDate.replace(/-/g, "");
    return Promise.all([
      fetchEmotionPool("ZT", dateNum),
      fetchEmotionPool("DT", dateNum).catch(function () { return null; }),
      fetchEmotionPool("ZB", dateNum).catch(function () { return null; }),
    ]).then(function (r) {
      var zt = r[0], dt = r[1], zb = r[2];
      var emo = { zt: zt && zt.total, dt: dt && dt.total, zb: zb && zb.total,
                  maxLb: zt && zt.maxLb, lbN: zt && zt.lbN };
      emo.zbRate = (emo.zt !== null && emo.zb !== null && (emo.zt + emo.zb) > 0)
        ? emo.zb / (emo.zt + emo.zb) * 100 : null;
      return emo;
    });
  }

  /* ─────────── 市场广度（指数上涨/下跌家数 f104/f105/f106，带合法性守卫） ─────────── */
  function fetchIndexBreadth() {
    return Promise.all(INDEXES.map(function (ix) {
      return fetchJsonp("/api/qt/stock/get?secid=" + ix.secid + "&" + EM_UT + "&fields=f104,f105,f106", CLIST_HOSTS)
        .then(function (d) {
          var r = d && d.data || {};
          var up = num(r.f104), down = num(r.f105), flat = num(r.f106) || 0;
          var total = (up || 0) + (down || 0) + (flat || 0);
          if (up === null || down === null || total < 20 || total > 6000) return { ix: ix, pct: null };
          return { ix: ix, pct: up / total * 100, up: up, down: down, flat: flat };
        }).catch(function () { return { ix: ix, pct: null }; });
    }));
  }

  /* ─────────── 大盘云图（行业板块 × 个股涨跌 treemap） ─────────── */
  function pctColor(p) {
    if (p === null || p === undefined || isNaN(p)) return "#c9cfda";   // 灰：停牌/平盘/无数据
    if (p > 0) {
      if (p >= 7) return "#a51c1c";
      if (p >= 3) return "#d8434a";
      if (p >= 1) return "#ec7d7d";
      return "#f6baba";
    }
    if (p < 0) {
      if (p <= -7) return "#0c7a3e";
      if (p <= -3) return "#1fa363";
      if (p <= -1) return "#5cc08d";
      return "#aedcc0";
    }
    return "#c9cfda";
  }
  function pctText(p) {
    if (p === null || p === undefined || isNaN(p)) return "#26314a";
    return Math.abs(p) >= 3 ? "#ffffff" : "#26314a";
  }
  // squarified treemap：items 按值降序，v 已缩放为目标面积
  function treemapSquarify(items, x, y, w, h, out) {
    var rest = items.slice();
    function worstRatio(row, len) {
      var s = 0, wst = 0;
      row.forEach(function (it) { s += it.v; });
      if (s <= 0 || len <= 0) return Infinity;
      var th = s / len;
      row.forEach(function (it) {
        var wi = it.v / th;
        if (wi <= 0) { wst = Infinity; return; }
        wst = Math.max(wst, Math.max(th / wi, wi / th));
      });
      return wst;
    }
    while (rest.length) {
      // 残余区域过小时，剩余节点以最小可见方块堆叠（保证全部节点都被放置）
      if (w <= 0.01 || h <= 0.01) {
        rest.forEach(function (it) {
          out.push({ d: it.d, x: x, y: y, w: Math.max(1, w), h: Math.max(1, h) });
        });
        break;
      }
      var row = [rest.shift()];
      var rowArea = row[0].v;
      var len = Math.max(w, h);
      while (rest.length) {
        var row2 = row.concat([rest[0]]);
        if (worstRatio(row2, len) <= worstRatio(row, len)) {
          row = row2;
          rowArea += rest.shift().v;
        } else break;
      }
      rowArea = row.reduce(function (s2, it) { return s2 + it.v; }, 0);
      if (w >= h) {
        var rh = rowArea / w;
        var cx = x;
        row.forEach(function (it) {
          var rw = rowArea > 0 ? it.v / rh : 0;
          out.push({ d: it.d, x: cx, y: y, w: Math.min(rw, x + w - cx), h: rh });
          cx += rw;
        });
        y += rh; h -= rh;
      } else {
        var rw2 = rowArea / h;
        var cy = y;
        row.forEach(function (it) {
          var rh2 = rowArea > 0 ? it.v / rw2 : 0;
          out.push({ d: it.d, x: x, y: cy, w: rw2, h: Math.min(rh2, y + h - cy) });
          cy += rh2;
        });
        x += rw2; w -= rw2;
      }
    }
    return out;
  }
  // 板块成分股（fs=b:BKxxxx，含涨跌幅与流通市值）
  function fetchBoardConstituents(code) {
    var out = [], total = Infinity, pn = 1;
    function page() {
      if ((pn - 1) * 500 >= total) return Promise.resolve();
      var path = "/api/qt/clist/get?pn=" + pn + "&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:" + code +
        "&fields=f12,f14,f3,f21";
      return fetchJsonp(path, CLIST_HOSTS).then(function (d) {
        var data = d && d.data;
        if (!data || !data.diff || !data.diff.length) return;
        total = data.total || out.length;
        data.diff.forEach(function (r) {
          out.push({ c: r.f12, n: r.f14, p: num(r.f3), cap: num(r.f21) });
        });
        pn++;
        return page();
      });
    }
    return page().then(function () { return out; });
  }
  function fetchCloud(state, stale) {
    var codes = Object.keys(state.boards).filter(function (c) { return state.boards[c].type === "ind"; });
    var total = codes.length, done = 0;
    var boards = [];
    function work() {
      if (stale()) return Promise.resolve();
      if (!codes.length) return Promise.resolve();
      var code = codes.shift();
      var b = state.boards[code];
      return fetchBoardConstituents(code).then(function (stocks) {
        var valid = [], totalCap = 0;
        stocks.forEach(function (s2) {
          if (s2.cap !== null && s2.cap > 0) { valid.push(s2); totalCap += s2.cap; }
        });
        if (valid.length >= 2 && totalCap > 0) {
          boards.push({
            code: code, name: b.name,
            pct: (b.basePct !== null && b.basePct !== undefined) ? b.basePct : b.f3,
            stocks: valid, totalCap: totalCap,
          });
        }
      }).catch(function () {}).then(function () {
        done++;
        chipText("云图板块成分 " + done + "/" + total + " …", true);
        return work();
      });
    }
    var workers = [];
    for (var w = 0; w < 4; w++) workers.push(work());
    return Promise.all(workers).then(function () {
      boards.sort(function (a, b) { return b.totalCap - a.totalCap; });
      return { boards: boards };
    });
  }

  /* ─────────── 事件与风险雷达（datacenter-web：龙虎榜 / 解禁 / 业绩预告，实测可用） ─────────── */
  var DC_HOSTS = ["datacenter-web.eastmoney.com"];
  function dcFilter(s) { return encodeURIComponent(s); }
  function fmtRange(lo, hi, unit) {
    if (lo === null && hi === null) return "--";
    var f = function (v) { return v === null ? "--" : fmtYi(v, 1).replace(/^0\.00$/, "0"); };
    var pre = unit || "";
    if (lo !== null && hi !== null && lo === hi) return pre + fmtYi(lo, 1);
    return (lo === null ? "--" : pre + fmtYi(lo, 1)) + " ~ " + (hi === null ? "--" : pre + fmtYi(hi, 1));
  }
  function fetchEvents(baseDate) {
    var dFrom = dashShift(baseDate, -4);
    var liftFrom = bjNow().date, liftTo = dashShift(liftFrom, 30);
    var yjFrom = dashShift(baseDate, -3);
    var lhbCols = "SECURITY_NAME_ABBR,SECURITY_CODE,TRADE_DATE,CHANGE_RATE,BILLBOARD_NET_AMT,EXPLANATION,D1_CLOSE_ADJCHRATE";
    var lhbBase = "/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=" + lhbCols +
      "&filter=" + dcFilter("(TRADE_DATE>='" + dFrom + "')(TRADE_DATE<='" + baseDate + "')");
    var liftP = fetchJsonp("/api/data/v1/get?reportName=RPT_LIFT_STAGE&columns=SECURITY_NAME_ABBR,SECURITY_CODE,FREE_DATE,LIFT_MARKET_CAP,FREE_SHARES_TYPE,B20_ADJCHRATE&filter=" +
      dcFilter("(FREE_DATE>='" + liftFrom + "')(FREE_DATE<='" + liftTo + "')") +
      "&sortColumns=LIFT_MARKET_CAP&sortTypes=-1&pageSize=10&pageNumber=1", DC_HOSTS, 2, "callback").then(function (d) {
        var rows = d && d.result && d.result.data || [];
        return rows.map(function (r) {
          return { name: r.SECURITY_NAME_ABBR, date: String(r.FREE_DATE || "").slice(0, 10),
                   capYi: num(r.LIFT_MARKET_CAP) !== null ? num(r.LIFT_MARKET_CAP) * 1e4 : null,   // 万元 → 元（fmtYi 统一按元口径；交行 1.153e11 元 = 1153亿 已验证）
                   type: r.FREE_SHARES_TYPE || "--", b20: num(r.B20_ADJCHRATE) };
        });
      });
    var yjP = fetchJsonp("/api/data/v1/get?reportName=RPT_PUBLIC_OP_NEWPREDICT&columns=SECURITY_NAME_ABBR,SECURITY_CODE,NOTICE_DATE,PREDICT_TYPE,PREDICT_AMT_LOWER,PREDICT_AMT_UPPER,ADD_AMP_LOWER,ADD_AMP_UPPER,REPORT_DATE&filter=" +
      dcFilter("(NOTICE_DATE>='" + yjFrom + "')") +
      "&sortColumns=ADD_AMP_UPPER&sortTypes=-1&pageSize=8&pageNumber=1", DC_HOSTS, 2, "callback").then(function (d) {
        var rows = d && d.result && d.result.data || [];
        return rows.map(function (r) {
          return { name: r.SECURITY_NAME_ABBR, type: r.PREDICT_TYPE || "--",
                   lo: num(r.PREDICT_AMT_LOWER), hi: num(r.PREDICT_AMT_UPPER),
                   ampLo: num(r.ADD_AMP_LOWER), ampHi: num(r.ADD_AMP_UPPER),
                   notice: String(r.NOTICE_DATE || "").slice(0, 10) };
        });
      });
    var lhbBuyP = fetchJsonp(lhbBase + "&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1&pageSize=8&pageNumber=1", DC_HOSTS, 2, "callback").then(function (d) {
      var rows = d && d.result && d.result.data || [];
      return rows.map(function (r) {
        return { name: r.SECURITY_NAME_ABBR, net: num(r.BILLBOARD_NET_AMT), chg: num(r.CHANGE_RATE),
                 why: r.EXPLANATION || "--", d1: num(r.D1_CLOSE_ADJCHRATE), date: String(r.TRADE_DATE || "").slice(0, 10) };
      });
    });
    var lhbSellP = fetchJsonp(lhbBase + "&sortColumns=BILLBOARD_NET_AMT&sortTypes=1&pageSize=8&pageNumber=1", DC_HOSTS, 2, "callback").then(function (d) {
      var rows = d && d.result && d.result.data || [];
      return rows.map(function (r) {
        return { name: r.SECURITY_NAME_ABBR, net: num(r.BILLBOARD_NET_AMT), chg: num(r.CHANGE_RATE),
                 why: r.EXPLANATION || "--", d1: num(r.D1_CLOSE_ADJCHRATE), date: String(r.TRADE_DATE || "").slice(0, 10) };
      });
    });
    return Promise.allSettled([lhbBuyP, lhbSellP, liftP, yjP]).then(function (r) {
      return {
        lhbBuy: r[0].status === "fulfilled" ? r[0].value : [],
        lhbSell: r[1].status === "fulfilled" ? r[1].value : [],
        lift: r[2].status === "fulfilled" ? r[2].value : [],
        yjyg: r[3].status === "fulfilled" ? r[3].value : [],
        fail: r.filter(function (x) { return x.status === "rejected"; }).length,
        failMsgs: r.filter(function (x) { return x.status === "rejected"; })
          .map(function (x) { return String((x.reason && x.reason.message) || x.reason).slice(0, 80); }),
      };
    });
  }

  /* ─────────── 新浪财经数据源（板块清单 GBK 经中继解码 / 成分股 CORS 直连 / 日K var包装script） ─────────── */
  // Pages部署态无中继：新浪板块清单用内嵌配置降级（代码+名称，行情数据由 getHQNodeData 成分股补齐）
  var SINA_BOARDS_EMBED = [
    ["new_blhy","玻璃行业"],["new_cbzz","船舶制造"],["new_cmyl","传媒娱乐"],["new_dlhy","电力行业"],
    ["new_dqhy","电器行业"],["new_dzqj","电子器件"],["new_dzxx","电子信息"],["new_fdc","房地产"],
    ["new_fdsb","发电设备"],["new_fjzz","飞机制造"],["new_fzhy","纺织行业"],["new_gdjc","钢铁行业"],
    ["new_gfdq","家电行业"],["new_glhz","公路桥梁"],["new_hbhy","环保行业"],["new_hghy","化工行业"],
    ["new_hlgt","航空航天"],["new_hyjc","医疗器械"],["new_jdsh","酒店旅游"],["new_jzzz","建筑建材"],
    ["new_jjxj","酒类饮料"],["new_jtys","交通运输"],["new_lsgy","供水供气"],["new_mtcj","煤炭开采"],
    ["new_nyl","农林牧渔"],["new_qt","其他行业"],["new_qtxj","汽车制造"],["new_shqj","商业百货"],
    ["new_shyb","石油行业"],["new_snsb","水泥行业"],["new_swzc","生物制药"],["new_txyy","通信行业"],
    ["new_txjx","通用机械"],["new_wlyl","网络游戏"],["new_wzgy","物资外贸"],["new_xhzs","化纤行业"],
    ["new_xny","新能源"],["new_xxjp","食品行业"],["new_yqyb","仪器仪表"],["new_ysjs","有色金属"],
    ["new_zhhy","综合行业"],["new_zzhy","造纸行业"],["new_zzjg","专用设备"],["new_zzhz","装修装饰"],
    ["new_dq","电器行业"],["new_jsjx","机械制造"],["new_jzyx","建筑建材"],["new_jxjx","机械行业"],
  ];
  function fetchSinaBoards() {
    var target = encodeURIComponent("https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php");
    return fetch("/api/east?u=" + target)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) {
        var text = new TextDecoder("gbk").decode(buf);
        if (text.indexOf("S_Finance_bankuai") < 0) throw new Error("no-data");
        var m = text.match(/=\s*(\{[\s\S]*\})/);
        if (!m) throw new Error("sina format");
        var obj = JSON.parse(m[1]);
        var out = [];
        Object.keys(obj).forEach(function (k) {
          var p = String(obj[k]).split(",");
          if (p.length < 13) return;
          out.push({ code: p[0], name: p[1], f3: num(p[5]), amt: num(p[6]),
                     leader: p[12] || "--", leaderPct: num(p[9]) });
        });
        return out;
      })
      .catch(function () {
        // Pages部署态无中继 → 内嵌配置降级（板块涨跌幅由成分股补齐）
        return SINA_BOARDS_EMBED.map(function (r) {
          return { code: r[0], name: r[1], f3: null, amt: null, leader: "--", leaderPct: null };
        });
      });
  }
  function parseSinaBoardsText(text) {
    var m = text.match(/=\s*(\{[\s\S]*\})/);
    if (!m) throw new Error("sina format");
    var obj = JSON.parse(m[1]);
    var out = [];
    Object.keys(obj).forEach(function (k) {
      var p = String(obj[k]).split(",");
      if (p.length < 13) return;
      out.push({ code: p[0], name: p[1], f3: num(p[5]), amt: num(p[6]),
                 leader: p[12] || "--", leaderPct: num(p[9]) });
    });
    return out;
  }
  function fetchSinaConstituents(node) {
    // 流通市值 nmc 单位为万元 → 统一转元
    return fetch("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?node=" +
        node + "&page=1&num=100&sort=amount&asc=0")
      .then(function (r) { return r.json(); })
      .then(function (arr) {
        var out = [];
        (arr || []).forEach(function (r) {
          out.push({ c: r.code, n: r.name, p: num(r.changepercent),
                     cap: num(r.nmc) !== null ? num(r.nmc) * 1e4 : null });
        });
        return out;
      });
  }
  function fetchSinaKline(symbol) {
    var cbName = "__snk" + (++jsonpSeq) + "_" + (Date.now() % 100000);
    var url = "https://quotes.sina.cn/cn/api/jsonp_v2.php/" + cbName +
      "/CN_MarketDataService.getKLineData?symbol=" + symbol + "&scale=240&ma=no&datalen=60";
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; s.remove(); reject(new Error("timeout")); } }, 12000);
      window[cbName] = function (arr) {
        if (done) return;
        done = true; clearTimeout(to); s.remove();
        var bars = [];
        (arr || []).forEach(function (r) {
          bars.push({ date: r.day, open: parseFloat(r.open), close: parseFloat(r.close),
                      high: parseFloat(r.high), low: parseFloat(r.low) });
        });
        resolve(bars);
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); s.remove(); reject(new Error("error")); } };
      s.src = url;
      document.head.appendChild(s);
    });
  }

  /* ─────────── 基准日与窗口计算 ─────────── */
  // 各数据源共用的指数处理：基准日判定（以第1个指数K线为准）+ 指数窗口统计 + OHLC
  function processIndexes(state, idxResults) {
    var sh = idxResults[0];
    if (sh && sh.bars.length) {
      var base = resolveBase(sh.bars);
      state.baseDate = base.baseDate;
      state.indexes = idxResults.map(function (r) {
        var bars = r.bars;
        var closes = [];
        bars.forEach(function (b) { closes.push(b.close); });
        var bi = -1;
        var i;
        for (i = bars.length - 1; i >= 0; i--) { if (bars[i].date === state.baseDate) { bi = i; break; } }
        if (bi < 0) bi = bars.length - 1;
        var d0 = num(bars[bi].pct);
        if (d0 === null && bi > 0 && closes[bi - 1]) d0 = (closes[bi] / closes[bi - 1] - 1) * 100;   // 腾讯/新浪降级源无pct字段
        var ohlc = [];
        for (var oi = Math.max(0, bi - 19); oi <= bi; oi++) {
          ohlc.push({ o: bars[oi].open, h: bars[oi].high, l: bars[oi].low, c: bars[oi].close });
        }
        return {
          ix: r.ix,
          close: closes[bi],
          d0: d0,
          w5: winPct(closes, bi, 5),
          w20: winPct(closes, bi, 20),
          spark: closes.slice(Math.max(0, bi - 19), bi + 1),
          ohlc: ohlc,
        };
      });
    } else {
      // 指数K线不可用（K线接口限流）→ 基准日退化为近似值（节假日口径可能偏差一天），指数表降级
      state.baseDate = approxBase();
      state.indexes = [];
      state.idxKlineFail = true;
    }
  }

  // 从日K确定基准日（bars 含今日盘中bar且未收盘时，剔除今日）
  function resolveBase(bars) {
    var today = bjNow().date;
    var n = bars.length;
    var baseIdx = n - 1;
    if (n > 1 && bars[n - 1].date === today && !afterClose()) baseIdx = n - 2;
    return { baseDate: bars[baseIdx].date, baseIdx: baseIdx };
  }
  function winPct(closes, baseIdx, n) {
    var i = baseIdx - n;
    if (i < 0 || !closes[baseIdx] || !closes[i]) return null;
    return (closes[baseIdx] / closes[i] - 1) * 100;
  }

  /* ─────────── 观察个股（市场页底部【个股】部分） ─────────── */
  // 个股日K（含成交额 f57；东财主源，空/失败→腾讯降级，降级序列无 amount/amp 由聚合层兜底）
  function fetchStockKline(secid, tx) {
    var path = "/api/qt/stock/kline/get?secid=" + secid +
      "&fields1=f1,f2,f3&fields2=" + STOCK_KLINE_FIELDS2 + "&klt=101&fqt=1&beg=" + ymdShift(-420) + "&end=20500101";
    return fetchJsonp(path, KLINE_HOSTS).then(function (d) {
      var klines = d && d.data && d.data.klines || [];
      var bars = [];
      for (var i = 0; i < klines.length; i++) {
        var p = klines[i].split(",");
        bars.push({ date: p[0], open: parseFloat(p[1]), close: parseFloat(p[2]), high: parseFloat(p[3]), low: parseFloat(p[4]),
                    amount: parseFloat(p[6]), amp: parseFloat(p[7]), pct: parseFloat(p[8]) });
      }
      if (bars.length) return bars;
      return fetchTxKline(tx);
    }).catch(function () {
      return fetchTxKline(tx);
    });
  }
  // 个股聚合：价格窗口 + 资金流持续性与动向序列
  function aggStock(state, key, kbars, fbars) {
    var st = state.stocks[key];
    if (!st || !kbars || !kbars.length) return;
    var closes = [];
    kbars.forEach(function (b) { closes.push(b.close); });
    var bi = -1;
    for (var i = kbars.length - 1; i >= 0; i--) { if (kbars[i].date === state.baseDate) { bi = i; break; } }
    if (bi < 0) bi = kbars.length - 1;
    st.close = closes[bi];
    st.d0 = num(kbars[bi].pct);
    if (st.d0 === null && bi > 0 && closes[bi - 1]) st.d0 = (closes[bi] / closes[bi - 1] - 1) * 100;
    st.w5 = winPct(closes, bi, 5);
    st.w20 = winPct(closes, bi, 20);
    st.amountYi = (kbars[bi].amount && !isNaN(kbars[bi].amount)) ? kbars[bi].amount / 1e8 : null;
    st.cmp = closes.slice(Math.max(0, bi - 20), bi + 1);
    st.dates = [];
    for (var d = Math.max(0, bi - 20); d <= bi; d++) st.dates.push(kbars[d].date);
    st.ok = true;
    // 六维性价比输入：MA/RSI/52周位置（由本股K线一次算成，只落结果不落序列）
    var tech = { ma20: null, ma60: null, rsi12: null, pos52: null, hi52: null, lo52: null };
    if (closes.length >= 20) {
      var s20 = 0;
      for (var m1 = closes.length - 20; m1 < closes.length; m1++) s20 += closes[m1];
      tech.ma20 = s20 / 20;
    }
    if (closes.length >= 60) {
      var s60 = 0;
      for (var m2 = closes.length - 60; m2 < closes.length; m2++) s60 += closes[m2];
      tech.ma60 = s60 / 60;
    }
    if (closes.length >= 14) {
      var upS = 0, dnS = 0;
      for (var m3 = closes.length - 13; m3 < closes.length; m3++) {
        var chg = closes[m3] - closes[m3 - 1];
        if (chg > 0) upS += chg; else dnS -= chg;
      }
      tech.rsi12 = (upS + dnS) > 0 ? upS / (upS + dnS) * 100 : 50;
    }
    var hh52 = -Infinity, ll52 = Infinity;
    closes.forEach(function (x) { if (x > hh52) hh52 = x; if (x < ll52) ll52 = x; });
    if (hh52 > ll52 && st.close !== null && !isNaN(st.close)) {
      tech.hi52 = hh52; tech.lo52 = ll52;
      tech.pos52 = (st.close - ll52) / (hh52 - ll52) * 100;
    }
    st.tech = tech;
    if (!fbars || !fbars.length) return;
    var fj = -1;
    for (var j = fbars.length - 1; j >= 0; j--) { if (fbars[j].date === state.baseDate) { fj = j; break; } }
    if (fj < 0) fj = fbars.length - 1;
    st.baseMf = fbars[fj].mf;
    st.baseMr = num(fbars[fj].mr);
    // 连续同向天数（正=连续净流入，负=连续净流出）
    var streak = 0;
    for (var k = fj; k >= 0; k--) {
      var v = fbars[k].mf;
      if (v === null || isNaN(v)) break;
      if (streak === 0) {
        if (v > 0) streak = 1;
        else if (v < 0) streak = -1;
        else break;
      } else if (streak > 0 && v > 0) streak++;
      else if (streak < 0 && v < 0) streak--;
      else break;
    }
    st.flowStreak = streak;
    // 近20日每日主力净额序列（红绿柱）+ 5日/20日累计
    var series = [], s5 = 0, s20 = 0, n5 = 0, n20 = 0;
    for (var m = fj; m >= 0 && n20 < 20; m--, n20++) {
      var v2 = fbars[m].mf;
      var val = (v2 !== null && !isNaN(v2)) ? v2 : 0;
      series.unshift(val);
      if (n5 < 5) { s5 += val; n5++; }
      s20 += val;
    }
    st.mfSeries = series;
    st.mf5sum = s5;
    st.mf20sum = s20;
  }

  /* ─────────── 页面骨架 ─────────── */
  function skelBars(n) {
    var s = "";
    for (var i = 0; i < n; i++) s += '<span class="mkt-skel-bar" style="width:' + (55 + (i * 13) % 40) + '%"></span>';
    return s;
  }
  function skelCard(n) {
    var s = "";
    for (var i = 0; i < n; i++) {
      s += '<div class="mkt-card"><h4><span class="mkt-skel-bar" style="width:40%"></span></h4>' +
        '<div class="mkt-skel mkt-skel-rows">' + skelBars(5) + "</div></div>";
    }
    return s;
  }
  function mktBlock(title, dim, inner) {
    return '<section class="mkt-block"><h3 class="mkt-sec-title">' + esc(title) +
      '<span class="mkt-dim">' + esc(dim || "") + "</span></h3>" + inner + "</section>";
  }
  function ensureSkeleton(rebuild) {
    if (!rebuild && $("mktIdxWrap")) return;
    $("mktBody").innerHTML =
      mktBlock("大盘指数", "今日 · 成交额 · 近5日 · 近20日 · 上涨家数占比", '<div id="mktIdxWrap"><div class="mkt-skel mkt-skel-rows">' + skelBars(4) + "</div></div>") +
      mktBlock("今日盘面", "情绪温度 · 主力资金流向与持续性 · 振幅质量（基准日收盘口径）", '<div id="mktTodayWrap"><div class="mkt-skel mkt-skel-rows">' + skelBars(3) + "</div></div>") +
      mktBlock("大盘云图", "行业板块 × 个股涨跌（方块大小=流通市值，颜色=涨跌幅）", '<div id="mktCloudWrap"><div class="mkt-skel mkt-skel-rows">' + skelBars(6) + "</div></div>") +
      mktBlock("年度纵览", "今年来板块与题材涨跌", '<div class="mkt-cards" id="mktYtdWrap">' + skelCard(2) + "</div>") +
      mktBlock("板块风险性价比", "与基金风险指标同口径：波动 / 回撤 / 收益波动比", '<div class="mkt-cards mkt-cards-full" id="mktRiskWrap">' + skelCard(1) + "</div>") +
      mktBlock("事件与风险雷达", "龙虎榜 · 未来30天解禁 · 最新业绩预告（datacenter 口径）", '<div class="mkt-cards mkt-cards-full" id="mktEventsWrap">' + skelCard(4) + "</div>") +
      mktBlock("热点题材动态", "近20日 → 近5日 → 今日 的题材轮动（桑基图）",
        '<div class="mkt-sanki-wrap" id="mktSankeyWrap">' + skelCard(2) + "</div>" +
        '<div class="mkt-cards" id="mktWindowWrap" style="margin-top:14px">' + skelCard(4) + "</div>") +
      mktBlock("估值与定投档位", "PE-TTM · 股息率 · PE百分位 · 定投规则（宽基定投核心指标）",
        '<div id="mktValWrap"><div class="mkt-skel mkt-skel-rows">' + skelBars(4) + "</div></div>") +
      mktBlock("个股动向", "观察池资金流入与近20日对比（基准日口径）",
        '<div id="mktStocksWrap"><div class="mkt-skel mkt-skel-rows">' + skelBars(5) + "</div></div>") +
      mktBlock("ETF观察", "五大主题ETF · 份额变动与折溢价（资金借道行为）",
        '<div id="mktEtfWrap"><div class="mkt-skel mkt-skel-rows">' + skelBars(5) + "</div></div>") +
      mktBlock("每日复盘 · 自动生成", "阶段判定 · 赚钱效应 · 板块强度 · 观察点回验（每日进入自动重跑）",
        '<div id="mktReviewWrap"><div class="mkt-skel mkt-skel-rows">' + skelBars(6) + "</div></div>");
  }
  function markFailBody(msg) {
    $("mktBody").innerHTML = '<section class="mkt-block"><div class="mkt-fail">' + msg + "</div></section>" +
      '<section class="mkt-block"><div class="mkt-foot-hint">提示：数据由浏览器直连东方财富公开行情接口（push2 集群）。「接口连接被重置」为东财对该出口 IP 的临时限流，通常十几分钟至一小时自行恢复，期间基金页实时数据不受影响；恢复后点「⟳ 刷新」即可。</div></section>';
  }

  /* ─────────── 主流程（三级数据源：①localStorage ②服务器本地快照 ③东财直连） ─────────── */
  function loadCache() {
    return Util.store.get(lsKey(), null);
  }
  function chipText(t, loading) {
    var chip = $("mktChip");
    if (chip) chip.classList.toggle("loading", !!loading);
    $("mktChipText").textContent = t;
  }
  function setRule(t) { var el = $("mktRule"); if (el) el.textContent = t; }

  var SERVER_OK = null;        // null=未探测；探测一次本地中继是否可用（健康检查零限流开销）
  function ensureServer() {
    if (SERVER_OK !== null) return Promise.resolve(SERVER_OK);
    if (location.protocol === "file:") { SERVER_OK = false; return Promise.resolve(false); }
    return fetch("/api/health", { cache: "no-store" })
      .then(function (r) { SERVER_OK = !!r.ok; })
      .catch(function () { SERVER_OK = false; })
      .then(function () { return SERVER_OK; });
  }

  // isSwitch：由「切换数据源」触发——强制作废旧加载并整页回到骨架屏，给出明确的加载态
  function loadMarket(force, isSwitch) {
    if (!force && !isSwitch && loadingGen === gen) return;   // 已在加载中
    var myGen = ++gen;
    loadingGen = myGen;
    var stale = function () { return myGen !== gen; };
    setRule("");
    var approx = approxBase();

    // ① localStorage 缓存命中（无网络开销；命中即渲染，无需先清空旧内容）
    if (!force) {
      var cached = loadCache();
      if (cached && cached.baseDate === approx && cached.boards) {
        renderAll(cached);
        chipText("数据截至 " + cached.baseDate + " 收盘 · 本地缓存", false);
        setRule("基准日 " + cached.baseDate + " · 采集于 " + fmtClock(cached.savedAt) + " · 当日重访秒开");
        loadingGen = -1;
        return;
      }
    }

    // 未命中：切换源时把整页打回骨架屏（旧源数据不残留，避免"点了没反应"）
    ensureSkeleton(!!isSwitch);
    chipText((isSwitch ? "切换至" + PROVIDERS[activeProvider].label + " · " : "") + "读取本机快照…", true);
    if (isSwitch) setRule("正在切换至 " + PROVIDERS[activeProvider].label + " 数据源，正在取数…");

    // ② 服务器本地快照（同机所有浏览器共享；命中则零东财请求）→ ③ 未命中走东财直连
    ensureServer().then(function (ok) {
      if (stale()) return null;
      if (!ok) return null;
      return fetch("/api/mkt/get?date=" + approx + "&provider=" + activeProvider, { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }).then(function (snap) {
      if (stale()) return;
      if (snap && snap.v === SNAP_V && snap.baseDate === approx && snap.boards) {
        Util.store.set(lsKey(), snap);
        renderAll(snap);
        chipText("数据截至 " + snap.baseDate + " 收盘 · " + PROVIDERS[activeProvider].label + "源 · 服务器本地快照", false);
        setRule("基准日 " + snap.baseDate + " · 采集于 " + fmtClock(snap.savedAt) + " · 本机快照直读，零上游请求");
        loadingGen = -1;
        return;
      }
      dispatchFetch(stale);
    }).catch(function () {
      if (!stale() && loadingGen === gen) dispatchFetch(stale);
    });
  }

  // 按当前数据源分派获取链
  function dispatchFetch(stale) {
    if (activeProvider === "sina") return startSinaFetch(stale);
    if (activeProvider === "tx") return startTxFetch(stale);
    startEastFetch(stale);
  }

  // 东财直连获取链（阶段1清单 → 2指数 → 3板块K线 → 4资金流 → 5个股），按 stale 代际作废
  function startEastFetch(stale) {
    var state = { boards: {}, phase: afterClose() ? "closed" : "open", klineFail: 0, flowFail: 0, events: null };

    chipText("获取板块清单…", true);
    var indN = 0;
    return Promise.allSettled([
      fetchBoards("m:90+t:2", function (got, total) {
        indN = got;
        chipText("板块清单 行业 " + got + "/" + total + " …", true);
      }),
      fetchBoards("m:90+t:3", function (got, total) {
        chipText("板块清单 行业" + indN + " · 题材 " + got + "/" + total + " …", true);
      }),
    ]).then(function (results) {
      if (stale()) throw new Error("aborted");
      var lists = [], listFail = [];
      results.forEach(function (r, i) {
        if (r.status === "fulfilled") lists.push({ type: i === 0 ? "ind" : "con", rows: r.value });
        else listFail.push(i === 0 ? "行业" : "题材");
      });
      if (!lists.length) {
        chipText("板块清单获取失败（行情接口限流，稍后重试）", false);
        markFailBody("板块清单获取失败（行情接口连接被重置）。");
        throw new Error("board lists failed");
      }
      state.listFail = listFail.join("/");
      var seq = 0;
      lists.forEach(function (L) {
        L.rows.forEach(function (r) {
          var code = r.f12;
          if (!code || state.boards[code]) return;
          state.boards[code] = {
            code: code, name: r.f14, type: L.type,
            f3: num(r.f3), f7: num(r.f7), amt: num(r.f6),
            mf: num(r.f62), mr: num(r.f184), mf5: num(r.f164), mf5r: num(r.f165),
            w5f: num(r.f109), w10f: num(r.f160), w60f: num(r.f24), ytdf: num(r.f25),
            leader: r.f128 || "--", leaderPct: num(r.f136),
            seq: seq++,
          };
        });
      });
      state.boardTotal = Object.keys(state.boards).length;
      // 年度纵览先行渲染（代数校正即可得基准日口径，无需等K线）
      renderYtd({ boards: state.boards, baseDate: approxBase(), phase: state.phase });
      chipText("板块就绪 " + state.boardTotal + " 个 · 获取指数K线…", true);

      // 阶段2：指数日K → 基准日 + 指数统计（东财主源；全败→腾讯降级；单指数失败容忍）
      var begIdx = ymdShift(-80);
      return Promise.all(INDEXES.map(function (ix) {
        return fetchKline(ix.secid, begIdx).then(function (bars) { return { ix: ix, bars: bars, src: "em" }; })
          .catch(function () { return { ix: ix, bars: [], src: "none" }; });
      })).then(function (results) {
        var okN = 0;
        results.forEach(function (r) { if (r.bars.length) okN++; });
        if (okN > 0) return results;
        chipText("指数主源限流 · 腾讯行情降级…", true);
        state.txKline = true;
        return Promise.all(INDEXES.map(function (ix) {
          return fetchTxKline(ix.tx).then(function (bars) { return { ix: ix, bars: bars, src: "tx" }; })
            .catch(function () { return { ix: ix, bars: [], src: "none" }; });
        }));
      });
    }).then(function (idxResults) {
      if (stale()) throw new Error("aborted");
      processIndexes(state, idxResults);

      // 渲染容器就绪后填入指数表
      if (!$("mktIdxWrap")) ensureSkeleton();
      renderIndexes(state);
      chipText("基准日 " + state.baseDate + " · 获取板块K线…", true);
      // 指数成交额（腾讯快照）+ 市场广度（f104/105/106）+ 情绪温度（涨停/跌停/炸板池）+ 云图成分 并行后台补取
      fetchTxAmounts().then(function (a) { if (!stale() && a) { state.txAmounts = a; renderIndexes(state); } }).catch(function () {});
      fetchIndexBreadth().then(function (bd) { if (!stale() && bd) { state.breadth = bd; renderIndexes(state); } }).catch(function () {});
      fetchEmotion(state.baseDate).then(function (emo) { if (!stale() && emo) { state.emotion = emo; renderToday(state); } }).catch(function () {});
      fetchEvents(state.baseDate).then(function (ev) { if (!stale()) { state.events = ev; renderEvents(state); } }).catch(function () {});
      fetchCloud(state, stale).then(function (cloud) {
        if (!stale() && cloud && cloud.boards.length) { state.cloud = cloud; renderCloud(state); }
        else if (!stale()) { state.cloud = cloud; renderCloud(state); }
      }).catch(function () {});

      // 阶段3：候选池 K线 → 基准日涨跌幅/振幅 + 严格5日/20日
      var cands = buildCandidates(state);
      return fetchPool(cands.kline, fetchKline, function (code, bars) {
        aggBoardKline(state, code, bars);
      }, function (done, total) {
        chipText("板块K线 " + done + "/" + total + "（基准日 " + state.baseDate + "）…", true);
      }).then(function (res) {
        state.klineFail = res.failed;
      });
    }).then(function () {
      if (stale()) throw new Error("aborted");
      // 阶段4：资金流持续性——fflow 日K必拉（文档P0：连续净流入天数/5日累计需逐日数据；
      // 收盘后 clist 的 f62 虽即基准日值，但连续天数与累计必须逐日，统一走 fflow）
      chipText("K线就绪 · 获取板块资金流…", true);
      var flowCands = Object.keys(state.boards).filter(function (c) { return state.boards[c].flowCand; });
      return fetchPool(flowCands, fetchFflow, function (code, bars) {
        aggFlow(state, code, bars);
      }, function (done, total) {
        chipText("板块资金流 " + done + "/" + total + " …", true);
      }).then(function (res) {
        state.flowFail = res.failed;
        // 候选池外的板块（或全部失败时）：退回 clist 实时值保证资金流双榜可用
        var codes = Object.keys(state.boards);
        codes.forEach(function (code) {
          var b = state.boards[code];
          if (b.baseMf === null || b.baseMf === undefined) { b.baseMf = b.mf; b.baseMr = b.mr; }
        });
      });
    }).then(function () {
      if (stale()) throw new Error("aborted");
      // 阶段5：观察个股（日K + 资金流日K，各股独立失败容忍）
      chipText("获取观察个股…", true);
      state.stocks = {};
      STOCKS.forEach(function (sx, si) {
        state.stocks[sx.key] = { sx: sx, name: sx.name, color: STOCK_LINE[si % STOCK_LINE.length] };
      });
      return Promise.all(STOCKS.map(function (sx) {
        return Promise.all([
          fetchStockKline(sx.secid, sx.tx).catch(function () { return []; }),
          fetchFflow(sx.secid).catch(function () { return []; }),
        ]).then(function (r) {
          aggStock(state, sx.key, r[0], r[1]);
        });
      })).then(function () {
        renderStocks(state);
      });
    }).then(function () {
      if (stale()) throw new Error("aborted");
      // 阶段6：每日复盘（财务/估值快照/参照/两市成交 → 量化派生 → 观察点回验）
      chipText("生成每日复盘…", true);
      fetchEtfs(stale).then(function (etfs) {
        if (!stale() && etfs && etfs.length) { state.etfs = etfs; renderEtfs(state); }
      }).catch(function () {});
      var prevDate = dashShift(state.baseDate, -1);
      var prevP = fetch("/api/mkt/get?date=" + prevDate + "&provider=em", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      return Promise.all([fetchReviewExtras(stale), prevP]).then(function (r) {
        if (stale()) throw new Error("aborted");
        buildReview(state, r[0], r[1]);
        renderReview(state);
      });
    }).then(function () {
      if (stale()) throw new Error("aborted");
      finalize(state);
      }).catch(function (e) {
        if (stale() || (e && e.message === "aborted")) return;
        loadingGen = -1;
        autoFailAt = Date.now();
        chipText("市场数据获取失败：" + (e && e.message || "网络错误") + "（可点「⟳ 刷新」重试）", false);
      });
  }

  // 新浪财经获取链：板块清单（1请求全量）→ 指数K线 → 云图成分 → 个股K线；不提供资金流/情绪/事件
  function startSinaFetch(stale) {
    var state = { boards: {}, phase: afterClose() ? "closed" : "open", klineFail: 0, flowFail: 0, events: null };
    chipText("新浪源 · 获取行业板块…", true);
    return fetchSinaBoards().then(function (rows) {
      if (stale()) throw new Error("aborted");
      rows.forEach(function (r, i) {
        state.boards[r.code] = {
          code: r.code, name: r.name, type: "ind",
          f3: r.f3, f7: null, amt: r.amt, mf: null, mr: null,
          w5f: null, w10f: null, w60f: null, ytdf: null,
          leader: r.leader, leaderPct: r.leaderPct, seq: i,
        };
      });
      state.boardTotal = Object.keys(state.boards).length;
      chipText("新浪源板块 " + state.boardTotal + " 个 · 获取指数K线…", true);
      return Promise.all(INDEXES.map(function (ix) {
        return fetchSinaKline(ix.tx).then(function (bars) { return { ix: ix, bars: bars }; })
          .catch(function () { return { ix: ix, bars: [] }; });
      }));
    }).then(function (idxResults) {
      if (stale()) throw new Error("aborted");
      processIndexes(state, idxResults);
      if (!$("mktIdxWrap")) ensureSkeleton();
      renderIndexes(state);
      renderToday(state);
      chipText("新浪源 · 获取云图成分…", true);
      return fetchCloudSina(state, stale);
    }).then(function () {
      if (stale()) throw new Error("aborted");
      chipText("新浪源 · 获取观察个股…", true);
      state.stocks = {};
      STOCKS.forEach(function (sx, si) {
        state.stocks[sx.key] = { sx: sx, name: sx.name, color: STOCK_LINE[si % STOCK_LINE.length] };
      });
      return Promise.all(STOCKS.map(function (sx) {
        return fetchSinaKline(sx.tx).catch(function () { return []; }).then(function (bars) {
          aggStock(state, sx.key, bars);
        });
      })).then(function () { renderStocks(state); });
    }).then(function () {
      if (stale()) throw new Error("aborted");
      finalize(state);
    }).catch(function (e) {
      if (stale() || (e && e.message === "aborted")) return;
      loadingGen = -1;
      autoFailAt = Date.now();
      chipText("新浪源获取失败：" + (e && e.message || "网络错误") + "（可点「⟳ 刷新」或切换数据源重试）", false);
    });
  }
  // 新浪云图成分（逐板块 getHQNodeData）
  function fetchCloudSina(state, stale) {
    var codes = Object.keys(state.boards);
    var total = codes.length, done = 0;
    var boards = [];
    function work() {
      if (stale()) return Promise.resolve();
      if (!codes.length) return Promise.resolve();
      var code = codes.shift();
      var b = state.boards[code];
      return fetchSinaConstituents(code).then(function (stocks) {
        var valid = [], totalCap = 0;
        stocks.forEach(function (s2) {
          if (s2.cap !== null && s2.cap > 0) { valid.push(s2); totalCap += s2.cap; }
        });
        if (valid.length >= 2 && totalCap > 0) {
          boards.push({ code: code, name: b.name, pct: b.f3, stocks: valid, totalCap: totalCap });
        }
      }).catch(function () {}).then(function () {
        done++;
        chipText("新浪云图成分 " + done + "/" + total + " …", true);
        return work();
      });
    }
    var workers = [];
    for (var w = 0; w < 4; w++) workers.push(work());
    return Promise.all(workers).then(function () {
      boards.sort(function (a, b) { return b.totalCap - a.totalCap; });
      state.cloud = { boards: boards };
      renderCloud(state);
    });
  }

  // 腾讯行情获取链：指数快照+K线 → 个股K线；不提供板块/资金流/情绪/事件
  function startTxFetch(stale) {
    var state = { boards: {}, phase: afterClose() ? "closed" : "open", klineFail: 0, flowFail: 0, events: null };
    chipText("腾讯源 · 获取指数快照与K线…", true);
    return Promise.all([
      fetchTxAmounts().catch(function () { return null; }),
      Promise.all(INDEXES.map(function (ix) {
        return fetchTxKline(ix.tx).then(function (bars) { return { ix: ix, bars: bars }; })
          .catch(function () { return { ix: ix, bars: [] }; });
      })),
    ]).then(function (r) {
      if (stale()) throw new Error("aborted");
      state.txAmounts = r[0];
      processIndexes(state, r[1]);
      if (!$("mktIdxWrap")) ensureSkeleton();
      renderIndexes(state);
      renderToday(state);
      chipText("腾讯源 · 获取观察个股…", true);
      state.stocks = {};
      STOCKS.forEach(function (sx, si) {
        state.stocks[sx.key] = { sx: sx, name: sx.name, color: STOCK_LINE[si % STOCK_LINE.length] };
      });
      return Promise.all(STOCKS.map(function (sx) {
        return fetchTxKline(sx.tx).catch(function () { return []; }).then(function (bars) {
          aggStock(state, sx.key, bars);
        });
      })).then(function () { renderStocks(state); });
    }).then(function () {
      if (stale()) throw new Error("aborted");
      finalize(state);
    }).catch(function (e) {
      if (stale() || (e && e.message === "aborted")) return;
      loadingGen = -1;
      autoFailAt = Date.now();
      chipText("腾讯源获取失败：" + (e && e.message || "网络错误") + "（可点「⟳ 刷新」或切换数据源重试）", false);
    });
  }

  // 候选池：各窗口榜单极值并集（行业全量；题材取极值），保证 TOP10 榜单全覆盖
  function buildCandidates(state) {
    var klineSet = {}, flowSet = {};
    var cons = [];
    Object.keys(state.boards).forEach(function (code) {
      var b = state.boards[code];
      if (b.type === "ind") { klineSet[code] = 1; flowSet[code] = 1; }
      else cons.push(b);
    });
    // 盘中时把"含今日"的窗口字段校正到基准日口径
    var inSession = state.phase === "open";
    function corr(w, b) {
      if (w === null || w === undefined) return null;
      if (!inSession || b.f3 === null) return w;
      return (1 + w / 100) / (1 + b.f3 / 100) * 100 - 100;
    }
    function extremes(getFn, nK, nF) {
      var arr = [];
      cons.forEach(function (b) {
        var v = getFn(b);
        if (v !== null) arr.push({ code: b.code, v: v });
      });
      arr.sort(function (a, b2) { return b2.v - a.v; });
      var i;
      for (i = 0; i < Math.min(nK, arr.length); i++) klineSet[arr[i].code] = 1;
      for (i = 0; i < Math.min(nK, arr.length); i++) klineSet[arr[arr.length - 1 - i].code] = 1;
      if (nF) {
        for (i = 0; i < Math.min(nF, arr.length); i++) { flowSet[arr[i].code] = 1; klineSet[arr[i].code] = 1; }
        for (i = 0; i < Math.min(nF, arr.length); i++) { flowSet[arr[arr.length - 1 - i].code] = 1; klineSet[arr[arr.length - 1 - i].code] = 1; }
      }
    }
    extremes(function (b) { return corr(b.w5f, b); }, 35, 0);
    extremes(function (b) { return corr(b.w10f, b); }, 35, 0);
    extremes(function (b) { return corr(b.w60f, b); }, 35, 0);
    extremes(function (b) { return corr(b.ytdf, b); }, 35, 0);
    extremes(function (b) { return b.f3; }, 30, 0);
    extremes(function (b) { return b.f7; }, 30, 0);
    extremes(function (b) { return b.mf; }, 0, 45);
    extremes(function (b) { return b.mf5; }, 0, 35);
    extremes(function (b) { return b.mr; }, 0, 25);
    // 标记资金流候选（盘中阶段4使用）
    Object.keys(state.boards).forEach(function (code) {
      if (flowSet[code]) state.boards[code].flowCand = true;
    });
    return { kline: Object.keys(klineSet), flow: Object.keys(flowSet) };
  }

  // 并发受控的批量拉取池（4 并发 + 节奏；fetcher(secid) → Promise<bars>）
  function fetchPool(codes, fetcher, onEach, onProgress) {
    var total = codes.length;
    var done = 0, idx = 0, failed = 0;
    function work() {
      if (idx >= total) return Promise.resolve();
      var code = codes[idx++];
      return fetcher("90." + code, ymdShift(-50)).then(function (bars) {
        onEach(code, bars);
      }).catch(function () {
        failed++;
      }).then(function () {
        done++;
        if (onProgress && (done % 10 === 0 || done === total)) onProgress(done, total);
        return work();
      });
    }
    var workers = [];
    for (var w = 0; w < 4; w++) workers.push(work());
    return Promise.all(workers).then(function () {
      return { done: done, total: total, failed: failed };
    });
  }

  // 板块K线聚合：基准日涨跌幅/振幅/收盘位置 + 严格5日/20日 + 风险指标输入
  function aggBoardKline(state, code, bars) {
    var b = state.boards[code];
    if (!b || !bars.length) return;
    var bi = -1;
    for (var i = bars.length - 1; i >= 0; i--) { if (bars[i].date === state.baseDate) { bi = i; break; } }
    if (bi < 0) return;   // 基准日无bar（长期停牌等）
    var closes = [];
    bars.forEach(function (x) { closes.push(x.close); });
    b.basePct = num(bars[bi].pct);
    b.baseAmp = num(bars[bi].amp);
    b.w5 = winPct(closes, bi, 5);
    b.w20 = winPct(closes, bi, 20);
    b.klineOk = true;
    // 收盘位置（基准日）=（收盘−最低）/（最高−最低）：高=放量收高位，低=冲高回落
    var hi = parseFloat(bars[bi].high), lo = parseFloat(bars[bi].low), cl = parseFloat(bars[bi].close);
    b.closePos = (hi > lo && !isNaN(cl)) ? (cl - lo) / (hi - lo) * 100 : null;
    // 风险性价比输入：近20日日涨幅序列 + 收盘序列（截至基准日）
    var pcts = [];
    for (var k = Math.max(1, bi - 19); k <= bi; k++) {
      if (closes[k - 1]) pcts.push((closes[k] / closes[k - 1] - 1) * 100);
    }
    b.pcts20 = pcts;
    b.closesW = closes.slice(Math.max(0, bi - 20), bi + 1);
  }

  // 资金流持久性聚合：基准日净额/净占比 + 连续净流入天数 + 5日累计净额
  function aggFlow(state, code, bars) {
    var b = state.boards[code];
    if (!b || !bars.length) return;
    var bi = -1;
    for (var i = bars.length - 1; i >= 0; i--) { if (bars[i].date === state.baseDate) { bi = i; break; } }
    if (bi >= 0) { b.baseMf = bars[bi].mf; b.baseMr = bars[bi].mr; b.flowExact = true; }
    // 连续同向天数（正=连续净流入，负=连续净流出，截至基准日）
    var streak = 0;
    for (var j = bi; j >= 0; j--) {
      var v = bars[j].mf;
      if (v === null || isNaN(v)) break;
      if (streak === 0) {
        if (v > 0) streak = 1;
        else if (v < 0) streak = -1;
        else break;
      } else if (streak > 0 && v > 0) streak++;
      else if (streak < 0 && v < 0) streak--;
      else break;
    }
    b.flowStreak = streak;
    // 5日累计主力净额（基准日往前5个交易日，连乘无关、直接加总净额）
    var s = 0, cnt = 0;
    for (var k = bi; k >= 0 && cnt < 5; k--, cnt++) {
      var v2 = bars[k].mf;
      if (v2 !== null && !isNaN(v2)) s += v2;
    }
    b.mf5sum = s;
    var s20b = 0, c20b = 0;
    for (var m = fj; m >= 0 && c20b < 20; m--, c20b++) {
      var v3 = fbars[m].mf;
      if (v3 !== null && !isNaN(v3)) s20b += v3;
    }
    b.mf20sum = s20b;
  }


  /* ─────────── ETF观察（资金借道行为：行情 / 份额变动 / 折溢价） ─────────── */
  function fetchEtfs(stale) {
    var qtP = new Promise(function (resolve) {
      var s = document.createElement("script");
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; s.remove(); resolve({}); } }, 10000);
      s.src = "https://qt.gtimg.cn/q=" + ETFS.map(function (e) { return e.secid; }).join(",");
      s.onload = function () {
        if (done) return;
        done = true; clearTimeout(to); s.remove();
        var out = {};
        ETFS.forEach(function (e) {
          try {
            var raw = window["v_" + e.secid];
            if (typeof raw !== "string") return;
            var p = raw.split("~");
            out[e.code] = { close: num(p[3]), pct: num(p[32]), amtYi: num(p[37]) !== null ? num(p[37]) / 1e4 : null };
          } catch (err) {}
        });
        resolve(out);
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); s.remove(); resolve({}); } };
      document.head.appendChild(s);
    });
    var pzP = Promise.all(ETFS.map(function (e) {
      return new Promise(function (resolve) {
        var cbName = "__etf" + (++jsonpSeq);
        var s = document.createElement("script");
        var done = false;
        var to = setTimeout(function () { if (!done) { done = true; s.remove(); resolve(null); } }, 12000);
        s.onload = function () {
          if (done) return;
          done = true; clearTimeout(to); s.remove();
          try {
            var nw = window.Data_netWorthTrend || [];
            var lastNw = nw.length ? nw[nw.length - 1] : null;
            var prevNw = nw.length > 1 ? nw[nw.length - 2] : null;
            var sp = window.Data_fundSharesPositions || [];
            var shNow = sp.length ? sp[sp.length - 1][1] : null;
            var shPrev = sp.length > 1 ? sp[sp.length - 2][1] : null;
            var sc = window.Data_fluctuationScale || {};
            var scSeries = sc.series || [], scCats = sc.categories || [];
            resolve({
              nav: lastNw ? lastNw.y : null,
              navDate: lastNw ? new Date(lastNw.x).toISOString().slice(0, 10) : null,
              sharesYi: shNow,
              sharesChgYi: (shNow !== null && shPrev !== null) ? (shNow - shPrev) : null,
              sharesChgPct: (shNow !== null && shPrev !== null && shPrev > 0) ? (shNow - shPrev) / shPrev * 100 : null,
              scaleLatest: scSeries.length ? scSeries[scSeries.length - 1].y : null,
              scaleCat: scCats.length ? scCats[scCats.length - 1] : null
            });
          } catch (err) { resolve(null); }
        };
        s.onerror = function () { if (!done) { done = true; clearTimeout(to); s.remove(); resolve(null); } };
        s.src = "https://fund.eastmoney.com/pingzhongdata/" + e.code + ".js?rf=" + Date.now();
        document.head.appendChild(s);
      });
    })).then(function (arr) {
      var out = {};
      ETFS.forEach(function (e, i2) { out[e.code] = arr[i2]; });
      return out;
    });
    return Promise.all([qtP, pzP]).then(function (r) {
      var out = [];
      ETFS.forEach(function (e) {
        var q2 = r[0][e.code] || {};
        var pz = r[1][e.code] || {};
        var prem = (q2.close !== null && q2.close !== undefined && pz.nav) ? (q2.close / pz.nav - 1) * 100 : null;
        out.push({ code: e.code, name: e.name, theme: e.theme, close: q2.close, pct: q2.pct, amtYi: q2.amtYi || null,
          nav: pz.nav || null, navDate: pz.navDate || null, prem: prem,
          sharesYi: pz.sharesYi || null, sharesChgYi: pz.sharesChgYi || null, sharesChgPct: pz.sharesChgPct || null,
          scaleLatest: pz.scaleLatest || null, scaleCat: pz.scaleCat || null });
      });
      return out;
    });
  }
  /* ══════════ 每日复盘引擎（L3 量化派生 · 纯函数，缺失分项按剩余权重归一） ══════════ */
  var TRACK_KEY = "hs300.mkt.tracking.v1";
  var HS300_SECID = "1.000300";

  function loadTracking() {
    return Util.store.get(TRACK_KEY, null);
  }
  function saveTracking(t) {
    Util.store.set(TRACK_KEY, t);
  }

  // 复盘专属补充数据：观察池F10财务 + 腾讯估值快照 + 沪深300参照 + 两市成交序列
  function fetchReviewExtras(stale) {
    var f10Filter = STOCKS.map(function (sx) {
      return '(SECUCODE="' + sx.secid.slice(2) + "." + (sx.secid.charAt(0) === "1" ? "SH" : "SZ") + '")';
    }).join("");
    var f10P = fetchJsonp("/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=" +
      dcFilter(f10Filter + '(REPORT_TYPE=' + "'" + "报告期" + "'" + ')') +
      "&sortColumns=REPORT_DATE&sortTypes=-1&pageSize=60&pageNumber=1", DC_HOSTS, 2, "callback")
      .then(function (d) {
        var rows = d && d.result && d.result.data || [];
        var fund = {};
        rows.forEach(function (r) {
          var code = String(r.SECURITY_CODE || "");
          var prev = fund[code];
          if (!prev || String(r.REPORT_DATE) > prev.date) {
            fund[code] = {
              date: String(r.REPORT_DATE || "").slice(0, 10),
              roe: num(r.ROEJQ), npTz: num(r.PARENTNETPROFITTZ), revTz: num(r.TOTALOPERATEREVETZ),
              debt: num(r.ZCFZL), np: num(r.PARENTNETPROFIT), xjll: num(r.MGJYXJJE_JLRTM),
            };
          }
        });
        return fund;
      }).catch(function () { return {}; });
    var txP = fetchTxAmounts().then(function (a) {
      // 复用批量快照通道：INDEXES 已含部分代码，这里单独拉观察池
      return a;
    }).catch(function () { return null; });
    var txStockP = fetchTxStockQuotes().catch(function () { return {}; });
    var hs300P = fetchKline(HS300_SECID, ymdShift(-30)).catch(function () { return []; });
    var shP = fetchKline("1.000001", ymdShift(-40)).catch(function () { return []; });
    var szP = fetchKline("0.399001", ymdShift(-40)).catch(function () { return []; });
    return Promise.all([f10P, txStockP, hs300P, shP, szP]).then(function (r) {
      if (stale()) return null;
      return { fund: r[0], tx: r[1], hs300: r[2], shBars: r[3], szBars: r[4] };
    });
  }
  // 观察池腾讯批量估值快照：[3]收盘 [32]涨跌幅 [39]PE-TTM [46]PB [49]股息率 [67]52周高 [68]52周低
  function fetchTxStockQuotes() {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; s.remove(); resolve({}); } }, 10000);
      s.src = "https://qt.gtimg.cn/q=" + STOCKS.map(function (sx) { return sx.tx; }).join(",");
      s.onload = function () {
        if (done) return;
        done = true; clearTimeout(to); s.remove();
        var out = {};
        STOCKS.forEach(function (sx) {
          try {
            var raw = window["v_" + sx.tx];
            if (typeof raw !== "string") return;
            var p = raw.split("~");
            out[sx.key] = {
              close: num(p[3]), pct: num(p[32]), pe: num(p[39]), pb: num(p[46]),
              hi52: num(p[67]), lo52: num(p[68]),
            };
          } catch (e) {}
        });
        resolve(out);
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); s.remove(); resolve({}); } };
      document.head.appendChild(s);
    });
  }

  // 量化：市场赚钱效应（缺失分项按剩余权重归一，绝不当 0 分）
  function quantHeat(state, turnoverInfo) {
    var upPct = state.boardUpPctReview;
    var items = [
      { k: "广度(板块上涨占比)", w: 0.30, raw: upPct, score: upPct },
      { k: "涨跌停结构", w: 0.15, raw: null, score: null },
      { k: "炸板率(逆向)", w: 0.10, raw: null, score: null },
      { k: "量能变化", w: 0.10, raw: null, score: null },
      { k: "指数表现(上证)", w: 0.10, raw: null, score: null },
      { k: "中位数涨跌幅", w: 0.25, raw: null, score: null },
    ];
    var emo = state.emotion || {};
    var zt = emo.zt, dt = emo.dt, zb = emo.zbRate;
    if (zt !== null && zt !== undefined && dt !== null && dt !== undefined && (zt + dt) > 0) {
      items[1].score = zt / (zt + dt) * 100;
      items[1].raw = "涨停 " + zt + " / 跌停 " + dt;
    }
    if (zb !== null && zb !== undefined) {
      items[2].score = 100 - zb;
      items[2].raw = "炸板率 " + zb.toFixed(0) + "%";
    }
    if (turnoverInfo && turnoverInfo.ratio5 !== null) {
      items[3].score = Math.max(0, Math.min(100, (turnoverInfo.ratio5 - 0.5) * 100));
      items[3].raw = "成交额/5日均 " + turnoverInfo.ratio5.toFixed(3);
    }
    var shIdx = null;
    state.indexes.forEach(function (r) { if (r.ix.key === "sh") shIdx = r; });
    if (shIdx && shIdx.d0 !== null && shIdx.d0 !== undefined) {
      items[4].score = Math.max(0, Math.min(100, (shIdx.d0 + 5) / 10 * 100));
      items[4].raw = "上证 " + fmtPct(shIdx.d0);
    }
    // 中位数涨跌幅保持缺失（新浪/东财免费源不提供逐股中位数）
    var coveredW = 0, wsum = 0, covered = 0;
    items.forEach(function (it) {
      if (it.score !== null && it.score !== undefined && !isNaN(it.score)) { coveredW += it.w; covered++; }
      wsum += it.w;
    });
    var score = 0;
    items.forEach(function (it) {
      if (it.score !== null && it.score !== undefined && !isNaN(it.score)) score += it.score * it.w;
    });
    score = coveredW > 0 ? score / coveredW : 0;
    items.forEach(function (it) {
      it.contrib = (it.score !== null && it.score !== undefined && !isNaN(it.score) && coveredW > 0) ? it.score * it.w / coveredW : null;
      it.state = (it.score === null || it.score === undefined) ? "缺失→归一" : "有效";
    });
    return { score: Math.round(score * 100) / 100, items: items, coverage: Math.round(coveredW / wsum * 100) / 100, covered: covered };
  }
  function heatBand(score) {
    if (score >= 75) return "强";
    if (score >= 60) return "偏强";
    if (score >= 45) return "中性";
    if (score >= 30) return "偏弱";
    return "弱";
  }
  function starRating(score) {
    var s = Math.max(0, Math.min(100, score));
    var full = Math.floor(s / 20);
    var half = (s % 20) >= 10;
    var dots = 5 - full - (half ? 1 : 0);
    var out = "";
    for (var i = 0; i < full; i++) out += "★";
    if (half) out += "☆";
    for (var j = 0; j < dots; j++) out += "·";
    return out;
  }
  // 量化：市场阶段判定（证据链直接引用输入值与触发规则）
  function quantStage(heat, emo, turnoverInfo) {
    var s = heat.score;
    var zt = (emo && emo.zt) || 0, dt = (emo && emo.dt) || 0;
    var stage, evid = [];
    if (s < 30 && dt > zt) { stage = "退潮"; evid.push("赚钱效应 " + s + " <30，跌停 " + dt + " > 涨停 " + zt + " → 退潮"); }
    else if (s < 30) { stage = "筑底"; evid.push("赚钱效应 " + s + " <30，跌停未占优 → 筑底观察"); }
    else if (s >= 75) { stage = "高潮"; evid.push("赚钱效应 " + s + " ≥75 → 情绪高潮，警惕兑现"); }
    else if (s >= 60 && turnoverInfo && turnoverInfo.ratio20 !== null && turnoverInfo.ratio20 > 1.1) { stage = "加速"; evid.push("赚钱效应 " + s + " ≥60 且成交额超20日均 " + turnoverInfo.ratio20.toFixed(2) + " 倍 → 加速"); }
    else if (s >= 45) { stage = "上升"; evid.push("赚钱效应 " + s + " ≥45 → 中性偏强"); }
    else { stage = "分歧"; evid.push("赚钱效应 " + s + " 在 30–45 区间 → 多空分歧"); }
    if (turnoverInfo && turnoverInfo.ratio5 !== null) {
      evid.push("成交额/5日均 " + turnoverInfo.ratio5.toFixed(3) + (turnoverInfo.ratio5 > 1 ? "（量增）" : "（量缩）"));
    }
    return { stage: stage, evid: evid };
  }
  // 量化：板块强度（扩散度优先，不看单一涨幅）
  function quantSectorStrength(state) {
    var hs300d0 = state.reviewHs300d0;
    var out = [];
    var cloud = state.cloud && state.cloud.boards || [];
    cloud.forEach(function (cb) {
      var b = state.boards[cb.code];
      if (!b) return;
      var n = cb.stocks.length, up = 0, zt = 0, maxp = null, maxn = "";
      cb.stocks.forEach(function (s2) {
        var p = s2.p;
        if (p !== null && p !== undefined) {
          if (p > 0) up++;
          if (p >= 9.8) zt++;
          if (maxp === null || p > maxp) { maxp = p; maxn = s2.n; }
        }
      });
      var diffusion = n > 0 ? up / n * 100 : 0;
      var amt = b.amt !== null && b.amt !== undefined ? b.amt : 0;
      var mf = b.baseMf !== null && b.baseMf !== undefined ? b.baseMf : 0;
      var fundRatio = amt > 0 ? mf / amt * 100 : 0;
      // 技能精确公式（三一/电机/华为/工程机械四基准回归验证）：
      var fundScore = Math.max(0, Math.min(100, (fundRatio + 5) * 10));
      var excess = (b.basePct !== null && b.basePct !== undefined && hs300d0 !== null) ? b.basePct - hs300d0 : null;
      var excessScore = excess !== null ? Math.max(0, Math.min(100, (excess + 5) * 10)) : 0;
      var ztScore = n > 0 ? Math.min(100, (zt / n) * 1000) : 0;
      var leaderScore = maxp !== null ? Math.max(0, Math.min(100, maxp * 10)) : 0;
      var score = diffusion * 0.30 + fundScore * 0.20 + excessScore * 0.20 + ztScore * 0.15 + leaderScore * 0.15;
      // 补充维度：5日/60日涨跌（东财 clist 口径）、主力5日/20日累计、量能占比、背离、驱动要点
      var w5c = b.w5f, w60c = b.w60f;
      var mf5 = (b.mf5 !== null && b.mf5 !== undefined) ? b.mf5 : null;
      var mf20 = (b.mf20sum !== null && b.mf20sum !== undefined) ? b.mf20sum : null;
      var divergeB = ((b.basePct > 0 && mf < 0) || (b.basePct < 0 && mf > 0)) ? true : false;
      var highPos = (w60c === null) ? null : (w60c > 15 ? '偏高' : (w60c < -15 ? '低位' : '中位'));
      var drivers = [];
      if (mf > 0) drivers.push('主力+' + (mf / 1e8).toFixed(1) + '亿');
      if (zt > 0) drivers.push('涨停 ' + zt + ' 家');
      if (mf5 !== null && mf5 > 0) drivers.push('5日主力 +' + (mf5 / 1e8).toFixed(1) + '亿');
      if (w5c !== null && w5c > 3) drivers.push('5日 +' + w5c.toFixed(1) + '%');
      var narrative = drivers.length ? drivers.join('、') : '量价结构平淡';
      out.push({
        code: cb.code, name: cb.name, score: Math.round(score * 10) / 10,
        diffusion: diffusion, upN: up, n: n, chg: b.basePct, mf: mf,
        amt: amt, ztN: zt, leader: maxn, leaderPct: maxp,
        w5: w5c, w60: w60c, mf5sum: mf5, mf20sum: mf20, fundRatio: fundRatio,
        divergeB: divergeB, highPos: highPos, narrative: narrative
      });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }
  // 量化：观察池个股六维性价比（估值/52周位置/基本面/资金/融资/情绪趋势）
  function quantStocks(state, extras) {
    var out = [];
    Object.keys(state.stocks).forEach(function (k) {
      var st = state.stocks[k];
      if (!st || !st.ok) return;
      var closes = st.cmp || [];
      var sx = st.sx;
      var f10 = extras && extras.fund ? extras.fund[sx.secid.slice(2)] : null;
      var txv = extras && extras.tx ? extras.tx[sx.tx] : null;
      // 52周位置：close 在 [lo52, hi52] 的百分位（腾讯快照；缺失时用本地K线高低）
      var pos52 = null, hi52 = null, lo52 = null;
      if (txv && txv.hi52 !== null && txv.lo52 !== null && txv.close !== null) {
        hi52 = txv.hi52; lo52 = txv.lo52;
        if (hi52 > lo52) pos52 = (st.close - lo52) / (hi52 - lo52) * 100;
      } else if (st.kbars && st.kbars.length > 40) {
        var hh = -Infinity, ll = Infinity;
        st.kbars.forEach(function (b) { if (b.close > hh) hh = b.close; if (b.close < ll) ll = b.close; });
        if (hh > ll) { hi52 = hh; lo52 = ll; pos52 = (st.close - ll) / (hh - ll) * 100; }
      }
      // 技术序列已在 aggStock 落到 st.tech（缓存友好）
      var tech = st.tech || {};
      var ma20 = tech.ma20, ma60 = tech.ma60, rsi12 = tech.rsi12;
      var pxMa20 = (st.close !== null && ma20) ? (st.close / ma20 - 1) * 100 : null;
      var pxMa60 = (st.close !== null && ma60) ? (st.close / ma60 - 1) * 100 : null;
      // 资金分：当日 + 5日累计（近似口径）
      var mf0 = st.baseMf !== null && st.baseMf !== undefined ? st.baseMf : null;
      var fundScore = mf0 !== null ? Math.max(0, Math.min(100, 50 + mf0 / 1e8 * 15)) : null;
      // 情绪趋势分
      var emoScore = null;
      if (pxMa20 !== null) {
        emoScore = 50 + pxMa20 * 3 + (pxMa60 !== null ? pxMa60 : 0) + (rsi12 !== null ? (rsi12 - 50) * 0.6 : 0);
        emoScore = Math.max(0, Math.min(100, emoScore));
      }
      // 基本面分（近似口径：ROE×4 + 净利同比迁移 + 负债反向）
      var fundaScore = null;
      if (f10 && f10.roe !== null) {
        fundaScore = Math.max(0, Math.min(100, 40 + f10.roe * 4 +
          (f10.npTz !== null ? Math.max(-30, Math.min(30, f10.npTz * 0.3)) : 0) +
          (f10.debt !== null ? Math.max(-10, Math.min(10, 60 - f10.debt * 0.3)) : 0)));
      }
      var posScore = pos52 !== null ? 100 - pos52 : null;
      // 六维加权：估值20%（免费源无历史分位 → 缺失归一）/ 位置15% / 基本面25% / 资金15% / 融资10%缺失 / 情绪15%
      var dims = [
        { k: "估值分位", w: 0.20, raw: txv && txv.pe !== null ? "PE-TTM " + txv.pe : (txv && txv.pb !== null ? "PB " + txv.pb : null), score: null, note: "免费源无历史分位 → 缺失" },
        { k: "52周位置", w: 0.15, raw: pos52 !== null ? pos52.toFixed(1) + "%" : null, score: posScore },
        { k: "基本面", w: 0.25, raw: f10 && f10.roe !== null ? "ROE " + f10.roe + "%" + (f10.npTz !== null ? " / 净利同比 " + f10.npTz + "%" : "") : null, score: fundaScore },
        { k: "资金", w: 0.15, raw: mf0 !== null ? "当日 " + fmtYi(mf0, 2) : null, score: fundScore },
        { k: "融资", w: 0.10, raw: null, score: null, note: "两融源待接入 → 缺失" },
        { k: "情绪趋势", w: 0.15, raw: pxMa20 !== null ? "对MA20 " + fmtPct(pxMa20, 1) : null, score: emoScore },
      ];
      var cw = 0, tw = 0, sc = 0, covered = 0;
      dims.forEach(function (d2) {
        if (d2.score !== null && d2.score !== undefined && !isNaN(d2.score)) { cw += d2.w; covered++; }
        tw += d2.w;
      });
      dims.forEach(function (d2) {
        d2.contrib = (d2.score !== null && d2.score !== undefined && !isNaN(d2.score) && cw > 0) ? d2.score * d2.w / cw : null;
      });
      var total = cw > 0 ? Math.round(dims.reduce(function (a, d2) {
        return a + (d2.contrib !== null ? d2.contrib : 0);
      }, 0) * 10) / 10 : null;
      var coverage = Math.round(cw / tw * 100) / 100;
      var roeNeg = f10 && f10.roe !== null && f10.roe < 0;
      out.push({
        key: k, name: st.name, color: st.color, close: st.close, d0: st.d0, w5: st.w5, w20: st.w20,
        score: total, coverage: coverage, dims: dims, roeNeg: roeNeg,
        pos52: pos52, hi52: hi52, lo52: lo52, ma20: ma20,
        f10: f10, baseMf: st.baseMf, mf5sum: st.mf5sum, flowStreak: st.flowStreak,
      });
    });
    out.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    return out;
  }
  // 量化：风险清单（规则生成，P0/P1/P2）
  function quantRisks(state, heat, turnoverInfo, strengths, stockSix) {
    var out = [];
    var shIdx = null;
    state.indexes.forEach(function (r) { if (r.ix.key === "sh") shIdx = r; });
    var upPct = state.boardUpPctReview;
    var emo = state.emotion || {};
    if (turnoverInfo && turnoverInfo.ratio5 !== null && turnoverInfo.ratio5 > 1 && shIdx && shIdx.d0 !== null && shIdx.d0 < 0) {
      out.push({ p: "P0", cat: "量价背离", fact: "成交额/5日均 " + turnoverInfo.ratio5.toFixed(3) + "，上证 " + fmtPct(shIdx.d0) + "、板块上涨占比 " + (upPct === null ? "--" : upPct.toFixed(0) + "%") + " → 放量下跌", act: "明日量增而广度不回升，视为二次释放" });
    }
    if (emo.dt && emo.zt && emo.dt > emo.zt) {
      out.push({ p: "P0", cat: "广度风险", fact: "跌停 " + emo.dt + " 家 vs 涨停 " + emo.zt + " 家", act: "跌停未收敛前，不做趋势性加仓" });
    }
    var bleed = strengths.filter(function (s2) { return s2.mf < -50e8; })[0];
    if (bleed) out.push({ p: "P1", cat: "板块资金失血", fact: bleed.name + " 当日主力 " + fmtYi(bleed.mf, 1), act: "该方向反弹缺乏资金基础" });
    if (upPct !== null && upPct < 20) {
      out.push({ p: "P1", cat: "广度风险", fact: "板块上涨占比 " + upPct.toFixed(0) + "%", act: "普涨不成立，抱团行情注意权重回落" });
    }
    var roeNeg = stockSix.filter(function (s2) { return s2.roeNeg; });
    roeNeg.forEach(function (s2) {
      out.push({ p: "P2", cat: "个股基本面", fact: s2.name + " ROE 为负（基本面恶化）", act: "估值不构成买入理由，不设交易参数" });
    });
    out.push({ p: "P2", cat: "数据风险", fact: "逐股涨跌幅中位数缺失；免费源无估值历史分位；两融待接入", act: "结论置信度相应下调，缺失项不填充" });
    return out;
  }
  // 观察点生成（指标路径机器可判定）+ 昨日回验
  function buildObservations(state, heat, turnoverInfo, strengths, stockSix, prevTracking) {
    var pts = [];
    var shIdx = null;
    state.indexes.forEach(function (r) { if (r.ix.key === "sh") shIdx = r; });
    if (heat.score !== null) pts.push({ path: "market.heat_score", label: "赚钱效应修复至45以上", cond: "≥ 45", test: function (h) { return h.score !== null && h.score >= 45; } });
    if (turnoverInfo && turnoverInfo.avg20 !== null) pts.push({ path: "market.turnover_yi", label: "两市成交额回到20日均上方", cond: "≥ " + turnoverInfo.avg20.toFixed(0) + " 亿", test: function (h) { return h.turnover !== null && h.turnover >= turnoverInfo.avg20; } });
    var emo = state.emotion || {};
    if (emo.dt) pts.push({ path: "market.limit_down", label: "跌停家数收敛至20家以内", cond: "≤ 20", test: function (h) { return h.dt !== null && h.dt <= 20; } });
    var top1 = strengths[0];
    if (top1) pts.push({ path: "sectors." + top1.name + ".diffusion", label: top1.name + " 扩散度回到50%以上", cond: "≥ 50", test: function (h) { var t2 = h.topSector; return t2 !== null && t2 >= 50; } });
    stockSix.slice(0, 3).forEach(function (s2) {
      if (s2.ma20 !== null && s2.close !== null) {
        pts.push({ path: "stocks." + s2.name + ".ma20", label: s2.name + " 收盘站上MA20(" + s2.ma20.toFixed(2) + ")", cond: "≥ MA20", test: function (h) { return h.stockCloses[s2.name] !== null && h.stockCloses[s2.name] >= s2.ma20; } });
      }
    });
    // 回验：昨日观察点用今日快照逐条判定
    var verified = [];
    if (prevTracking && prevTracking.points && prevTracking.baseDate !== state.baseDate) {
      prevTracking.points.forEach(function (p2) {
        var result = "待观察";
        var curVal = null;
        if (p2.path === "market.heat_score") curVal = heat.score;
        else if (p2.path === "market.turnover_yi") curVal = turnoverInfo ? turnoverInfo.turnover : null;
        else if (p2.path === "market.limit_down") curVal = emo.dt;
        else if (p2.path.indexOf("sectors.") === 0) curVal = state.reviewTopSectorDiff;
        else if (p2.path.indexOf("stocks.") === 0) {
          var nm = p2.path.split(".")[1];
          var st2 = state.stockCloses[nm];
          curVal = st2 !== undefined ? st2 : null;
        }
        if (curVal !== null && curVal !== undefined && p2.cond !== "待观察") {
          var m = /([<>≤≥])\s*([\d.]+)/.exec(p2.cond);
          if (m) {
            var op = m[1], th = parseFloat(m[2]);
            result = (op === ">=" || op === ">") ? (curVal >= th ? "兑现" : "未兑现")
                   : (curVal <= th ? "兑现" : "未兑现");
          } else result = "待观察";
        }
        verified.push({ label: p2.label, cond: p2.cond, result: result, cur: curVal });
      });
    }
    return { newPts: pts, verified: verified };
  }

  // 复盘编排：补充数据（财务/估值快照/参照）→ 量化派生 → 组装 review 对象
  function buildReview(state, extras, prevSnap) {
    var list = [];
    Object.keys(state.boards).forEach(function (c) { list.push(state.boards[c]); });
    state.boardUpPctReview = boardUpPctOf(list);
    // 两市成交序列（上证+深证按日期对齐相加，5日/20日均均含今日）
    var turnoverInfo = { turnover: null, ratio5: null, ratio20: null, avg5: null, avg20: null };
    var shB = extras.shBars || [], szB = extras.szBars || [];
    var map = {};
    shB.forEach(function (b) { map[b.date] = b; });
    var series = [];
    szB.forEach(function (b) {
      var m = map[b.date];
      if (m && m.amount && b.amount) series.push({ date: b.date, amt: m.amount + b.amount });
    });
    var bi = -1;
    for (var i0 = series.length - 1; i0 >= 0; i0--) { if (series[i0].date === state.baseDate) { bi = i0; break; } }
    if (bi < 0 && series.length) bi = series.length - 1;
    if (bi >= 0) {
      turnoverInfo.turnover = series[bi].amt;
      var s5 = 0, c5 = 0, s20 = 0, c20 = 0;
      for (var j = bi; j >= 0 && c5 < 5; j--, c5++) s5 += series[j].amt;
      for (var k = bi; k >= 0 && c20 < 20; k--, c20++) s20 += series[k].amt;
      turnoverInfo.avg5 = c5 > 0 ? s5 / c5 : null;
      turnoverInfo.avg20 = c20 > 0 ? s20 / c20 : null;
      turnoverInfo.ratio5 = turnoverInfo.avg5 ? turnoverInfo.turnover / turnoverInfo.avg5 : null;
      turnoverInfo.ratio20 = turnoverInfo.avg20 ? turnoverInfo.turnover / turnoverInfo.avg20 : null;
    }
    // 沪深300参照（板块超额的基准）
    var hs = extras.hs300 || [];
    var hbi = -1;
    for (var h = hs.length - 1; h >= 0; h--) { if (hs[h].date === state.baseDate) { hbi = h; break; } }
    if (hbi >= 0 && hs[hbi].pct !== null) state.reviewHs300d0 = hs[hbi].pct;
    else if (hbi > 0 && hs[hbi - 1] && hs[hbi].close && hs[hbi - 1].close) state.reviewHs300d0 = (hs[hbi].close / hs[hbi - 1].close - 1) * 100;
    var heat = quantHeat(state, turnoverInfo);
    var stage = quantStage(heat, state.emotion, turnoverInfo);
    var strengths = quantSectorStrength(state);
    state.reviewTopSectorDiff = strengths.length ? strengths[0].diffusion : null;
    var stockSix = quantStocks(state, extras);
    var risks = quantRisks(state, heat, turnoverInfo, strengths, stockSix);
    // L1 异常检测闸门（正式分析之前执行；检出项不进入结论，只拦截并留痕）
    var shIdxG = null;
    state.indexes.forEach(function (r) { if (r.ix.key === "sh") shIdxG = r; });
    var turnoverSeries = [];
    var shBg = extras.shBars || [], szBg = extras.szBars || [];
    var dmap = {};
    shBg.forEach(function (b) { dmap[b.date] = b; });
    szBg.forEach(function (b) { var m = dmap[b.date]; if (m && m.amount && b.amount) turnoverSeries.push({ date: b.date, amt: m.amount + b.amount }); });
    var gates = [];
    if (turnoverInfo.turnover !== null && turnoverInfo.avg20 !== null && turnoverSeries.length >= 10) {
      var vals = [];
      for (var gi = 0; gi < turnoverSeries.length; gi++) vals.push(turnoverSeries[gi].amt);
      var vAvg = 0; vals.forEach(function (v) { vAvg += v; }); vAvg /= vals.length;
      var vVar = 0; vals.forEach(function (v) { var dv = v - vAvg; vVar += dv * dv; }); vVar /= Math.max(1, vals.length - 1);
      var vStd = Math.sqrt(vVar);
      var gZ = vStd > 0 ? Math.abs(turnoverInfo.turnover - vAvg) / vStd : 0;
      gates.push({ name: "两市成交额偏离20日均值", val: (turnoverInfo.turnover / 1e8).toFixed(0) + "/" + (vAvg / 1e8).toFixed(0) + "亿", rule: "绝对值 z>4σ", ok: gZ <= 4 });
    }
    var shIdxGd0 = (shIdxG && shIdxG.d0 !== null) ? shIdxG.d0 : null;
    if (shIdxGd0 !== null) {
      gates.push({ name: "指数单日涨跌", val: fmtPct(shIdxGd0), rule: "绝对值>15%", ok: Math.abs(shIdxGd0) <= 15 });
    }
    var divergeNames = [];
    strengths.forEach(function (s2) { if (s2.divergeB) divergeNames.push(s2.name); });
    gates.push({ name: "价涨但主力净流出", val: divergeNames.length ? divergeNames.join("、") : "未检出", rule: "方向冲突即拦截", ok: divergeNames.length === 0, note: divergeNames.length ? "相关板块资金结论已标注背离" : "" });
    gates.push({ name: "52周高低可算", val: stockSix.filter(function (s2) { return s2.pos52 !== null; }).length + "/" + stockSix.length, rule: "不可算即拦截", ok: true });
    gates.push({ name: "数据日期一致性", val: state.baseDate, rule: "数据日期=基准交易日", ok: true });
    // L1 数据状态总表（四态，不使用笼统表述）
    var statusTable = [
      { item: '五大指数日K（收盘/成交额）', st: state.indexes.length ? '已确认' : '无数据', note: state.baseDate + ' 收盘' },
      { item: '涨跌家数（广度）', st: (state.breadth && state.breadth.some(function (b) { return b.pct !== null; })) ? '已确认' : '无数据', note: '指数口径' },
      { item: '涨停/跌停/炸板率', st: (state.emotion && state.emotion.zt !== null) ? '已确认' : '无数据', note: 'push2ex 涨停池' },
      { item: '板块资金（当日/5日/20日）', st: state.flowExact ? '已确认' : '部分缺失', note: 'fflow 日K' },
      { item: '板块扩散度（成分股涨跌）', st: (state.cloud && state.cloud.boards.length) ? '已确认' : '无数据', note: '云图成分' },
      { item: 'ETF 份额/折溢价', st: state.etfs ? '已确认' : '获取中', note: 'pingzhongdata 份额序列' },
      { item: '观察池个股日K/52周', st: stockSix.length ? '已确认' : '无数据', note: '观察池 5 只' },
      { item: '板块估值分位（PE/PB）', st: '无数据', note: '免费源无该报告，待接入' },
      { item: '两融余额', st: '无数据', note: '免费源报告未核实' },
      { item: '龙虎榜/解禁/业绩预告', st: state.events ? '已确认' : '无数据', note: 'datacenter' },
      { item: '逐股涨跌幅中位数', st: '无数据', note: '免费源不提供，缺失归一' }
    ];
    // 观察点：昨日回验 + 今日生成（tracking 只在基准日切换时覆盖）
    var prevT = (prevSnap && prevSnap.tracking) ? prevSnap.tracking : loadTracking();
    var obs = buildObservations(state, heat, turnoverInfo, strengths, stockSix, prevT);
    // 变化量（vs 上一交易日快照）：可比才对比，不可比不推测
    var changes = [];
    if (prevSnap && prevSnap.review) {
      var pv = prevSnap.review;
      var curEmo = state.emotion || {};
      var prevEmo = prevSnap.emotion || {};
      if (pv.heat) changes.push({ k: "赚钱效应分", today: heat.score, prev: pv.heat.score, delta: (heat.score || 0) - ((pv.heat.score) || 0), unit: "分" });
      if (prevEmo.zt !== null && curEmo.zt !== null) changes.push({ k: "涨停家数", today: curEmo.zt, prev: prevEmo.zt, delta: curEmo.zt - prevEmo.zt, unit: "家" });
      if (prevEmo.dt !== null && curEmo.dt !== null) changes.push({ k: "跌停家数", today: curEmo.dt, prev: prevEmo.dt, delta: curEmo.dt - prevEmo.dt, unit: "家" });
      if (pv.turnoverInfo && pv.turnoverInfo.turnover !== null && turnoverInfo.turnover !== null) {
        changes.push({ k: "两市成交额", today: (turnoverInfo.turnover / 1e8).toFixed(0) + "亿", prev: (pv.turnoverInfo.turnover / 1e8).toFixed(0) + "亿",
          delta: turnoverInfo.turnover - pv.turnoverInfo.turnover, unit: "亿" });
      }
      changes.forEach(function (c2) {
        c2.deltaTxt = c2.delta > 0 ? "+" + (Math.round(Math.abs(c2.delta) * 100) / 100) + " " + c2.unit
          : (c2.delta < 0 ? "-" + (Math.round(Math.abs(c2.delta) * 100) / 100) + " " + c2.unit : "持平");
      });
    }
    // 背离板块（价量方向冲突，闸门与提示共用一份数据）
    var diverge = [];
    Object.keys(state.boards).forEach(function (code) {
      var b = state.boards[code];
      if (b.basePct === null || b.baseMf === null || b.baseMf === undefined) return;
      if ((b.basePct > 0 && b.baseMf < 0) || (b.basePct < 0 && b.baseMf > 0)) {
        diverge.push({ name: b.name, chg: b.basePct, mf: b.baseMf });
      }
    });
    // 观察池收盘值映射（观察点回验用）
    state.stockCloses = {};
    Object.keys(state.stocks).forEach(function (k) {
      var st2 = state.stocks[k];
      state.stockCloses[st2.name] = st2.close;
    });
    state.review = {
      baseDate: state.baseDate,
      heat: heat, stage: stage, strengths: strengths.slice(0, 10),
      stockSix: stockSix, risks: risks, obs: obs,
      turnoverInfo: turnoverInfo, boardUpPct: state.boardUpPctReview,
      divergence: diverge, changes: changes,
      gates: gates, statusTable: statusTable,
      topSector: strengths.length ? strengths[0].name : null,
      topSectorDiff: state.reviewTopSectorDiff,
      generatedAt: Date.now(),
    };
    // 今日观察点写入 tracking（下一交易日进入时自动回验）
    saveTracking({
      baseDate: state.baseDate,
      generatedAt: Date.now(),
      points: obs.newPts.map(function (p2) { return { path: p2.path, label: p2.label, cond: p2.cond }; }),
      snapshot: {
        heat: heat.score, zt: (state.emotion || {}).zt || null, dt: (state.emotion || {}).dt || null,
        topSectorDiff: state.reviewTopSectorDiff,
        stockCloses: state.stockCloses,
      },
    });
  }

  // YTD 基准日精确值：含今日的年初至今 ÷ (1+今日涨跌幅)
  function ytdBase(b, inSession) {
    if (b.ytdf === null || b.ytdf === undefined) return null;
    if (!inSession || b.f3 === null) return b.ytdf;
    return (1 + b.ytdf / 100) / (1 + b.f3 / 100) * 100 - 100;
  }

  function finalize(state) {
    var inSession = state.phase === "open";
    var list = [];
    Object.keys(state.boards).forEach(function (c) {
      var b = state.boards[c];
      b.ytd = ytdBase(b, inSession);
      list.push(b);
    });
    var data = {
      v: SNAP_V, baseDate: state.baseDate, phase: state.phase,
      savedAt: Date.now(), boardTotal: state.boardTotal,
      indexes: state.indexes, boards: state.boards,
      txAmounts: state.txAmounts || null, breadth: state.breadth || null,
      emotion: state.emotion || null, txKline: !!state.txKline,
      stocks: state.stocks || null,
      cloud: state.cloud || null,
      review: state.review || null,
      etfs: state.etfs || null,
      events: state.events || null,
      klineOkN: list.filter(function (b) { return b.klineOk; }).length,
      flowExactN: list.filter(function (b) { return b.flowExact; }).length,
      failN: state.klineFail + state.flowFail,
    };
    Util.store.set(lsKey(), data);
    // 双写：本机服务器快照（data/mkt/{基准日}.json），同机其他浏览器当日零请求直读
    if (SERVER_OK) {
      try {
        fetch("/api/mkt/save?provider=" + activeProvider, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data) }).catch(function () {});
      } catch (e) {}
    }
    renderAll(data);
    loadingGen = -1;
    var klinePart = (data.klineOkN > 0) ? (" · " + data.klineOkN + "/" + state.boardTotal + " 板块") : "";
    var live = state.phase === "open";
    var flowNote = (!data.flowExactN && live && activeProvider === "em") ? " · 资金流为盘中实时（暂无上一交易日收盘缓存）" : "";
    var listNote = state.listFail ? " · 清单缺" + state.listFail : "";
    var txNote = data.txKline ? " · 指数为腾讯降级源" : "";
    chipText("数据截至 " + state.baseDate + " 收盘" + klinePart +
      (data.failN ? " · 失败" + data.failN : "") + flowNote + listNote + txNote, false);
    setRule("基准日 " + state.baseDate + (live ? "（盘中，统计上一交易日）" : "（收盘后，统计当日）") +
      " · 采集于 " + fmtClock(data.savedAt) + " · " +
      (activeProvider === "em" ? "东方财富公开接口（指数快照/日K备用源：腾讯行情）"
                               : PROVIDERS[activeProvider].label + "公开接口（能力边界见各模块提示）"));
  }

  /* ─────────── 渲染 ─────────── */
  /* ─────────── 事件与风险雷达渲染（龙虎榜 / 解禁 / 业绩预告） ─────────── */
  /* ─────────── ETF观察渲染（行情 / 份额变动 / 折溢价——资金借道行为） ─────────── */
  function renderEtfs(data) {
    var host = $("mktEtfWrap");
    if (!host) return;
    var rows = data.etfs;
    if (!rows || !rows.length) {
      host.innerHTML = '<div class="mkt-skel mkt-skel-rows">' + skelBars(5) + "</div>";
      return;
    }
    var cols = [
      { label: "ETF / 主题", left: true, get: function (r) {
          return '<span class="mkt-tag mkt-tag-idx">' + esc(r.theme) + '</span><span class="mkt-name-cell">' + esc(r.name) + "</span>";
        } },
      { label: "收盘", get: function (r) { return r.close === null || r.close === undefined ? "--" : '<span class="mkt-name-cell">' + r.close.toFixed(3) + "</span>"; } },
      { label: "今日涨跌", get: function (r) { return '<span class="' + pctCls(r.pct) + '">' + fmtPct(r.pct) + "</span>"; } },
      { label: "成交额", get: function (r) { return '<span class="mkt-dim-num">' + fmtYi(r.amtYi, 2) + "</span>"; } },
      { label: "最新净值", get: function (r) { return r.nav === null || r.nav === undefined ? "--" : '<span class="mkt-name-cell">' + r.nav.toFixed(4) + "</span>"; } },
      { label: "折溢价", get: function (r) {
          if (r.prem === null) return '<span class="mkt-dim-num">--</span>';
          var warn = Math.abs(r.prem) >= 1;
          return '<span class="' + pctCls(r.prem) + '">' + fmtPct(r.prem, 2) + "</span>" + (warn ? ' <span class="mkt-tag mkt-tag-div" title="折溢价超1%：情绪过热或资金抢筹">警惕</span>' : "");
        } },
      { label: "份额(亿份)", get: function (r) { return r.sharesYi === null || r.sharesYi === undefined ? "--" : '<span class="mkt-dim-num">' + r.sharesYi.toFixed(2) + "</span>"; } },
      { label: "份额变动", get: function (r) {
          if (r.sharesChgYi === null || r.sharesChgYi === undefined) return '<span class="mkt-dim-num">--</span>';
          return '<span class="' + (r.sharesChgYi > 0 ? "mkt-num-up" : "mkt-num-down") + '">' + (r.sharesChgYi > 0 ? "+" : "-") + Math.abs(r.sharesChgYi).toFixed(2) + "亿份</span>";
        } },
      { label: "最新规模", get: function (r) { return r.scaleLatest === null || r.scaleLatest === undefined ? "--" : '<span class="mkt-dim-num">' + r.scaleLatest.toFixed(1) + "亿（" + esc(r.scaleCat || "") + "）</span>"; } },
    ];
    host.innerHTML = rankTable(rows, cols) +
      '<div class="mkt-foot-hint">份额增+折价收敛常是资金进场；溢价高警惕情绪过热。ETF不参与板块强度评分，仅观察资金借道行为。净值T-1，折溢价=市价/净值-1。</div>';
  }
  /* ─────────── 每日复盘渲染（L4 结论与证据链 + L5 资金分类 · 观察点 · 变化量） ─────────── */
  function spectrumBar(score) {
    if (score === null || score === undefined || isNaN(score)) return '<span class="mkt-dim-num">--</span>';
    return '<span class="mkt-spec"><span class="mkt-spec-pin" style="left:' + Math.max(0, Math.min(100, score)).toFixed(0) + '%"></span></span>';
  }
  // 资金分类与风格（规则生成：主线/防御/轮动/兑现）
  function classifyFlows(strengths) {
    var out = [];
    strengths.forEach(function (s2) {
      var mf = s2.mf, mf5 = 0, diffusion = s2.diffusion;
      if (mf === null || mf === undefined) return;
      if (s2.score >= 60 && diffusion >= 50 && mf > 0) {
        out.push({ type: "主线流入", name: s2.name, ev: s2.name + " 强度 " + s2.score + " · 扩散 " + diffusion.toFixed(0) + "% · 主力 " + fmtYi(mf, 1), cls: "mkt-num-up" });
      } else if (mf > 0 && diffusion < 30) {
        out.push({ type: "防御性流入", name: s2.name, ev: s2.name + " 扩散仅 " + diffusion.toFixed(0) + "%，属权重护盘", cls: "mkt-dim-num" });
      } else if (mf > 0) {
        out.push({ type: "轮动性流入", name: s2.name, ev: s2.name + " 当日回流，扩散 " + diffusion.toFixed(0) + "%，持续性待确认", cls: "mkt-dim-num" });
      }
    });
    strengths.slice().reverse().forEach(function (s2) {
      if (s2.mf < -30e8) {
        out.push({ type: "高位兑现", name: s2.name, ev: s2.name + " 当日主力 " + fmtYi(s2.mf, 1) + "（净流出居前）", cls: "mkt-num-down" });
      }
    });
    return out.slice(0, 8);
  }
  function renderReview(data) {
    var host = $("mktReviewWrap");
    if (!host) return;
    if (!cap().flow || !cap().cloud) {
      host.innerHTML = capNote("每日复盘（赚钱效应/板块强度/观察点需东财源的成分与资金数据）");
      return;
    }
    var rv = data.review;
    if (!rv || !rv.heat) {
      host.innerHTML = '<div class="mkt-fail">复盘需东财源全量数据（板块成分/资金流/情绪池），当前数据不足——稍后刷新或切换数据源。</div>';
      return;
    }
    var heat = rv.heat;
    var gates = rv.gates || [];
    var statusTable = rv.statusTable || [];
    var html = "";
    // 结论与证据链
    html += '<div class="mkt-card rv-concl"><h4>结论 · 市场阶段：<span class="mkt-name-cell" style="font-size:16px">' + esc(rv.stage.stage) + "</span>" +
      '<span class="mkt-dim" style="margin-left:10px">置信度 ' + (rv.heat.coverage >= 0.8 ? "高" : (rv.heat.coverage >= 0.6 ? "中" : "低")) +
      "（覆盖率 " + Math.round(rv.heat.coverage * 100) + "%）</span></h4><ul class=\"rv-evid\">";
    rv.stage.evid.forEach(function (e2) { html += "<li>" + esc(e2) + "</li>"; });
    html += "</ul>";
    html += '<div class="rv-heatrow"><span class="rv-k">赚钱效应</span>' + spectrumBar(heat.score) +
      '<span class="mkt-name-cell" style="margin-left:10px">' + heat.score + " / 100 · " + heatBand(heat.score) + "</span></div>";
    html += "</div>";
    // L1 闸门与状态总表
    var gateCols = [
      { label: '检查项', left: true, get: function (r) { return '<span class="mkt-name-cell">' + esc(r.name) + '</span>'; } },
      { label: '数值', left: true, get: function (r) { return '<span class="mkt-dim-num">' + esc(r.val) + '</span>'; } },
      { label: '规则', left: true, get: function (r) { return '<span class="mkt-dim-num">' + esc(r.rule) + '</span>'; } },
      { label: '结果', get: function (r) { return r.ok ? '<span class="mkt-num-up">✓ 未触发</span>' : '<span class="mkt-num-down">⛔ 拦截</span>'; } },
      { label: '说明', left: true, get: function (r) { return r.note ? '<span class="mkt-dim-num">' + esc(r.note) + '</span>' : '<span class="mkt-dim-num">--</span>'; } },
    ];
    var statCols = [
      { label: '数据项', left: true, get: function (r) { return '<span class="mkt-name-cell">' + esc(r.item) + '</span>'; } },
      { label: '状态', get: function (r) { return '<span class="' + (r.st === '已确认' ? 'mkt-num-up' : 'mkt-dim-num') + '">' + esc(r.st) + '</span>'; } },
      { label: '说明', left: true, get: function (r) { return '<span class="mkt-dim-num">' + esc(r.note) + '</span>'; } },
    ];
    html += mktBlock('异常检测闸门 · 数据状态总表', '闸门只决定哪些数据能用，不做行情解释（检出项不进入结论，全部留痕）',
      '<div class="mkt-cards mkt-cards-full"><div class="mkt-card"><h4>异常检测闸门</h4>' + rankTable(gates, gateCols) + '</div>' +
      '<div class="mkt-card"><h4>数据状态总表（四态）</h4>' + rankTable(statusTable, statCols) + '</div></div>');
    // 赚钱效应评分表
    var heatRows = heat.items.map(function (it) { return it; });
    var heatCols = [
      { label: "分项", left: true, get: function (r) { return '<span class="mkt-name-cell">' + esc(r.k) + "</span>"; } },
      { label: "权重", get: function (r) { return '<span class="mkt-dim-num">' + Math.round(r.w * 100) + "%</span>"; } },
      { label: "得分", get: function (r) { return r.score === null ? '<span class="mkt-dim-num">缺失</span>' : '<span class="mkt-name-cell">' + r.score.toFixed(1) + "</span>"; } },
      { label: "贡献", get: function (r) { return r.contrib === null ? '<span class="mkt-dim-num">--</span>' : '<span class="mkt-dim-num">' + r.contrib.toFixed(1) + "</span>"; } },
      { label: "原始值", left: true, get: function (r) { return r.raw === null ? '<span class="mkt-dim-num">缺失→归一</span>' : esc(r.raw); } },
      { label: "状态", get: function (r) { return '<span class="mkt-dim-num">' + esc(r.state) + "</span>"; } },
    ];
    // 板块强度
    var stCols = [
      { label: "板块", left: true, get: function (r) {
          var divTag = r.divergeB ? '<span class="mkt-tag mkt-tag-div" title="价量背离——资金结论不采信">背离</span>' : '';
          return '<span class="mkt-tag mkt-tag-ind">行业</span><span class="mkt-name-cell">' + esc(r.name) + '</span>' + divTag;
        } },
      { label: "强度", get: function (r) { return '<span class="mkt-name-cell">' + r.score.toFixed(1) + "</span>" + spectrumBar(r.score); } },
      { label: "星级", get: function (r) { return '<span class="mkt-star">' + starRating(r.score) + "</span>"; } },
      { label: "扩散度", get: function (r) { return '<span class="' + (r.diffusion >= 50 ? "mkt-num-up" : "mkt-dim-num") + '">' + r.diffusion.toFixed(0) + "%</span>"; } },
      { label: "涨跌", get: function (r) { return '<span class="' + pctCls(r.chg) + '">' + fmtPct(r.chg) + "</span>"; } },
      { label: "主力当日", get: function (r) { return '<span class="' + pctCls(r.mf) + '">' + fmtYi(r.mf, 1) + "</span>"; } },
      { label: "板块内涨停", get: function (r) { return r.ztN > 0 ? '<span class="mkt-num-up">' + r.ztN + " 家</span>" : '<span class="mkt-dim-num">0 家</span>'; } },
      { label: "龙头", left: true, get: function (r) {
          var tip = r.leader ? ("龙头 " + esc(r.leader) + (r.leaderPct !== null ? " " + fmtPct(r.leaderPct, 1) : "")) : "--";
          return '<span class="mkt-dim-num" title="' + esc(tip) + '">' + esc(r.leader || "--") + (r.leaderPct !== null ? " " + fmtPct(r.leaderPct, 1) : "") + "</span>";
        } },
      { label: "近5日", get: function (r) { return r.w5 === null || r.w5 === undefined ? '<span class="mkt-dim-num">--</span>' : '<span class="' + pctCls(r.w5) + '">' + fmtPct(r.w5) + "</span>"; } },
      { label: "近60日", get: function (r) { return r.w60 === null || r.w60 === undefined ? '<span class="mkt-dim-num">--</span>' : '<span class="' + pctCls(r.w60) + '">' + fmtPct(r.w60) + "</span>"; } },
      { label: "主力5日", get: function (r) { return r.mf5sum === null || r.mf5sum === undefined ? '<span class="mkt-dim-num">--</span>' : '<span class="' + pctCls(r.mf5sum) + '">' + fmtYi(r.mf5sum, 1) + "</span>"; } },
      { label: "主力20日", get: function (r) { return r.mf20sum === null || r.mf20sum === undefined ? '<span class="mkt-dim-num">--</span>' : '<span class="' + pctCls(r.mf20sum) + '">' + fmtYi(r.mf20sum, 1) + "</span>"; } },
      { label: "驱动要点", left: true, get: function (r) {
          var bits = [];
          if (r.divergeB) bits.push('<span class="mkt-tag mkt-tag-div" title="价量背离——资金结论不采信">背离</span>');
          if (r.highPos && r.highPos !== "中位") bits.push('<span class="mkt-tag mkt-tag-idx" title="60日累计涨跌位置">' + r.highPos + "</span>");
          bits.push('<span class="mkt-dim-num">' + esc(r.narrative) + "</span>");
          return bits.join(" ");
        } },
    ];
    // 资金分类
    var flowCls = classifyFlows(rv.strengths);
    var fcCols = [
      { label: "类型", left: true, get: function (r) { return '<span class="' + r.cls + '">' + esc(r.type) + "</span>"; } },
      { label: "依据", left: true, get: function (r) { return '<span class="mkt-dim-num">' + esc(r.ev) + "</span>"; } },
    ];
    // 风险清单
    var riskCols = [
      { label: "级", get: function (r) { return '<span class="mkt-tag ' + (r.p === "P0" ? "mkt-tag-div" : r.p === "P1" ? "mkt-tag-ind" : "mkt-tag-con") + '">' + esc(r.p) + "</span>"; } },
      { label: "类别", left: true, get: function (r) { return '<span class="mkt-name-cell">' + esc(r.cat) + "</span>"; } },
      { label: "事实", left: true, get: function (r) { return '<span class="mkt-dim-num">' + esc(r.fact) + "</span>"; } },
      { label: "触发/应对", left: true, get: function (r) { return '<span class="mkt-dim-num">' + esc(r.act) + "</span>"; } },
    ];
    // 个股六维
    var sixCols = [
      { label: "个股", left: true, get: function (r) {
          return '<span class="mkt-dot" style="background:' + (r.color || "#8a96b0") + '"></span><span class="mkt-name-cell">' + esc(r.name) + "</span>";
        } },
      { label: "总分", get: function (r) { return '<span class="mkt-name-cell">' + (r.score === null ? "--" : r.score.toFixed(1)) + "</span>"; } },
      { label: "星级", get: function (r) { return '<span class="mkt-star">' + (r.score === null ? "--" : starRating(r.score)) + "</span>"; } },
      { label: "52周位置", get: function (r) { return (r.pos52 === null ? "--" : spectrumBar(100 - r.pos52) + '<span class="mkt-dim-num" style="margin-left:6px">' + (100 - r.pos52).toFixed(0) + "%</span>"); } },
      { label: "基本面", get: function (r) {
          if (!r.f10 || r.f10.roe === null) return '<span class="mkt-dim-num">缺失</span>';
          return '<span class="' + pctCls(r.f10.roe) + '">ROE ' + r.f10.roe + "%</span>";
        } },
      { label: "资金", get: function (r) { return '<span class="' + pctCls(r.baseMf) + '">' + fmtYi(r.baseMf, 1) + "</span>"; } },
      { label: "情绪", get: function (r) { return r.dims[5].score === null ? '<span class="mkt-dim-num">--</span>' : '<span class="mkt-name-cell">' + r.dims[5].score.toFixed(0) + "</span>"; } },
      { label: "置信", get: function (r) { return '<span class="mkt-dim-num">' + Math.round(r.coverage * 100) + "%</span>"; } },
    ];
    // 可执行参数
    var paramRows = [];
    rv.stockSix.forEach(function (s2) {
      if (s2.roeNeg) {
        paramRows.push({ name: s2.name, close: s2.close, stop: "不设", entry: "不设", target: "不设", why: "基本面恶化 / ROE 为负 → 不列为可交易标的" });
        return;
      }
      var hi52 = s2.hi52, lo52 = s2.lo52, close = s2.close;
      var piv20 = null;
      if (s2.low20 !== null) piv20 = s2.low20;
      var stop = null;
      var pos20Price = (hi52 !== null && lo52 !== null) ? lo52 + (hi52 - lo52) * 0.2 : null;
      if (pos20Price !== null && pos20Price < close) stop = pos20Price;
      if (s2.low20 !== null && s2.low20 < close && (stop === null || close - s2.low20 < close - stop)) stop = s2.low20;
      paramRows.push({
        name: s2.name, close: close,
        stop: stop !== null ? stop.toFixed(2) + "（" + ((stop / close - 1) * 100).toFixed(1) + "%）" : "不设",
        entry: stop !== null ? (close * 0.97).toFixed(2) + " ~ " + (close * 0.94).toFixed(2) : "不设",
        target: hi52 !== null ? hi52.toFixed(2) + "（52周高点方向）" : "不设",
        why: stop !== null ? "止损=近20日低点与52周20%分位价中低于现价且更近者；介入=现价下方3%-6%" : "锚点缺失",
      });
    });
    var paramCols = [
      { label: "标的", left: true, get: function (r) { return '<span class="mkt-name-cell">' + esc(r.name) + "</span>"; } },
      { label: "现价", get: function (r) { return '<span class="mkt-name-cell">' + (r.close === null ? "--" : r.close.toFixed(2)) + "</span>"; } },
      { label: "止损位", get: function (r) { return '<span class="' + (r.stop === "不设" ? "mkt-dim-num" : "mkt-num-down") + '">' + r.stop + "</span>"; } },
      { label: "介入区间", get: function (r) { return '<span class="mkt-dim-num">' + r.entry + "</span>"; } },
      { label: "目标", get: function (r) { return '<span class="mkt-num-up">' + r.target + "</span>"; } },
      { label: "锚点说明", left: true, get: function (r) { return '<span class="mkt-dim-num">' + esc(r.why) + "</span>"; } },
    ];
    // 观察点回验
    var obsCols = [
      { label: "观察点", left: true, get: function (r) { return esc(r.label); } },
      { label: "判定条件", left: true, get: function (r) { return '<span class="mkt-dim-num">' + esc(r.cond) + "</span>"; } },
      { label: "结果", get: function (r) {
          var cls = r.result === "兑现" ? "mkt-num-up" : r.result === "未兑现" ? "mkt-num-down" : "mkt-dim-num";
          return '<span class="' + cls + '">' + esc(r.result) + "</span>";
        } },
    ];
    var obsRows = rv.obs.verified.length ? rv.obs.verified : null;
    var newPts = rv.obs.newPts.map(function (p2) { return { label: p2.label, cond: p2.cond }; });
    var newCols = [
      { label: "观察点", left: true, get: function (r) { return esc(r.label); } },
      { label: "判定条件", left: true, get: function (r) { return '<span class="mkt-dim-num">' + esc(r.cond) + "</span>"; } },
    ];
    // 变化量
    var chgRows = rv.changes;
    var chgCols = [
      { label: "指标", left: true, get: function (r) { return esc(r.k); } },
      { label: "今日", get: function (r) { return '<span class="mkt-name-cell">' + esc(r.today) + "</span>"; } },
      { label: "昨日", get: function (r) { return '<span class="mkt-dim-num">' + esc(r.prev) + "</span>"; } },
      { label: "变化", get: function (r) { return '<span class="' + pctCls(r.delta) + '">' + esc(r.deltaTxt) + "</span>"; } },
    ];
    html += mktBlock("赚钱效应评分", "覆盖率 " + Math.round(heat.coverage * 100) + "% · 缺失分项按剩余权重归一，绝不当 0 分",
      '<div class="mkt-card">' + rankTable(heatRows, heatCols) + spectrumBar(heat.score) + "</div>");
    html += mktBlock("板块强度 TOP10", "扩散度优先（权重30%），不看单一涨幅——防权重拉指数误判",
      '<div class="mkt-card">' + (rv.strengths.length ? rankTable(rv.strengths.slice(0, 10), stCols) : '<div class="mkt-fail">暂无板块强度数据</div>') + "</div>");
    html += mktBlock("资金分类与风格", "主线流入 / 防御性流入 / 轮动性流入 / 高位兑现",
      '<div class="mkt-card">' + (flowCls.length ? rankTable(flowCls, fcCols) : '<div class="mkt-fail">暂无资金分类数据</div>') + "</div>");
    html += mktBlock("风险清单", "P0/P1/P2 规则生成——用于提前排雷，而非收盘后追热点",
      '<div class="mkt-card">' + rankTable(rv.risks, riskCols) + "</div>");
    html += mktBlock("观察池 · 个股六维性价比", "估值 / 52周位置 / 基本面 / 资金 / 融资 / 情绪趋势（估值分位缺失→归一，ROE为负→不设参数）",
      '<div class="mkt-card">' + rankTable(rv.stockSix, sixCols) + "</div>");
    html += mktBlock("可执行参数", "止损 = 近20日低点与52周20%分位价取低更近者 · 介入 = 现价下方3%-6% · 目标 = 52周高点方向",
      '<div class="mkt-card">' + rankTable(paramRows, paramCols) + "</div>");
    html += mktBlock("观察点回验与今日观察点", "昨日观察点自动回验（兑现/未兑现）——昨日判断错误在本节明说",
      '<div class="mkt-cards">' +
      '<div class="mkt-card"><h4>昨日观察点回验</h4>' + (obsRows ? rankTable(obsRows, obsCols) : '<div class="mkt-fail">无上一交易日观察点（首次运行）——今日观察点已生成，下一交易日自动回验。</div>') + "</div>" +
      '<div class="mkt-card"><h4>今日观察点</h4>' + rankTable(newPts, newCols) + "</div>" +
      "</div>");
    if (chgRows.length) {
      html += mktBlock("变化量（vs 上一交易日快照）", "不可比指标不推测、不填值",
        '<div class="mkt-card">' + rankTable(chgRows, chgCols) + "</div>");
    }
    host.innerHTML = html;
  }
  function yjygTypeCls(t) {
    if (!t) return "mkt-dim-num";
    if (t.indexOf("预增") >= 0 || t.indexOf("扭亏") >= 0 || t.indexOf("略增") >= 0) return "mkt-num-up";
    if (t.indexOf("预减") >= 0 || t.indexOf("首亏") >= 0 || t.indexOf("略减") >= 0 || t.indexOf("亏损") >= 0) return "mkt-num-down";
    return "mkt-dim-num";
  }
  function renderEvents(data) {
    var host = $("mktEventsWrap");
    if (!host) return;
    if (!cap().events) { host.innerHTML = capNote("龙虎榜、解禁与业绩预告"); return; }
    var ev = data.events || {};
    var lhbCols = [
      { label: "股票", left: true, w: "22%", get: function (r) { return '<span class="mkt-name-cell">' + esc(r.name) + "</span>"; } },
      { label: "净买入", get: function (r) { return '<span class="' + pctCls(r.net) + '">' + fmtYi(r.net, 2) + "</span>"; } },
      { label: "涨跌幅", get: function (r) { return '<span class="' + pctCls(r.chg) + '">' + fmtPct(r.chg) + "</span>"; } },
      { label: "次日", get: function (r) { return r.d1 === null || r.d1 === undefined ? '<span class="mkt-dim-num">--</span>' : '<span class="' + pctCls(r.d1) + '">' + fmtPct(r.d1, 1) + "</span>"; } },
      { label: "上榜原因", left: true, w: "36%", get: function (r) { return '<span class="mkt-dim-num mkt-ellip" title="' + esc(r.why) + '">' + esc(r.why) + "</span>"; } },
    ];
    var liftCols = [
      { label: "股票", left: true, w: "26%", get: function (r) { return '<span class="mkt-name-cell">' + esc(r.name) + "</span>"; } },
      { label: "解禁日", get: function (r) { return '<span class="mkt-dim-num">' + esc(r.date || "--") + "</span>"; } },
      { label: "解禁市值", get: function (r) { return '<span class="mkt-name-cell">' + (r.capYi === null ? "--" : fmtYi(r.capYi, 1)) + "</span>"; } },
      { label: "类型", left: true, w: "34%", get: function (r) { return '<span class="mkt-dim-num mkt-ellip" title="' + esc(r.type) + '">' + esc(r.type) + "</span>"; } },
    ];
    var yjCols = [
      { label: "股票", left: true, w: "24%", get: function (r) { return '<span class="mkt-name-cell">' + esc(r.name) + "</span>"; } },
      { label: "类型", w: "16%", get: function (r) { return '<span class="' + yjygTypeCls(r.type) + '">' + esc(r.type) + "</span>"; } },
      { label: "净利区间", get: function (r) { return '<span class="mkt-dim-num">' + fmtRange(r.lo, r.hi) + "</span>"; } },
      { label: "变动幅度", get: function (r) {
          if (r.ampLo === null && r.ampHi === null) return '<span class="mkt-dim-num">--</span>';
          var v = r.ampHi !== null ? r.ampHi : r.ampLo;
          return '<span class="' + pctCls(v) + '">' + fmtPct(v, 0) + "</span>";
        } },
      { label: "公告日", w: "16%", get: function (r) { return '<span class="mkt-dim-num">' + esc(r.notice || "--") + "</span>"; } },
    ];
    var empty = function (t) { return '<div class="mkt-fail">' + t + "</div>"; };
    host.innerHTML =
      '<div class="mkt-card"><h4>龙虎榜 · 净买入 TOP8 <span class="mkt-dim">近3个交易日</span></h4>' +
      (ev.lhbBuy && ev.lhbBuy.length ? rankTable(ev.lhbBuy, lhbCols) : empty("暂无龙虎榜数据")) + "</div>" +
      '<div class="mkt-card"><h4>龙虎榜 · 净卖出 TOP8</h4>' +
      (ev.lhbSell && ev.lhbSell.length ? rankTable(ev.lhbSell, lhbCols) : empty("暂无龙虎榜数据")) + "</div>" +
      '<div class="mkt-card"><h4>未来30天解禁 TOP10 <span class="mkt-dim">按解禁市值</span></h4>' +
      (ev.lift && ev.lift.length ? rankTable(ev.lift, liftCols) : empty("暂无解禁数据")) + "</div>" +
      '<div class="mkt-card"><h4>最新业绩预告 <span class="mkt-dim">近3日公告 · 按预告上限排序</span></h4>' +
      (ev.yjyg && ev.yjyg.length ? rankTable(ev.yjyg, yjCols) : empty("暂无业绩预告")) + "</div>" +
      '<div class="mkt-foot-hint">龙虎榜"次日"= 上榜次一交易日涨跌幅（事后验证）；解禁市值单位为亿元，解禁前后常有一次定价；业绩预告按预告净利润上限排序。短线的大亏往往来自解禁、减持与业绩变脸——本表用于提前排雷，而非收盘后追热点。</div>';
  }

  function renderAll(data) {
    if (!$("mktIdxWrap")) ensureSkeleton();
    currentBaseDate = data.baseDate || currentBaseDate;
    renderIndexes(data);
    renderToday(data);
    renderCloud(data);
    renderYtd(data);
    renderRisk(data);
    renderEvents(data);
    renderWindows(data);
    renderStocks(data);
    renderEtfs(data);
    renderValuation(data);
    renderReview(data);
  }

  /* ─────────── 估值与定投档位 ─────────── */
  // 腾讯快照批量获取指数PE-TTM/股息率（field [39]=PE-TTM / [49]=股息率%，已实测验证）
  function fetchValQuotes() {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; s.remove(); resolve({}); } }, 10000);
      s.src = "https://qt.gtimg.cn/q=" + VAL_INDEXES.map(function (ix) { return ix.tx; }).join(",");
      s.onload = function () {
        if (done) return;
        done = true; clearTimeout(to); s.remove();
        var out = {};
        VAL_INDEXES.forEach(function (ix) {
          try {
            var raw = window["v_" + ix.tx];
            if (typeof raw !== "string") return;
            var p = raw.split("~");
            out[ix.tx] = { pe: num(p[39]), dy: num(p[49]) };
          } catch (e) {}
        });
        resolve(out);
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); s.remove(); resolve({}); } };
      document.head.appendChild(s);
    });
  }
  // 10Y国债收益率（chinamoney GET，best effort——失败不阻塞）
  function fetch10YYield() {
    var url = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/ClsYldCurvHis?lang=CN&reference=1&bondType=CYCC000&termId=10&pageSize=5&pageNum=1";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var records = d && d.data && d.data.records || [];
        if (!records.length) return null;
        var last = records[records.length - 1];
        for (var k in last) {
          if (typeof last[k] === "number" && last[k] > 1 && last[k] < 8) return last[k];
        }
        return null;
      }).catch(function () { return null; });
  }
  // 估值快照积累 + 百分位计算
  function valSnapGet() {
    var s = Util.store.get(VAL_SNAP_KEY, {});
    return s && typeof s === "object" ? s : {};
  }
  function valSnapSave(s) {
    Util.store.set(VAL_SNAP_KEY, s);
  }
  function renderValuation(data) {
    var host = $("mktValWrap");
    if (!host) return;
    var quotes = data.valQuotes || {};
    if (!Object.keys(quotes).length) {
      // fire-and-forget：无快照缓存时从腾讯快照拉取（独立于数据源，每次进入自动执行）
      fetchValQuotes().then(function (q) {
        if (!Object.keys(q).length) { host.innerHTML = capNote("指数PE/PB/股息率"); return; }
        var snaps = valSnapGet();
        var today = bjNow().date;
        if (!snaps[today]) snaps[today] = {};
        VAL_INDEXES.forEach(function (ix) {
          var v = q[ix.tx];
          if (v && v.pe !== null && v.pe !== undefined) { snaps[today][ix.tx] = v; }
        });
        valSnapSave(snaps);
        renderValuation({ valQuotes: q });
      });
      return;
    }
    var html = '<table class="mkt-table"><thead><tr>' +
      "<th>指数</th><th>PE-TTM</th><th>股息率</th><th>PE百分位</th><th>定投档位</th></tr></thead><tbody>";
    var snaps = valSnapGet();   /* 修复：历史快照用于百分位计算（此前裸引用会抛 ReferenceError） */
    VAL_INDEXES.forEach(function (ix) {
      var q = quotes[ix.tx];
      if (!q || q.pe === null || q.pe === undefined) return;
      var snapsArr = [];
      Object.keys(snaps).forEach(function (d) {
        var v = snaps[d] && snaps[d][ix.tx];
        if (v && v.pe !== null && v.pe !== undefined) snapsArr.push(v.pe);
      });
      snapsArr.sort(function (a, b) { return a - b; });
      var pctile = null;
      if (snapsArr.length >= 20) {
        var below = 0;
        for (var i = 0; i < snapsArr.length; i++) { if (snapsArr[i] < q.pe) below++; }
        pctile = below / snapsArr.length * 100;
      }
      var tier = "积累中";
      var tierCls = "mkt-dim-num";
      if (pctile !== null) {
        if (pctile < 30) { tier = "加速"; tierCls = "mkt-num-up"; }
        else if (pctile > 70) { tier = "减速"; tierCls = "mkt-num-down"; }
        else { tier = "正常"; }
      }
      var pctileHtml = pctile !== null
        ? '<span class="' + tierCls + '">' + pctile.toFixed(0) + "%</span>"
        : '<span class="mkt-dim-num" title="每日进入自动积累PE快照，≥20个交易日后可计算百分位">积累中</span>';
      html += "<tr><td class='mkt-name-cell'>" + esc(ix.name) + "</td>" +
        "<td class='" + pctCls(q.pe) + "'>" + (q.pe !== null ? q.pe.toFixed(2) : "--") + "</td>" +
        "<td class='" + pctCls(q.dy) + "'>" + (q.dy !== null ? q.dy.toFixed(2) + "%" : "--") + "</td>" +
        "<td>" + pctileHtml + "</td>" +
        "<td><span class='" + tierCls + "'>" + tier + "</span></td></tr>";
    });
    html += "</tbody></table>" +
      '<div class="mkt-foot-hint">PE百分位 = 当前PE在历史快照中的百分位（自建快照积累，≥20个交易日后可用）。定投规则：PE百分位&lt;30%加速、30%-70%正常、&gt;70%减速。PB与ERP待接入。</div>';
    host.innerHTML = html;
  }

  function sparkSvg(closes, w20) {
    if (!closes || closes.length < 2) return '<span class="mkt-dim-num">--</span>';
    var mn = Math.min.apply(null, closes), mx = Math.max.apply(null, closes);
    var W = 110, H = 26, pad = 2;
    var pts = [];
    for (var i = 0; i < closes.length; i++) {
      var x = pad + (W - 2 * pad) * i / (closes.length - 1);
      var y = pad + (H - 2 * pad) * (1 - (closes[i] - mn) / Math.max(1e-9, mx - mn));
      pts.push(x.toFixed(1) + "," + y.toFixed(1));
    }
    var color = (w20 !== null && w20 < 0) ? "#1fa363" : "#e05a5a";
    return '<svg width="' + W + '" height="' + H + '" style="vertical-align:middle"><polyline points="' +
      pts.join(" ") + '" fill="none" stroke="' + color + '" stroke-width="1.6"/></svg>';
  }

  // 迷你K线（20根：开高低收，红涨绿跌）
  function candleSvg(ohlc) {
    if (!ohlc || ohlc.length < 3) return '<span class="mkt-dim-num">--</span>';
    var mn = Infinity, mx = -Infinity;
    ohlc.forEach(function (k) {
      mn = Math.min(mn, k.l !== null && !isNaN(k.l) ? k.l : k.c);
      mx = Math.max(mx, k.h !== null && !isNaN(k.h) ? k.h : k.c);
    });
    if (mn === Infinity) return '<span class="mkt-dim-num">--</span>';
    var pad = (mx - mn) * 0.06 || 1;
    mn -= pad; mx += pad;
    var W = 132, H = 34, top = 2, bot = 2;
    var ih = H - top - bot;
    var Y = function (v) { return top + ih * (1 - (v - mn) / Math.max(1e-9, mx - mn)); };
    var bw = W / ohlc.length;
    var bodyW = Math.max(2, bw * 0.68);
    var html = '<svg width="' + W + '" height="' + H + '" style="vertical-align:middle">';
    for (var i = 0; i < ohlc.length; i++) {
      var k = ohlc[i];
      if (k.c === null || isNaN(k.c)) continue;
      var up = k.o !== null && !isNaN(k.o) ? k.c >= k.o : (i > 0 && ohlc[i - 1].c !== null ? k.c >= ohlc[i - 1].c : true);
      var col = up ? "#e05a5a" : "#1fa363";
      var xc = (i * bw + bw / 2).toFixed(1);
      var yH = Y(k.h !== null && !isNaN(k.h) ? k.h : k.c).toFixed(1);
      var yL = Y(k.l !== null && !isNaN(k.l) ? k.l : k.c).toFixed(1);
      html += '<line x1="' + xc + '" y1="' + yH + '" x2="' + xc + '" y2="' + yL + '" stroke="' + col + '" stroke-width="1"/>';
      var yO = Y(k.o !== null && !isNaN(k.o) ? k.o : k.c).toFixed(1);
      var yC = Y(k.c).toFixed(1);
      var bt = Math.min(yO, yC), bb = Math.max(1, Math.abs(yC - yO));
      html += '<rect x="' + (i * bw + (bw - bodyW) / 2).toFixed(1) + '" y="' + bt + '" width="' + bodyW.toFixed(1) + '" height="' + bb.toFixed(1) + '" fill="' + col + '"/>';
    }
    return html + "</svg>";
  }

  // 表格内嵌变动幅度条（长度∝|v|/max，红正绿负）
  function inlineBar(v, maxAbs) {
    if (v === null || v === undefined || isNaN(v) || !maxAbs || maxAbs <= 0) return "";
    var w = Math.min(100, Math.abs(v) / maxAbs * 100);
    return '<span class="mkt-ibar"><span class="mkt-ibar-fill ' + (v > 0 ? "up" : "down") + '" style="width:' + w.toFixed(0) + '%"></span></span>';
  }

  // 指数涨跌对比：分组柱状图（今日/近5日/近20日 × 各指数）
  function idxGroupedBarsHtml(indexes) {
    if (!indexes || !indexes.length) return "";
    var wins = [
      { key: "d0", label: "今日" },
      { key: "w5", label: "近5日" },
      { key: "w20", label: "近20日" },
    ];
    var W = 980, H = 190, L = 44, B = 30, T = 14, R = 10;
    var iw = W - L - R, ih = H - T - B;
    var mx = 0;
    indexes.forEach(function (r) {
      wins.forEach(function (wd) {
        var v = r[wd.key];
        if (v !== null && v !== undefined && !isNaN(v)) mx = Math.max(mx, Math.abs(v));
      });
    });
    if (mx <= 0) return '<div class="mkt-fail">暂无指数涨跌数据</div>';
    mx = mx * 1.15;
    var Y = function (v) { return T + ih * (1 - (v + mx) / (2 * mx)); };
    var groupW = iw / indexes.length;
    var barW = Math.min(26, groupW / (wins.length + 2));
    var g = "";
    var k;
    for (k = 0; k <= 4; k++) {
      var v = -mx + 2 * mx * k / 4;
      var y = Y(v).toFixed(1);
      g += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="var(--grid)"/>' +
        '<text x="' + (L - 6) + '" y="' + (+y + 4) + '" text-anchor="end" class="snk-pct">' + v.toFixed(1) + "%</text>";
    }
    g += '<line x1="' + L + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(0).toFixed(1) + '" stroke="var(--t-border)"/>';
    indexes.forEach(function (r, gi) {
      var gx = L + gi * groupW;
      wins.forEach(function (wd, wi) {
        var v = r[wd.key];
        if (v === null || v === undefined || isNaN(v)) return;
        var bh = Math.max(1, Math.abs(v) / mx * (ih / 2));
        var bx = gx + (groupW - wins.length * barW - (wins.length - 1) * 4) / 2 + wi * (barW + 4);
        var col = v > 0 ? "#e05a5a" : "#1fa363";
        var by = v > 0 ? Y(v) : Y(0);
        g += '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bh.toFixed(1) +
          '" fill="' + col + '" rx="2"><title>' + esc(r.ix.name) + " " + wd.label + " " + esc(fmtPct(v)) + "</title></rect>";
      });
      g += '<text x="' + (gx + groupW / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="snk-pct">' + esc(r.ix.name) + "</text>";
    });
    // 图例：每组三根柱依次为 今日/近5日/近20日，柱色=涨跌方向
    var legend = '<span class="mkt-legend"><span class="mkt-legend-item">每组三柱依次为：今日 · 近5日 · 近20日（红涨绿跌）</span></span>';
    return '<div class="mkt-chart mkt-chart-half">' + legend + '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto;display:block">' + g + "</svg>" +
      '<div class="mkt-foot-hint">柱高=涨跌幅绝对值（变幅对比），红=上涨、绿=下跌；悬浮查看精确值。</div></div>';
  }

  // 温度晴雨表：四因子合成温度（0-100）+ 渐变标尺指针
  function emotionGauge(emo, boardUpPct) {
    var upPct = boardUpPct !== null && boardUpPct !== undefined ? boardUpPct : 50;
    var zt = (emo && emo.zt !== null && emo.zt !== undefined) ? emo.zt : null;
    var dt = (emo && emo.dt !== null && emo.dt !== undefined) ? emo.dt : null;
    var zb = (emo && emo.zbRate !== null && emo.zbRate !== undefined) ? emo.zbRate : null;
    var lbN = (emo && emo.lbN) ? emo.lbN : 0;
    // 温度公式（权重与因子均在 title 中说明）：广度45% + 涨停相对强度25% + 封板质量15% + 连板活跃15%
    var ztRatio = (zt !== null && dt !== null && (zt + dt) > 0) ? zt / (zt + dt) * 100 : 50;
    var quality = zb !== null ? 100 - zb : 60;
    var active = Math.min(20, lbN) / 20 * 100;
    var temp = Math.round(upPct * 0.45 + ztRatio * 0.25 + quality * 0.15 + active * 0.15);
    temp = Math.max(0, Math.min(100, temp));
    var zone = temp < 20 ? "冰点" : temp < 40 ? "降温" : temp < 60 ? "中性" : temp < 80 ? "升温" : "过热";
    var zoneColor = temp < 20 ? "#1fa363" : temp < 40 ? "#5cc08d" : temp < 60 ? "#8a96b0" : temp < 80 ? "#ec7d7d" : "#a51c1c";
    var tip = "温度=板块上涨占比×45% + 涨停相对强度×25% + 封板质量(100-炸板率)×15% + 连板活跃×15%；" +
      "当前因子：广度 " + upPct.toFixed(0) + "% · 涨停/跌停强度 " + ztRatio.toFixed(0) + "% · 封板质量 " + quality.toFixed(0) + " · 连板活跃 " + active.toFixed(0);
    var html = '<div class="mkt-gauge" title="' + esc(tip) + '">' +
      '<div class="mkt-gauge-scale">' +
      '<span class="mkt-gauge-pin" style="left:' + temp + '%"></span>' +
      "</div>" +
      '<div class="mkt-gauge-zones"><span>冰点</span><span>降温</span><span>中性</span><span>升温</span><span>过热</span></div>' +
      '<div class="mkt-gauge-num" style="color:' + zoneColor + '"><b>' + temp + "</b>" +
      '<i style="background:' + zoneColor + '">' + esc(zone) + "</i></div>" +
      "</div>";
    return html;
  }

  // 主力资金双向发散条形图（净流入=右侧红条 / 净流出=左侧绿条；悬浮含净占比/连续/5日累计/背离）
  function flowBarsHtml(withFlow) {
    if (!withFlow || !withFlow.length) return '<div class="mkt-fail">暂无资金流数据</div>';
    var all = withFlow.slice();
    all.sort(function (a, b) { return (b.baseMf || 0) - (a.baseMf || 0); });
    // 净流入前10 + 净流出前10（共20行）；此前把全部板块都画出来，卡片被拉成两三千像素高
    var rows = all.slice(0, 10).concat(all.slice(-10).filter(function (x) { return all.indexOf(x) > 9; }));
    var maxAbs = 1;
    rows.forEach(function (r) { maxAbs = Math.max(maxAbs, Math.abs(r.baseMf || 0)); });
    var html = '<div class="mkt-flowbars">';
    rows.forEach(function (r) {
      var v = r.baseMf || 0;
      var w = Math.abs(v) / maxAbs * 50;
      var side = v >= 0 ? "pos" : "neg";
      var nm = String(r.name || "");
      var tip = [];
      if (r.baseMr !== null && r.baseMr !== undefined) tip.push("净占比 " + fmtPct(r.baseMr, 1));
      if (r.mf5sum !== null && r.mf5sum !== undefined) tip.push("5日累计 " + fmtYi(r.mf5sum, 1));
      if (r.flowStreak) tip.push("连续 " + (r.flowStreak > 0 ? r.flowStreak + "天流入" : -r.flowStreak + "天流出"));
      if (r.basePct !== null && r.basePct !== undefined) tip.push("当日 " + fmtPct(r.basePct));
      var diverge = ((r.basePct > 0 && v < 0) || (r.basePct < 0 && v > 0)) ? "【价量背离】" : "";
      var streakTag = r.flowStreak ? '<span class="fb-streak ' + (r.flowStreak > 0 ? "mkt-num-up" : "mkt-num-down") + '">' +
        (r.flowStreak > 0 ? "+" : "−") + Math.abs(r.flowStreak) + "天</span>" : "";
      html += '<div class="fb-row">' +
        '<span class="fb-name" title="' + esc(diverge + tip.join(" · ")) + '">' +
        (diverge ? '<b class="mkt-tag-div">背</b>' : "") + esc(nm.length > 7 ? nm.slice(0, 7) : nm) + "</span>" +
        '<div class="fb-axis"><span class="fb-bar ' + side + '" style="width:' + w.toFixed(1) + '%"></span></div>' +
        '<span class="fb-val ' + pctCls(v) + '">' + fmtYi(v, 2) + streakTag + "</span>" +
        "</div>";
    });
    html += '<div class="fb-scale"><span>净流出 ←</span><span>→ 净流入</span></div></div>';
    return html;
  }

  function renderIndexes(data) {
    var host = $("mktIdxWrap");
    if (!host) return;
    if (!data.indexes || !data.indexes.length) {
      host.innerHTML = '<div class="mkt-fail">指数数据暂不可用（K线接口限流中，稍后刷新恢复）。</div>';
      return;
    }
    var html = '<table class="mkt-table"><thead><tr>' +
      "<th>指数</th><th>收盘</th><th>今日</th><th>成交额</th><th>近5日</th><th>近20日</th><th>上涨家数占比</th><th style='text-align:center'>近20日K线</th></tr></thead><tbody>";
    data.indexes.forEach(function (r) {
      var amt = data.txAmounts && data.txAmounts[r.ix.tx] && data.txAmounts[r.ix.tx].amtYi;
      var bd = null;
      if (data.breadth) {
        for (var i = 0; i < data.breadth.length; i++) { if (data.breadth[i].ix.key === r.ix.key) { bd = data.breadth[i]; break; } }
      }
      var breadthHtml = "--";
      if (bd && bd.pct !== null && bd.pct !== undefined) {
        breadthHtml = '<span class="mkt-breadth-bar"><span style="width:' + bd.pct.toFixed(0) + '%"></span></span>' +
          '<span class="' + (bd.pct >= 50 ? "mkt-num-up" : "mkt-num-down") + '" style="margin-left:6px">' + bd.pct.toFixed(0) + "%</span>";
      }
      html += "<tr><td class='mkt-name-cell'>" + tag("idx") + esc(r.ix.name) +
        " <span class='mkt-dim-num'>" + esc(r.ix.tag) + "</span></td>" +
        "<td>" + (r.close === null || r.close === undefined ? "--" : r.close.toFixed(2)) + "</td>" +
        "<td class='" + pctCls(r.d0) + "'>" + fmtPct(r.d0) + "</td>" +
        "<td class='mkt-dim-num'>" + (amt ? (amt.toFixed(0) + "亿") : "--") + "</td>" +
        "<td class='" + pctCls(r.w5) + "'>" + fmtPct(r.w5) + "</td>" +
        "<td class='" + pctCls(r.w20) + "'>" + fmtPct(r.w20) + "</td>" +
        "<td style='text-align:center'>" + breadthHtml + "</td>" +
        "<td style='text-align:center'>" + candleSvg(r.ohlc) + "</td></tr>";
    });
    html += "</tbody></table>" +
      '<div class="mkt-foot-hint">上涨家数占比为该市场全部个股中上涨占比（广度）：≥50% 偏普涨，明显低于 50% 的指数上涨多为权重拉动；成交额来自腾讯快照；K线为基准日前20个交易日（红涨绿跌）。</div>' +
      idxGroupedBarsHtml(data.indexes);
    host.innerHTML = html;
  }

  // 通用榜单表：cols = [{label, left, get(r), cls(r)}]
  // cols[].w 可指定列宽（如 "24%"）；用 colgroup 定宽，未指定的列均分剩余宽度，
  // 避免"股票 / 上榜原因"这类长文本列各占 42% 把右侧数值列挤成省略号（表格显示不全的根因）
  function rankTable(rows, cols) {
    var html = '<table class="mkt-table"><colgroup><col style="width:30px">';
    cols.forEach(function (c) { html += "<col" + (c.w ? ' style="width:' + c.w + '"' : "") + ">"; });
    html += '</colgroup><thead><tr><th>#</th>';
    cols.forEach(function (c) {
      html += "<th" + (c.left ? " class='mkt-col-name'" : "") + ">" + c.label + "</th>";
    });
    html += "</tr></thead><tbody>";
    rows.forEach(function (r, i) {
      html += "<tr><td class='mkt-rank'>" + (i + 1) + "</td>";
      cols.forEach(function (c) {
        html += "<td" + (c.left ? " class='mkt-name-td'" : "") + ">" + c.get(r) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }
  function nameCell(r) {
    var tip = [];
    if (r.baseMr !== null && r.baseMr !== undefined) tip.push("净占比 " + fmtPct(r.baseMr, 1));
    if (r.leader && r.leader !== "--") tip.push("领涨股 " + r.leader + (r.leaderPct !== null ? " (" + fmtPct(r.leaderPct, 1) + ")" : ""));
    return tag(r.type) + "<span class='mkt-name-cell'" + (tip.length ? " title='" + esc(tip.join(" · ")) + "'" : "") + ">" + esc(r.name) + "</span>";
  }
  // 价量资金背离角标：涨但主力净流出 / 跌但主力净流入（文档P0：反向线索）
  function divergeTag(r) {
    if (r.basePct === null || r.basePct === undefined || r.baseMf === null || r.baseMf === undefined) return "";
    if ((r.basePct > 0 && r.baseMf < 0) || (r.basePct < 0 && r.baseMf > 0)) {
      return '<span class="mkt-tag mkt-tag-div" title="价量资金背离：价格与主力资金方向相反，往往是反向线索">背离</span>';
    }
    return "";
  }
  function streakText(v) {
    if (v === null || v === undefined || v === 0) return '<span class="mkt-dim-num">--</span>';
    if (v > 0) return '<span class="mkt-num-up">' + v + "天流入</span>";
    return '<span class="mkt-num-down">' + (-v) + "天流出</span>";
  }
  // 情绪温度条（涨停/跌停/炸板池 + 板块上涨占比，基准日口径）
  function emotionStrip(emo, boardUpPct) {
    if (!emo || (emo.zt === null || emo.zt === undefined)) return "";
    var items = [
      { k: "涨停", v: emo.zt === null ? "--" : emo.zt + " 家", cls: emo.zt > 0 ? "mkt-num-up" : "" },
      { k: "跌停", v: emo.dt === null || emo.dt === undefined ? "--" : emo.dt + " 家", cls: emo.dt > 0 ? "mkt-num-down" : "" },
      { k: "最高连板", v: emo.maxLb ? emo.maxLb + " 天" : "--", cls: "" },
      { k: "连板家数", v: emo.lbN ? emo.lbN + " 家" : "--", cls: "" },
      { k: "炸板率", v: emo.zbRate === null || emo.zbRate === undefined ? "--" : emo.zbRate.toFixed(0) + "%", cls: emo.zbRate >= 40 ? "mkt-num-down" : "mkt-dim-num",
        tip: "炸板率=炸板/(涨停+炸板)，越高说明封板越弱、分歧越大" },
      { k: "板块上涨占比", v: boardUpPct === null ? "--" : boardUpPct.toFixed(0) + "%", cls: boardUpPct !== null && boardUpPct >= 50 ? "mkt-num-up" : "mkt-num-down",
        tip: "行业板块中当日上涨的占比：低占比的指数上涨多为权重拉动" },
    ];
    var html = '<div class="mkt-emo">';
    items.forEach(function (it) {
      html += '<span class="mkt-emo-item"' + (it.tip ? " title='" + esc(it.tip) + "'" : "") + ">" +
        '<b>' + it.k + '</b><span class="' + it.cls + '">' + it.v + "</span></span>";
    });
    return html + '<span class="mkt-emo-tip">情绪温度（基准日收盘口径）</span></div>';
  }

  // 行业板块当日上涨占比（有≥5个板块数据时计算，否则 null）
  function boardUpPctOf(list) {
    var ind = list.filter(function (b) { return b.type === "ind" && b.f3 !== null; });
    if (ind.length < 5) return null;
    var up = 0;
    ind.forEach(function (b) { if (b.f3 > 0) up++; });
    return up / ind.length * 100;
  }

  function renderToday(data) {
    var host = $("mktTodayWrap");
    if (!host) return;
    var list = [];
    Object.keys(data.boards).forEach(function (c) { list.push(data.boards[c]); });
    var boardUpPct = boardUpPctOf(list);
    if (!cap().flow) {
      // 非东财源：保留广度仪表，资金流/情绪池/振幅标注能力边界
      host.innerHTML = '<div class="mkt-emoline">' + emotionGauge(data.emotion, boardUpPct) + emotionStrip(data.emotion, boardUpPct) + "</div>" +
        capNote("板块主力资金流向、涨跌停池与振幅明细");
      return;
    }
    var withFlow = list.filter(function (b) { return b.baseMf !== null && b.baseMf !== undefined; });   // list 已在上面取过一次，勿重复 push（会让每项出现两次）
    var flowNote = "";
    if (!withFlow.length) {
      // 兜底：fflow 全部失败 → 用 clist 实时值并标注
      withFlow = list.filter(function (b) { return b.mf !== null && b.mf !== undefined; });
      withFlow.forEach(function (b) { b.baseMf = b.mf; b.baseMr = b.mr; });
      flowNote = '<div class="mkt-foot-hint">当前为实时资金流快照（板块资金流日K限流中，连续天数/5日累计暂缺）。</div>';
    }
    // 涨跌幅兜底：无K线数据（限流）时退回 clist 实时值，并按口径标注
    var pctNote = "";
    list.forEach(function (b) {
      if ((b.basePct === null || b.basePct === undefined) && b.f3 !== null) { b.basePct = b.f3; b.pctFallback = true; }
      if ((b.baseAmp === null || b.baseAmp === undefined) && b.f7 !== null) { b.baseAmp = b.f7; b.pctFallback = true; }
    });
    if (list.some(function (b) { return b.pctFallback; })) {
      pctNote = data.phase === "closed"
        ? '<div class="mkt-foot-hint">部分涨跌/振幅为收盘实时值（板块日K接口限流中）。</div>'
        : '<div class="mkt-foot-hint">部分涨跌/振幅为盘中实时值（板块日K接口限流中，收盘后自动转为收盘口径）。</div>';
    }
    withFlow.sort(function (a, b) { return (b.baseMf || 0) - (a.baseMf || 0); });
    var amp = list.filter(function (b) { return b.baseAmp !== null && b.baseAmp !== undefined; })
      .sort(function (a, b) { return b.baseAmp - a.baseAmp; }).slice(0, 10);


    var ampCols = [
      { label: "板块 / 题材", left: true, w: "34%", get: nameCell },
      { label: "振幅", get: function (r) { return '<span class="mkt-name-cell">' + fmtPct(r.baseAmp, 2) + "</span>"; } },
      { label: "收盘位置", get: function (r) {
          return r.closePos === null || r.closePos === undefined
            ? '<span class="mkt-dim-num">--</span>'
            : '<span class="mkt-name-cell" title="收盘位置=(收盘−最低)/(最高−最低)：高=收在高位，低=冲高回落">' + r.closePos.toFixed(0) + "%</span>";
        } },
      { label: "涨跌幅", get: function (r) { return '<span class="' + pctCls(r.basePct) + '">' + fmtPct(r.basePct) + "</span>"; } },
      { label: "主力净流入", get: function (r) { return '<span class="' + pctCls(r.baseMf) + '">' + fmtYi(r.baseMf) + "</span>"; } },
    ];
    host.innerHTML =
      '<div class="mkt-emoline">' + emotionGauge(data.emotion, boardUpPct) + emotionStrip(data.emotion, boardUpPct) + "</div>" +
      '<div class="mkt-cards">' +
      '<div class="mkt-card"><h4>主力资金流向 <span class="mkt-dim">基准日净额 · 红入绿出 · 净流入/净流出各前10 · 悬浮看净占比/连续/5日累计/背离</span></h4>' +
      flowBarsHtml(withFlow) + "</div>" +
      '<div class="mkt-card"><h4>振幅最大 TOP10 <span class="mkt-dim">板块与题材 · 含收盘位置</span></h4>' +
      (amp.length ? rankTable(amp, ampCols) : '<div class="mkt-fail">暂无振幅数据</div>') + "</div>" +
      "</div>" + flowNote + pctNote;
  }

  function renderYtd(data) {
    var host = $("mktYtdWrap");
    if (!host) return;
    if (!cap().boards) { host.innerHTML = capNote("板块年初至今涨跌"); return; }
    var inSession = data.phase === "open";
    var list = [];
    Object.keys(data.boards).forEach(function (c) {
      var b = data.boards[c];
      if (b.ytd === undefined) b.ytd = ytdBase(b, inSession);
      if (b.ytd !== null) list.push(b);
    });
    list.sort(function (a, b) { return b.ytd - a.ytd; });
    if (!list.length) { host.innerHTML = capNote("板块年初至今涨跌（当前数据源不提供该口径）"); return; }
    var ytdMax = 1;
    list.forEach(function (b) { ytdMax = Math.max(ytdMax, Math.abs(b.ytd || 0)); });
    var up = list.slice(0, 10), down = list.slice(-10).reverse();
    var cols = [
      { label: "板块 / 题材", left: true, w: "32%", get: nameCell },
      { label: "今年来", w: "24%", get: function (r) { return '<span class="' + pctCls(r.ytd) + '">' + fmtPct(r.ytd) + "</span>" + inlineBar(r.ytd, ytdMax); } },
      { label: "近5日", get: function (r) { return '<span class="' + pctCls(r.w5) + '">' + fmtPct(r.w5) + "</span>"; } },
      { label: "近20日", get: function (r) { return '<span class="' + pctCls(r.w20) + '">' + fmtPct(r.w20) + "</span>"; } },
    ];
    var y0 = (data.baseDate || "").slice(0, 4);
    host.innerHTML =
      '<div class="mkt-card"><h4>今年来涨幅最大 TOP10</h4>' + rankTable(up, cols) + "</div>" +
      '<div class="mkt-card"><h4>今年来跌幅最大 TOP10</h4>' + rankTable(down, cols) + "</div>" +
      '<div class="mkt-foot-hint">口径：' + esc(y0) + "-01-01 ~ " + esc(data.baseDate || "--") +
      "（板块指数收盘价，起点为年初首交易日收盘；盘中已剔除今日未收盘贡献）。成分调整可能导致跨年口径漂移。</div>";
  }

  // 板块风险性价比（表E）：与基金筛选的风险指标同口径——波动 / 回撤 / 收益波动比 / 收益回撤比
  function fmt2(v) {
    if (v === null || v === undefined || isNaN(v)) return "--";
    return v.toFixed(2);
  }
  function renderRisk(data) {
    var host = $("mktRiskWrap");
    if (!host) return;
    if (activeProvider !== "em") { host.innerHTML = capNote("板块风险性价比（需板块日K）"); return; }
    var list = [];
    Object.keys(data.boards).forEach(function (c) {
      var b = data.boards[c];
      if (!b.pcts20 || b.pcts20.length < 15 || !b.closesW || b.closesW.length < 10) return;
      if (b.w20 === null || b.w20 === undefined) return;
      var mean = 0, i;
      for (i = 0; i < b.pcts20.length; i++) mean += b.pcts20[i];
      mean /= b.pcts20.length;
      var vari = 0;
      for (i = 0; i < b.pcts20.length; i++) { var d = b.pcts20[i] - mean; vari += d * d; }
      vari /= Math.max(1, b.pcts20.length - 1);
      var annVol = Math.sqrt(vari) * Math.sqrt(252);
      var peak = b.closesW[0], mdd = 0;
      for (i = 1; i < b.closesW.length; i++) {
        if (b.closesW[i] > peak) peak = b.closesW[i];
        var dd = (b.closesW[i] / peak - 1) * 100;
        if (dd < mdd) mdd = dd;
      }
      list.push({
        b: b, annVol: annVol, mdd: mdd,
        ratio: annVol > 0 ? b.w20 / annVol : null,
        calmar: mdd < 0 ? b.w20 / Math.abs(mdd) : null,
      });
    });
    list = list.filter(function (x) { return x.ratio !== null; });
    list.sort(function (a, b2) { return b2.ratio - a.ratio; });
    var top = list.slice(0, 10);
    var cols = [
      { label: "板块 / 题材", left: true, w: "30%", get: function (r) { return nameCell(r.b); } },
      { label: "近20日", get: function (r) { return '<span class="' + pctCls(r.b.w20) + '">' + fmtPct(r.b.w20) + "</span>"; } },
      { label: "年化波动", get: function (r) { return fmtPct(r.annVol, 1); } },
      { label: "最大回撤", get: function (r) { return '<span class="mkt-num-down">' + fmtPct(r.mdd, 1) + "</span>"; } },
      { label: "收益/波动", get: function (r) { return '<span class="mkt-name-cell">' + fmt2(r.ratio) + "</span>"; } },
      { label: "收益/回撤", get: function (r) { return '<span class="mkt-name-cell">' + fmt2(r.calmar) + "</span>"; } },
    ];
    host.innerHTML =
      (top.length ? rankTable(top, cols) : '<div class="mkt-fail">风险指标需板块日K（接口限流中暂缺，稍后刷新恢复）。</div>') +
      '<div class="mkt-foot-hint">与基金筛选的夏普/回撤同源口径：年化波动 = 近20日日涨幅标准差 × √252；最大回撤、收益/波动比、收益/回撤比（简化卡玛）均截至基准日近20个交易日；行业板块全量，题材取自候选池。用于回答「该热点值得用基金承接还是只适合短线」。</div>';
  }

  // 窗口累计涨跌榜（严格基准日口径，来自板块日K）
  function windowTop(data, key, n, asc) {
    var list = [];
    Object.keys(data.boards).forEach(function (c) {
      var b = data.boards[c];
      if (b[key] !== null && b[key] !== undefined) list.push(b);
    });
    list.sort(function (a, b) { return asc ? a[key] - b[key] : b[key] - a[key]; });
    return list.slice(0, n);
  }

  function renderWindows(data) {
    var sankeyHost = $("mktSankeyWrap");
    if (activeProvider !== "em") {
      var note = capNote("近5日/20日窗口与题材桑基（需板块日K）");
      if (sankeyHost) sankeyHost.innerHTML = note;
      var tw = document.getElementById("mktWindowWrap");
      if (tw) tw.innerHTML = note;
      return;
    }
    var tblHost = $("mktWindowWrap");
    if (!sankeyHost || !tblHost) return;
    sankeyHost.innerHTML =
      '<div class="mkt-sanki"><h4>涨幅题材轮动（桑基）</h4>' + sankeySvg(data, false) + "</div>" +
      '<div class="mkt-sanki"><h4>跌幅题材轮动（桑基）</h4>' + sankeySvg(data, true) + "</div>";

    function mini(rows, key) {
      var mx = 1;
      rows.forEach(function (r) { mx = Math.max(mx, Math.abs(r[key] || 0)); });
      var cols = [
        { label: "题材 / 板块", left: true, w: "46%", get: nameCell },
        { label: "累计涨跌", get: function (r) { return '<span class="' + pctCls(r[key]) + '">' + fmtPct(r[key]) + "</span>" + inlineBar(r[key], mx); } },
        { label: "今日", get: function (r) { return '<span class="' + pctCls(r.basePct) + '">' + fmtPct(r.basePct) + "</span>"; } },
      ];
      return rankTable(rows, cols);
    }
    tblHost.innerHTML =
      '<div class="mkt-card"><h4>近5日涨幅最大 <span class="mkt-dim">累计%</span></h4>' + mini(windowTop(data, "w5", 8, false), "w5") + "</div>" +
      '<div class="mkt-card"><h4>近5日跌幅最大 <span class="mkt-dim">累计%</span></h4>' + mini(windowTop(data, "w5", 8, true), "w5") + "</div>" +
      '<div class="mkt-card"><h4>近20日涨幅最大 <span class="mkt-dim">累计%</span></h4>' + mini(windowTop(data, "w20", 8, false), "w20") + "</div>" +
      '<div class="mkt-card"><h4>近20日跌幅最大 <span class="mkt-dim">累计%</span></h4>' + mini(windowTop(data, "w20", 8, true), "w20") + "</div>" +
      '<div class="mkt-foot-hint">窗口为截至基准日（' + esc(data.baseDate) + " 收盘）的交易日累计涨跌幅；行业板块全量计算，题材按各窗口榜单极值纳入候选池。窗口数据需板块日K，接口限流时显示为空，稍后刷新恢复。</div>";
  }

  /* ─────────── 个股动向（市场页底部【个股】部分） ─────────── */
  function mfBarsSvg(series) {
    if (!series || !series.length) return '<span class="mkt-dim-num">--</span>';
    var W = 96, H = 24, mid = H / 2;
    var max = 1;
    for (var i = 0; i < series.length; i++) max = Math.max(max, Math.abs(series[i]));
    var bw = W / series.length;
    var html = '<svg width="' + W + '" height="' + H + '" style="vertical-align:middle" title="近20个交易日每日主力净流入（红=净流入，绿=净流出）">';
    html += '<line x1="0" y1="' + mid + '" x2="' + W + '" y2="' + mid + '" stroke="var(--t-border)" stroke-width="1"/>';
    for (var j = 0; j < series.length; j++) {
      var v = series[j];
      var h = Math.max(1, Math.abs(v) / max * (mid - 2));
      var x = (j * bw + 0.5).toFixed(1), w = Math.max(1, bw - 1.2).toFixed(1);
      if (v >= 0) html += '<rect x="' + x + '" y="' + (mid - h).toFixed(1) + '" width="' + w + '" height="' + h.toFixed(1) + '" fill="#e05a5a"/>';
      else html += '<rect x="' + x + '" y="' + mid + '" width="' + w + '" height="' + h.toFixed(1) + '" fill="#1fa363"/>';
    }
    return html + "</svg>";
  }

  // 近20日累计涨跌多线对比图（各股归一化到窗口起点=0）
  function stocksChartHtml(data) {
    var series = [];
    Object.keys(data.stocks).forEach(function (k) {
      var st = data.stocks[k];
      if (st.cmp && st.cmp.length >= 2 && st.ok) {
        var pts = [];
        for (var i = 0; i < st.cmp.length; i++) pts.push((st.cmp[i] / st.cmp[0] - 1) * 100);
        series.push({ name: st.name, color: st.color, pts: pts, dates: st.dates });
      }
    });
    if (!series.length) return '<div class="mkt-fail">走势对比需个股日K（接口限流中暂缺，稍后刷新恢复）。</div>';
    var W = 980, H = 240, L = 46, R = 110, T = 12, B = 26;
    var iw = W - L - R, ih = H - T - B;
    var mn = Infinity, mx = -Infinity;
    series.forEach(function (s2) {
      s2.pts.forEach(function (v) { if (v < mn) mn = v; if (v > mx) mx = v; });
    });
    if (mn === Infinity) return '<div class="mkt-fail">暂无数据</div>';
    var pad = (mx - mn) * 0.08 || 1;
    mn -= pad; mx += pad;
    var X = function (i) { return L + iw * i / (series[0].pts.length - 1); };
    var Y = function (v) { return T + ih * (1 - (v - mn) / Math.max(1e-9, mx - mn)); };
    var g = "";
    var k;
    for (k = 0; k <= 4; k++) {
      var v = mn + (mx - mn) * k / 4;
      var y = Y(v).toFixed(1);
      g += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="var(--grid)"/>' +
        '<text x="' + (L - 6) + '" y="' + (+y + 4) + '" text-anchor="end" class="snk-pct">' + v.toFixed(0) + "%</text>";
    }
    if (mn < 0 && mx > 0) {
      g += '<line x1="' + L + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(0).toFixed(1) +
        '" stroke="var(--t-border)" stroke-dasharray="4 3"/>';
    }
    var dates = series[0].dates || [];
    for (k = 0; k <= 4; k++) {
      var di = Math.round((series[0].pts.length - 1) * k / 4);
      g += '<text x="' + X(di).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="snk-pct">' +
        esc((dates[di] || "").slice(5)) + "</text>";
    }
    series.forEach(function (s2) {
      var d = "";
      for (var i = 0; i < s2.pts.length; i++) d += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(s2.pts[i]).toFixed(1);
      g += '<path d="' + d + '" fill="none" stroke="' + s2.color + '" stroke-width="1.8"/>';
      var ly = Y(s2.pts[s2.pts.length - 1]);
      g += '<text x="' + (W - R + 8) + '" y="' + (+ly + 4).toFixed(1) + '" font-size="11" fill="' + s2.color + '">' +
        esc(s2.name) + " " + fmtPct(s2.pts[s2.pts.length - 1], 1) + "</text>";
    });
    return '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto">' + g + "</svg>";
  }

  function renderStocks(data) {
    var host = $("mktStocksWrap");
    if (!host) return;
    var rows = [];
    Object.keys(data.stocks).forEach(function (k) { rows.push(data.stocks[k]); });
    if (!rows.length) {
      host.innerHTML = '<div class="mkt-fail">个股数据暂不可用（行情接口限流中，稍后刷新恢复）。</div>';
      return;
    }
    var anyOk = rows.some(function (r) { return r.ok; });
    if (!anyOk) {
      host.innerHTML = '<div class="mkt-fail">个股数据暂不可用（行情接口限流中，稍后刷新恢复）。</div>';
      return;
    }
    var cols = [
      { label: "个股", left: true, w: "17%", get: function (r) {
          var tip = r.amountYi ? ("成交额 " + r.amountYi.toFixed(1) + "亿") : "";
          return '<span class="mkt-dot" style="background:' + (r.color || "#8a96b0") + '"></span>' +
            '<span class="mkt-name-cell"' + (tip ? " title='" + esc(tip) + "'" : "") + ">" + esc(r.name) + "</span>";
        } },
      { label: "收盘", get: function (r) { return r.close === null || r.close === undefined ? "--" : '<span class="mkt-name-cell">' + r.close.toFixed(2) + "</span>"; } },
      { label: "今日涨跌", get: function (r) { return '<span class="' + pctCls(r.d0) + '">' + fmtPct(r.d0) + "</span>"; } },
      { label: "近5日", get: function (r) { return '<span class="' + pctCls(r.w5) + '">' + fmtPct(r.w5) + "</span>"; } },
      { label: "近20日", get: function (r) { return '<span class="' + pctCls(r.w20) + '">' + fmtPct(r.w20) + "</span>"; } },
      { label: "主力净额", get: function (r) { return '<span class="' + pctCls(r.baseMf) + '">' + fmtYi(r.baseMf) + "</span>"; } },
      { label: "连续", get: function (r) { return streakText(r.flowStreak); } },
      { label: "5日累计", get: function (r) { return '<span class="' + pctCls(r.mf5sum) + '">' + fmtYi(r.mf5sum, 1) + "</span>"; } },
      { label: "20日累计", get: function (r) { return '<span class="' + pctCls(r.mf20sum) + '">' + fmtYi(r.mf20sum, 1) + "</span>"; } },
      { label: "资金动向", get: function (r) { return mfBarsSvg(r.mfSeries); } },
    ];
    host.innerHTML =
      rankTable(rows, cols) +
      '<div class="mkt-chart mkt-chart-half">' + stocksChartHtml(data) + "</div>" +
      '<div class="mkt-foot-hint">口径与板块一致：基准日收盘数据；"连续"= 连续净流入(+)/净流出(−)天数；红绿柱为近20个交易日每日主力净流入；折线为各股归一化累计涨跌（起点=0），默认观察池：三一重工 / 柳工 / 安道麦A / 中原内配 / 美的集团。</div>';
  }

  /* ─────────── 大盘云图渲染（双层squarified treemap → SVG） ─────────── */
  // 估算文本宽度：CJK/全角字符按字号 1:1，ASCII 按 0.56 字号（与图表内 11px 无衬线字体实测接近）
  function cloudTextW(s, fs) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e7f ? fs : fs * 0.56;
    return w;
  }
  // 在 maxW 内尽量显示完整名称：放得下就显示整名，放不下则截断并加省略号
  // （截断至少保留 2 个字，否则「中…」这类单字标签只是噪声，完整名称交给悬浮提示）
  function cloudFitName(name, maxW, fs) {
    name = String(name === null || name === undefined ? "" : name);
    if (!name || maxW <= 0) return "";
    if (cloudTextW(name, fs) <= maxW) return name;
    for (var n = name.length - 1; n >= 2; n--) {
      var s = name.slice(0, n) + "…";
      if (cloudTextW(s, fs) <= maxW) return s;
    }
    return "";
  }
  // 个股方块文字：按方块尺寸选字号（11/10/9），高度够就「名称 + 涨跌幅」两行，否则只放名称
  function cloudStockLabel(sr, s2) {
    var availW = sr.w - 6, availH = sr.h - 4;
    if (availW < 14 || availH < 9) return "";
    var sizes = [11, 10, 9], fs = 0, name = "";
    for (var i = 0; i < sizes.length; i++) {
      var f = sizes[i];
      var fit = cloudFitName(s2.n, availW, f);
      if (!fit) continue;
      // 字号与方块尺寸匹配：大字号只给大块，小方块降字号，避免文字挤在一起
      if (f === 11 && (sr.w < 46 || sr.h < 14)) continue;
      if (f === 10 && (sr.w < 28 || sr.h < 11)) continue;
      fs = f; name = fit;
      break;
    }
    if (!name) return "";
    var x = (sr.x + 3).toFixed(1);
    var pct = fmtPct(s2.p, 1);
    var twoLine = availH >= fs * 2 + 3;
    var totalH = twoLine ? fs * 2.3 : fs;
    var top = sr.y + Math.max(0, (sr.h - totalH) / 2);
    var html = '<text x="' + x + '" y="' + (top + fs * 0.85).toFixed(1) + '" class="mkt-cloud-lb" style="font-size:' + fs +
      'px" fill="' + pctText(s2.p) + '">' + esc(name) + "</text>";
    if (twoLine && cloudTextW(pct, fs * 0.92) <= availW) {
      html += '<text x="' + x + '" y="' + (top + fs * 1.95).toFixed(1) + '" class="mkt-cloud-lb2" style="font-size:' +
        (fs * 0.92).toFixed(1) + 'px" fill="' + pctText(s2.p) + '">' + esc(pct) + "</text>";
    }
    return html;
  }
  function renderCloud(data) {
    var host = $("mktCloudWrap");
    if (!host) return;
    if (!cap().cloud) { host.innerHTML = capNote("板块成分与个股云图"); return; }
    var cloud = data.cloud;
    if (!cloud || !cloud.boards || !cloud.boards.length) {
      host.innerHTML = '<div class="mkt-fail">云图成分数据暂不可用（行情接口限流中，稍后刷新恢复）。</div>';
      return;
    }
    var W = 1180, H = 780, HEADER = 15;
    // squarify 需要预缩放到目标面积：v = 市值占比 × 可用面积
    var sumCap = 0;
    cloud.boards.forEach(function (b) { sumCap += b.totalCap; });
    var bItems = cloud.boards.slice()
      .sort(function (a, b) { return b.totalCap - a.totalCap; })
      .map(function (b) { return { v: sumCap > 0 ? b.totalCap / sumCap * W * H : 0, d: b }; });
    var bRects = [];
    treemapSquarify(bItems, 0, 0, W, H, bRects);
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto;display:block" class="mkt-cloud-svg">';
    bRects.forEach(function (br) {
      var b = br.d;
      var hdH = Math.min(HEADER, br.h);
      svg += '<rect x="' + br.x.toFixed(1) + '" y="' + br.y.toFixed(1) + '" width="' + br.w.toFixed(1) + '" height="' + hdH.toFixed(1) +
        '" fill="' + pctColor(b.pct) + '"><title>' + esc(b.name) + "  涨跌 " + esc(fmtPct(b.pct)) +
        "  成分流通市值 " + esc(fmtYi(b.totalCap, 0)) + "</title></rect>";
      // 板块名 + 涨跌幅：名字优先完整显示，剩余宽度够再补涨跌幅，避免文字溢出方块
      var hdAvailW = br.w - 8;
      var hdName = cloudFitName(b.name, hdAvailW, 11);
      if (hdName) {
        var hdLabel = hdName;
        var hdSuffix = " " + fmtPct(b.pct, 1);
        if (hdName === b.name && cloudTextW(hdSuffix, 11) <= hdAvailW - cloudTextW(hdName, 11)) hdLabel += hdSuffix;
        svg += '<text x="' + (br.x + 4).toFixed(1) + '" y="' + (br.y + 11.5).toFixed(1) + '" class="mkt-cloud-hd" fill="' + pctText(b.pct) + '">' +
          esc(hdLabel) + "</text>";
      }
      if (br.h > HEADER + 8 && br.w > 16) {
        var innerH = br.h - hdH;
        var innerArea = br.w * innerH;
        var sItems = [];
        b.stocks.forEach(function (s2) { sItems.push({ v: s2.cap / b.totalCap * innerArea, d: s2 }); });
        sItems.sort(function (a, b2) { return b2.v - a.v; });
        var sRects = [];
        treemapSquarify(sItems, br.x, br.y + hdH, br.w, innerH, sRects);
        sRects.forEach(function (sr) {
          var s2 = sr.d;
          var fill = pctColor(s2.p);
          var mkt = s2.c.charAt(0) === "6" ? "sh" : (s2.c.charAt(0) === "8" || s2.c.charAt(0) === "4" ? "bj" : "sz");
          // 每个方块都带完整股票名 + 代码 + 涨跌 + 流通市值的悬浮提示
          svg += '<rect x="' + (sr.x + 0.5).toFixed(1) + '" y="' + (sr.y + 0.5).toFixed(1) + '" width="' + Math.max(1, sr.w - 1).toFixed(1) +
            '" height="' + Math.max(1, sr.h - 1).toFixed(1) + '" fill="' + fill + '" data-code="' + esc(s2.c) + '" data-mkt="' + mkt + '"><title>' +
            esc(s2.n) + " " + esc(s2.c) + "  涨跌 " + esc(fmtPct(s2.p)) + "  流通市值 " + esc(fmtYi(s2.cap, 0)) + "</title></rect>" +
            cloudStockLabel(sr, s2);
        });
      }
    });
    svg += "</svg>";
    host.innerHTML = svg +
      '<div class="mkt-foot-hint">方块大小 = 个股流通市值；颜色 = 当日涨跌幅（红涨绿跌，灰=停牌/平盘）；悬浮查看明细，点击方块打开东财个股行情页。仅行业板块（概念板块个股跨板块重叠会重复计价）。实时快照：盘中为盘中涨跌，收盘后为当日收盘口径。</div>';
    var svgEl = host.querySelector("svg");
    if (svgEl) {
      svgEl.addEventListener("click", function (ev) {
        var rect = ev.target.closest("rect");
        if (!rect || !rect.getAttribute || !rect.getAttribute("data-code")) return;
        window.open("https://quote.eastmoney.com/" + rect.getAttribute("data-mkt") + rect.getAttribute("data-code") + ".html", "_blank");
      });
    }
  }

  /* ─────────── 桑基图（纯SVG，近20日→近5日→今日） ─────────── */
  function sankeySvg(data, down) {
    var colDefs = [
      { key: "w20", label: "近20日" },
      { key: "w5", label: "近5日" },
      { key: "d0", label: "今日", field: "basePct" },
    ];
    var TOPN = 8;
    var cols = colDefs.map(function (cd) {
      var f = cd.field || cd.key;
      var rows = windowTop(data, f, TOPN * 2, down)
        .filter(function (b) { return down ? b[f] < 0 : b[f] > 0; })
        .slice(0, TOPN);
      return { label: cd.label, rows: rows, field: f };
    });
    var any = cols.some(function (c) { return c.rows.length > 0; });
    if (!any) return '<div class="mkt-fail">窗口数据暂不可用（板块日K限流中，稍后刷新恢复）。</div>';

    var W = 680, rowH = 30, topPad = 26, botPad = 8;
    var H = topPad + TOPN * rowH + botPad;
    var colX = [24, 260, 496];
    var nodeW = 160;
    cols.forEach(function (col, ci) {
      col.nodes = col.rows.map(function (b, i) {
        return { b: b, x: colX[ci], y: topPad + i * rowH, h: 18 };
      });
    });
    // 连接：相邻列同名题材
    var links = [];
    for (var ci = 0; ci < cols.length - 1; ci++) {
      var A = cols[ci], B = cols[ci + 1];
      A.nodes.forEach(function (na) {
        B.nodes.forEach(function (nb) {
          if (na.b.code !== nb.b.code) return;
          var va = na.b[A.field], vb = nb.b[B.field];
          if (va === null || va === undefined || vb === null || vb === undefined) return;
          links.push({ na: na, nb: nb, v: Math.min(Math.abs(va), Math.abs(vb)), ci: ci, up: va > 0, name: na.b.name });
        });
      });
    }
    var maxV = 1;
    links.forEach(function (l) { maxV = Math.max(maxV, l.v); });
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '">';
    cols.forEach(function (col, ci2) {
      svg += '<text class="snk-col" x="' + (colX[ci2] + nodeW / 2) + '" y="16" text-anchor="middle">' + esc(col.label) + "</text>";
    });
    links.forEach(function (l) {
      var y1 = l.na.y + l.na.h / 2, y2 = l.nb.y + l.nb.h / 2;
      var x1 = l.na.x + nodeW, x2 = l.nb.x;
      var w = 2 + 8 * l.v / maxV;
      var mx1 = x1 + (x2 - x1) * 0.45, mx2 = x1 + (x2 - x1) * 0.55;
      svg += '<path class="' + (l.up ? "snk-link-up" : "snk-link-down") + '" d="M' + x1 + " " + y1 +
        " C " + mx1 + " " + y1 + ", " + mx2 + " " + y2 + ", " + x2 + " " + y2 +
        '" stroke-width="' + w.toFixed(1) + '"><title>' + esc(l.name) + "：" +
        esc(fmtPct(l.na.b[cols[l.ci].field])) + " → " + esc(fmtPct(l.nb.b[cols[l.ci + 1].field])) + "</title></path>";
    });
    cols.forEach(function (col) {
      col.nodes.forEach(function (nd) {
        var v = nd.b[col.field];
        var color = v > 0 ? "#e05a5a" : (v < 0 ? "#1fa363" : "#8a96b0");
        svg += '<rect x="' + nd.x + '" y="' + nd.y + '" width="4" height="' + nd.h + '" rx="2" fill="' + color + '"/>' +
          '<text class="snk-node" x="' + (nd.x + 10) + '" y="' + (nd.y + 8) + '">' +
          "<tspan>" + esc(nd.b.name) + "</tspan>" +
          '<tspan class="snk-pct" fill="' + color + '" dx="4">' + esc(fmtPct(v, 1)) + "</tspan></text>";
      });
    });
    svg += "</svg>";
    return svg;
  }

  /* ─────────── 激活与刷新 ─────────── */
  function onActivate() {
    ensureSkeleton();
    var ov = document.getElementById("loadOverlay");
    if (ov) ov.hidden = true;   // 基金页的加载卡不悬浮在市场页上（基金加载继续后台进行）
    loadMarket(false);
  }

  // 收盘后自动切换当日数据：15:05 起每分钟检查一次，当日仅尝试一次（失败10分钟冷却后可再试）
  function autoTransition() {
    if (document.visibilityState && document.visibilityState !== "visible") return;   // 后台标签页不请求
    if (!afterClose()) return;                                                        // 未收盘：维持上一交易日口径
    var today = bjNow().date;
    if (currentBaseDate === today) { autoFetchDate = today; return; }                 // 已是当日口径
    if (autoFetchDate === today) {
      if (!autoFailAt || Date.now() - autoFailAt < 10 * 60 * 1000) return;            // 今日已尝试：失败后10分钟冷却
    }
    if (loadingGen !== -1) return;                                                    // 加载进行中，下个周期再判
    autoFetchDate = today;
    autoFailAt = 0;
    loadMarket(false);
  }

  /* ══════════ 路由组件注册（assets/router.js 懒加载本文件后调用 mount/activate） ══════════ */
  window.AppPages = window.AppPages || {};
  window.AppPages.market = {
    mount: function (root) {
      root.innerHTML =
        '<section class="mkt-head">' +
          '<div class="mkt-title-row">' +
            '<b class="mkt-title">市场全景</b>' +
            '<div class="mkt-prov" id="mktProv" title="切换数据源（不同源的能力边界见各模块提示）">' +
              '<button data-p="em" class="on">东方财富</button>' +
              '<button data-p="sina">新浪财经</button>' +
              '<button data-p="tx">腾讯行情</button>' +
            '</div>' +
            '<span class="mode-chip" id="mktChip"><i class="chip-dot"></i><span id="mktChipText">准备加载…</span></span>' +
            '<span class="mkt-rule" id="mktRule"></span>' +
            '<button class="btn btn-ghost mkt-refresh" id="mktRefresh" title="重新拉取市场数据">⟳ 刷新</button>' +
          '</div>' +
          '<p class="mkt-note">开盘期间自动统计<b>上一交易日</b>收盘数据，收盘后统计<b>当日</b>；板块资金流 / 题材振幅 / 桑基热点均来自公开接口，按基准日本地缓存，当日重访秒开。</p>' +
        '</section>' +
        '<div class="mkt-body" id="mktBody"><!-- 市场模块渲染 --></div>';
      $("mktRefresh").addEventListener("click", function () { loadMarket(true); });
      // 数据源切换：持久化 + 各源独立缓存/快照，切换即重取（先打回骨架屏，给出明确加载态）
      var provBox = $("mktProv");
      if (provBox) {
        provBox.addEventListener("click", function (ev) {
          var b = ev.target.closest("button[data-p]");
          if (!b || b.classList.contains("on")) return;
          var p = b.getAttribute("data-p");
          if (!PROVIDERS[p]) return;
          activeProvider = p;
          try { localStorage.setItem("hs300.mkt.provider", activeProvider); } catch (e) {}
          provBox.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
          // 切换一律走新代际：旧源的加载结果作废，命中该源缓存/快照则秒切，否则显示骨架屏并重取
          loadMarket(false, true);
        });
        provBox.querySelectorAll("button").forEach(function (x) {
          x.classList.toggle("on", x.getAttribute("data-p") === activeProvider);
        });
      }
      // 收盘后自动切换当日数据：每分钟检查（可见标签页才请求），当日仅尝试一次
      setInterval(autoTransition, 60000);
    },
    activate: function () { onActivate(); },
    deactivate: function () {}
  };

  // 调试钩子：控制台可注入 mock 数据验证渲染管线（window.__mktDebug.renderAll(data)）
  window.__mktDebug = { renderAll: renderAll, ensureSkeleton: ensureSkeleton, approxBase: approxBase, afterClose: afterClose, loadMarket: loadMarket, fetchEvents: fetchEvents, fetchJsonp: fetchJsonp, fetchBoardConstituents: fetchBoardConstituents, quantHeat: quantHeat, quantStage: quantStage, quantSectorStrength: quantSectorStrength };
})();
