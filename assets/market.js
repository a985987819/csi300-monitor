/* ═══════════ 市场全景（市场板块 · 双主题） ═══════════
   数据源：东方财富公开行情接口（push2/push2his，JSONP 直连，无需登录/中继，GitHub Pages 兼容）
   基准日规则：收盘后（15:05 起）统计当日；盘中/午休/盘前/节假日统计最近一个已收盘交易日
   字段实测（与日K交叉验证）：f3 今日涨跌幅 · f7 今日振幅 · f109 近5日 · f160 近10日 · f24 近60日 ·
   f25 年初至今 · f62 主力净流入 · f184 主力净占比 · f164 近5日主力净流入
   基准日窗口校正：含今日的窗口 ÷ (1+今日涨跌幅) = 截至基准日的窗口（代数精确，无漂移）
   近20日无现成字段 → 按各窗口榜单极值并集取候选，逐板块拉日K精确计算（按基准日缓存） */
(function () {
  "use strict";

  var LS_KEY = "hs300.mkt.v3";           // 按基准日缓存聚合结果

  var CLIST_HOSTS = ["push2.eastmoney.com", "33.push2.eastmoney.com", "99.push2.eastmoney.com"];
  var KLINE_HOSTS = ["push2his.eastmoney.com", "33.push2his.eastmoney.com"];
  var EM_UT = "ut=7eea3edcaed734bea9cbfc24409ed989";

  var INDEXES = [
    { key: "sh", secid: "1.000001", tx: "sh000001", name: "上证指数", tag: "沪市" },
    { key: "sz", secid: "0.399001", tx: "sz399001", name: "深证成指", tag: "深市" },
    { key: "cyb", secid: "0.399006", tx: "sz399006", name: "创业板指", tag: "创业板" },
    { key: "kc50", secid: "1.000688", tx: "sh000688", name: "科创50", tag: "科创50" },
  ];

  var CLIST_FIELDS = "f12,f14,f3,f7,f6,f62,f66,f72,f184,f109,f160,f24,f25,f164,f165,f128,f140,f136,f124";
  var KLINE_FIELDS2 = "f51,f53,f54,f55,f58,f59";   // 日期,收盘,最高,最低,振幅,涨跌幅（已实测）
  var FFLOW_FIELDS2 = "f51,f52,f57";               // 日期,主力净流入额,主力净占比

  var gen = 0;            // 加载代际（强制刷新时作废旧加载）
  var loadingGen = -1;    // 正在进行的加载代际

  /* ─────────── 基础工具 ─────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad2(x) { return (x < 10 ? "0" : "") + x; }
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
  function jsonpOnce(host, path, timeout) {
    return new Promise(function (resolve, reject) {
      var cbName = "__mkt" + (++jsonpSeq) + "_" + (Date.now() % 100000);
      var url = "https://" + host + path + (path.indexOf("?") >= 0 ? "&" : "?") + "cb=" + cbName;
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
  // 带主机轮换 + 退避重试的 JSONP；path 为接口路径与查询串（不含 cb）
  function fetchJsonp(path, hosts, tries) {
    var attempt = 0;
    function run() {
      attempt++;
      var host = hosts[(attempt - 1) % hosts.length];
      return pace().then(function () {
        return jsonpOnce(host, path, 15000);
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

  // 日K → [{date, close, high, low, amp, pct}]
  function fetchKline(secid, beg) {
    var path = "/api/qt/stock/kline/get?secid=" + secid +
      "&fields1=f1,f2,f3&fields2=" + KLINE_FIELDS2 + "&klt=101&fqt=1&beg=" + beg + "&end=20500101";
    return fetchJsonp(path, KLINE_HOSTS).then(function (d) {
      var klines = d && d.data && d.data.klines || [];
      var bars = [];
      for (var i = 0; i < klines.length; i++) {
        var p = klines[i].split(",");
        bars.push({ date: p[0], close: parseFloat(p[1]), high: parseFloat(p[2]), low: parseFloat(p[3]),
                    amp: parseFloat(p[4]), pct: parseFloat(p[5]) });
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
          bars.push({ date: days[i][0], close: parseFloat(days[i][2]), high: parseFloat(days[i][3]), low: parseFloat(days[i][4]) });
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
          return { ix: ix, pct: up / total * 100, up: up, down: down };
        }).catch(function () { return { ix: ix, pct: null }; });
    }));
  }

  /* ─────────── 基准日与窗口计算 ─────────── */
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
  function ensureSkeleton() {
    if ($("mktIdxWrap")) return;
    $("mktBody").innerHTML =
      mktBlock("大盘指数", "今日 · 成交额 · 近5日 · 近20日 · 上涨家数占比", '<div id="mktIdxWrap"><div class="mkt-skel mkt-skel-rows">' + skelBars(4) + "</div></div>") +
      mktBlock("今日盘面", "情绪温度 · 主力资金流向与持续性 · 振幅质量（基准日收盘口径）", '<div id="mktTodayWrap"><div class="mkt-skel mkt-skel-rows">' + skelBars(3) + "</div></div>") +
      mktBlock("年度纵览", "今年来板块与题材涨跌", '<div class="mkt-cards" id="mktYtdWrap">' + skelCard(2) + "</div>") +
      mktBlock("板块风险性价比", "与基金风险指标同口径：波动 / 回撤 / 收益波动比", '<div class="mkt-cards" id="mktRiskWrap">' + skelCard(1) + "</div>") +
      mktBlock("热点题材动态", "近20日 → 近5日 → 今日 的题材轮动（桑基图）",
        '<div class="mkt-sanki-wrap" id="mktSankeyWrap">' + skelCard(2) + "</div>" +
        '<div class="mkt-cards" id="mktWindowWrap" style="margin-top:14px">' + skelCard(4) + "</div>");
  }
  function markFailBody(msg) {
    $("mktBody").innerHTML = '<section class="mkt-block"><div class="mkt-fail">' + msg + "</div></section>" +
      '<section class="mkt-block"><div class="mkt-foot-hint">提示：数据由浏览器直连东方财富公开行情接口（push2 集群）。「接口连接被重置」为东财对该出口 IP 的临时限流，通常十几分钟至一小时自行恢复，期间基金页实时数据不受影响；恢复后点「⟳ 刷新」即可。</div></section>';
  }

  /* ─────────── 主流程 ─────────── */
  function loadCache() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { return null; }
  }
  function chipText(t, loading) {
    var chip = $("mktChip");
    if (chip) chip.classList.toggle("loading", !!loading);
    $("mktChipText").textContent = t;
  }
  function setRule(t) { var el = $("mktRule"); if (el) el.textContent = t; }

  function loadMarket(force) {
    if (!force && loadingGen === gen) return;   // 已在加载中
    var myGen = ++gen;
    loadingGen = myGen;
    var stale = function () { return myGen !== gen; };
    ensureSkeleton();
    setRule("");

    // 缓存命中判断（近似基准日，无网络开销）
    if (!force) {
      var cached = loadCache();
      if (cached && cached.baseDate === approxBase() && cached.boards) {
        renderAll(cached);
        chipText("数据截至 " + cached.baseDate + " 收盘 · 本地缓存", false);
        setRule("基准日 " + cached.baseDate + " · 采集于 " + fmtClock(cached.savedAt) + " · 当日重访秒开");
        loadingGen = -1;
        return;
      }
    }

    var state = { boards: {}, phase: afterClose() ? "closed" : "open", klineFail: 0, flowFail: 0 };

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
          if (d0 === null && bi > 0 && closes[bi - 1]) d0 = (closes[bi] / closes[bi - 1] - 1) * 100;   // 腾讯降级源无pct字段
          return {
            ix: r.ix,
            close: closes[bi],
            d0: d0,
            w5: winPct(closes, bi, 5),
            w20: winPct(closes, bi, 20),
            spark: closes.slice(Math.max(0, bi - 19), bi + 1),
          };
        });
      } else {
        // 指数K线不可用（K线接口限流）→ 基准日退化为近似值（节假日口径可能偏差一天），指数表降级
        state.baseDate = approxBase();
        state.indexes = [];
        state.idxKlineFail = true;
      }

      // 渲染容器就绪后填入指数表
      if (!$("mktIdxWrap")) ensureSkeleton();
      renderIndexes(state);
      chipText("基准日 " + state.baseDate + " · 获取板块K线…", true);
      // 指数成交额（腾讯快照）+ 市场广度（f104/105/106）+ 情绪温度（涨停/跌停/炸板池）并行后台补取
      fetchTxAmounts().then(function (a) { if (!stale() && a) { state.txAmounts = a; renderIndexes(state); } }).catch(function () {});
      fetchIndexBreadth().then(function (bd) { if (!stale() && bd) { state.breadth = bd; renderIndexes(state); } }).catch(function () {});
      fetchEmotion(state.baseDate).then(function (emo) { if (!stale() && emo) { state.emotion = emo; renderToday(state); } }).catch(function () {});

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
      finalize(state);
    }).catch(function (e) {
      if (stale() || (e && e.message === "aborted")) return;
      loadingGen = -1;
      chipText("市场数据获取失败：" + (e && e.message || "网络错误") + "（可点「⟳ 刷新」重试）", false);
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
      v: 3, baseDate: state.baseDate, phase: state.phase,
      savedAt: Date.now(), boardTotal: state.boardTotal,
      indexes: state.indexes, boards: state.boards,
      txAmounts: state.txAmounts || null, breadth: state.breadth || null,
      emotion: state.emotion || null, txKline: !!state.txKline,
      klineOkN: list.filter(function (b) { return b.klineOk; }).length,
      flowExactN: list.filter(function (b) { return b.flowExact; }).length,
      failN: state.klineFail + state.flowFail,
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
    renderAll(data);
    loadingGen = -1;
    var live = state.phase === "open";
    var flowNote = (!data.flowExactN && live) ? " · 资金流为盘中实时（暂无上一交易日收盘缓存）" : "";
    var listNote = state.listFail ? " · 清单缺" + state.listFail : "";
    var txNote = data.txKline ? " · 指数为腾讯降级源" : "";
    chipText("数据截至 " + state.baseDate + " 收盘 · " + data.klineOkN + "/" + state.boardTotal + " 板块" +
      (data.failN ? " · 失败" + data.failN : "") + flowNote + listNote + txNote, false);
    setRule("基准日 " + state.baseDate + (live ? "（盘中，统计上一交易日）" : "（收盘后，统计当日）") +
      " · 采集于 " + fmtClock(data.savedAt) + " · 东方财富公开接口（指数快照/日K备用源：腾讯行情）");
  }

  /* ─────────── 渲染 ─────────── */
  function renderAll(data) {
    if (!$("mktIdxWrap")) ensureSkeleton();
    renderIndexes(data);
    renderToday(data);
    renderYtd(data);
    renderRisk(data);
    renderWindows(data);
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

  function renderIndexes(data) {
    var host = $("mktIdxWrap");
    if (!host) return;
    if (!data.indexes || !data.indexes.length) {
      host.innerHTML = '<div class="mkt-fail">指数数据暂不可用（K线接口限流中，稍后刷新恢复）。</div>';
      return;
    }
    var html = '<table class="mkt-table"><thead><tr>' +
      "<th>指数</th><th>收盘</th><th>今日</th><th>成交额</th><th>近5日</th><th>近20日</th><th>上涨家数占比</th><th style='text-align:center'>近20日走势</th></tr></thead><tbody>";
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
        "<td style='text-align:center'>" + sparkSvg(r.spark, r.w20) + "</td></tr>";
    });
    html += "</tbody></table>" +
      '<div class="mkt-foot-hint">上涨家数占比为该市场全部个股中上涨占比（广度）：≥50% 偏普涨，明显低于 50% 的指数上涨多为权重拉动；成交额来自腾讯快照。</div>';
    host.innerHTML = html;
  }

  // 通用榜单表：cols = [{label, left, get(r), cls(r)}]
  function rankTable(rows, cols) {
    var html = '<table class="mkt-table"><thead><tr><th style="width:26px">#</th>';
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
  // 情绪温度条（涨停/跌停/炸板池，基准日口径）
  function emotionStrip(emo) {
    if (!emo || (emo.zt === null || emo.zt === undefined)) return "";
    var items = [
      { k: "涨停", v: emo.zt === null ? "--" : emo.zt + " 家", cls: emo.zt > 0 ? "mkt-num-up" : "" },
      { k: "跌停", v: emo.dt === null || emo.dt === undefined ? "--" : emo.dt + " 家", cls: emo.dt > 0 ? "mkt-num-down" : "" },
      { k: "最高连板", v: emo.maxLb ? emo.maxLb + " 天" : "--", cls: "" },
      { k: "连板家数", v: emo.lbN ? emo.lbN + " 家" : "--", cls: "" },
      { k: "炸板率", v: emo.zbRate === null || emo.zbRate === undefined ? "--" : emo.zbRate.toFixed(0) + "%", cls: emo.zbRate >= 40 ? "mkt-num-down" : "mkt-dim-num",
        tip: "炸板率=炸板/(涨停+炸板)，越高说明封板越弱、分歧越大" },
    ];
    var html = '<div class="mkt-emo">';
    items.forEach(function (it) {
      html += '<span class="mkt-emo-item"' + (it.tip ? " title='" + esc(it.tip) + "'" : "") + ">" +
        '<b>' + it.k + '</b><span class="' + it.cls + '">' + it.v + "</span></span>";
    });
    return html + '<span class="mkt-emo-tip">情绪温度（基准日收盘口径）</span></div>';
  }

  function renderToday(data) {
    var host = $("mktTodayWrap");
    if (!host) return;
    var list = [];
    Object.keys(data.boards).forEach(function (c) { list.push(data.boards[c]); });
    var withFlow = list.filter(function (b) { return b.baseMf !== null && b.baseMf !== undefined; });
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
    var inflow = withFlow.slice(0, 10);
    var tail = withFlow.slice(-10).reverse();
    var outflow = tail.filter(function (b) { return (b.baseMf || 0) < 0; });
    var amp = list.filter(function (b) { return b.baseAmp !== null && b.baseAmp !== undefined; })
      .sort(function (a, b) { return b.baseAmp - a.baseAmp; }).slice(0, 10);

    var flowCols = [
      { label: "板块 / 题材", left: true, get: function (r) { return nameCell(r) + divergeTag(r); } },
      { label: "主力净流入", get: function (r) { return '<span class="' + pctCls(r.baseMf) + '">' + fmtYi(r.baseMf) + "</span>"; } },
      { label: "5日累计", get: function (r) { return '<span class="' + pctCls(r.mf5sum) + '">' + fmtYi(r.mf5sum, 1) + "</span>"; } },
      { label: "连续", get: function (r) { return streakText(r.flowStreak); } },
      { label: "涨跌幅", get: function (r) { return '<span class="' + pctCls(r.basePct) + '">' + fmtPct(r.basePct) + "</span>"; } },
    ];
    var ampCols = [
      { label: "板块 / 题材", left: true, get: nameCell },
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
      emotionStrip(data.emotion) +
      '<div class="mkt-cards">' +
      '<div class="mkt-card"><h4>主力净流入 TOP10 <span class="mkt-dim">亿元 · 5日累计 · 连续天数</span></h4>' +
      (inflow.length ? rankTable(inflow, flowCols) : '<div class="mkt-fail">暂无资金流数据</div>') + "</div>" +
      '<div class="mkt-card"><h4>主力净流出 TOP10 <span class="mkt-dim">亿元</span></h4>' +
      (outflow.length ? rankTable(outflow, flowCols) : '<div class="mkt-fail">暂无资金流数据</div>') + "</div>" +
      '<div class="mkt-card"><h4>振幅最大 TOP10 <span class="mkt-dim">板块与题材 · 含收盘位置</span></h4>' +
      (amp.length ? rankTable(amp, ampCols) : '<div class="mkt-fail">暂无振幅数据</div>') + "</div>" +
      "</div>" + flowNote + pctNote;
  }

  function renderYtd(data) {
    var host = $("mktYtdWrap");
    if (!host) return;
    var inSession = data.phase === "open";
    var list = [];
    Object.keys(data.boards).forEach(function (c) {
      var b = data.boards[c];
      if (b.ytd === undefined) b.ytd = ytdBase(b, inSession);
      if (b.ytd !== null) list.push(b);
    });
    list.sort(function (a, b) { return b.ytd - a.ytd; });
    var up = list.slice(0, 10), down = list.slice(-10).reverse();
    var cols = [
      { label: "板块 / 题材", left: true, get: nameCell },
      { label: "今年来", get: function (r) { return '<span class="' + pctCls(r.ytd) + '">' + fmtPct(r.ytd) + "</span>"; } },
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
      { label: "板块 / 题材", left: true, get: function (r) { return nameCell(r.b); } },
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
    var tblHost = $("mktWindowWrap");
    if (!sankeyHost || !tblHost) return;
    sankeyHost.innerHTML =
      '<div class="mkt-sanki"><h4>涨幅题材轮动（桑基）</h4>' + sankeySvg(data, false) + "</div>" +
      '<div class="mkt-sanki"><h4>跌幅题材轮动（桑基）</h4>' + sankeySvg(data, true) + "</div>";

    function mini(rows, key) {
      var cols = [
        { label: "题材 / 板块", left: true, get: nameCell },
        { label: "累计涨跌", get: function (r) { return '<span class="' + pctCls(r[key]) + '">' + fmtPct(r[key]) + "</span>"; } },
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
    loadMarket(false);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var pill = document.querySelector('.nav-pill[data-tab="market"]');
    if (!pill) return;
    pill.addEventListener("click", function () { onActivate(); });
    $("mktRefresh").addEventListener("click", function () { loadMarket(true); });
    if (pill.classList.contains("active")) onActivate();
  });

  // 调试钩子：控制台可注入 mock 数据验证渲染管线（window.__mktDebug.renderAll(data)）
  window.__mktDebug = { renderAll: renderAll, ensureSkeleton: ensureSkeleton, approxBase: approxBase, afterClose: afterClose, loadMarket: loadMarket };
})();
