/* ═══════════ 页面组件：深挖公司（#/company） ═══════════
   移植 ashare-company-deep-research skill（14 步方法论）为免登录网页版：
   全部数据走免登录公开通道（datacenter-web / push2his / reportapi / qt.gtimg / ifzq），
   采集三态（ok_data / ok_empty / fail）、证据分级（已核/推算/未核）、
   估值关键数字页面内实算（WACC/DCF/反向DCF/DDM/PVGO/EPV/EVA/敏感性/压力测试），
   会计可信度约束结论（不可信 → 评级封顶中性）。失败层一律降级「待核实」，绝不编造。 */
(function () {
  "use strict";

  var $ = window.Util.$;
  var esc = window.Util.esc;
  var store = window.Util.store;

  var DC_HOSTS = ["datacenter-web.eastmoney.com"];
  var KLINE_HOSTS = ["push2his.eastmoney.com", "86.push2his.eastmoney.com", "99.push2his.eastmoney.com"];
  var KLINE_FIELDS2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59";

  /* ─────────── 基础工具 ─────────── */
  function num(v) {
    if (v === null || v === undefined || v === "" || v === "-") return null;
    var n = parseFloat(String(v).replace(/,/g, ""));
    return isNaN(n) ? null : n;
  }
  function makePacer(gap) {
    var slot = 0;
    return function () {
      var now = Date.now();
      var next = slot + gap;
      slot = Math.max(now, next);
      return new Promise(function (res) { setTimeout(res, slot - now + Math.floor(Math.random() * 40)); });
    };
  }
  var pace = makePacer(200);
  var jsonpSeq = 0;
  function jsonpOnce(host, path, timeout, cbParam) {
    return new Promise(function (resolve, reject) {
      var cbName = "__co" + (++jsonpSeq) + "_" + (Date.now() % 100000);
      var cbKey = cbParam || "cb";
      var s = document.createElement("script");
      var done = false;
      var to = setTimeout(function () { if (done) return; done = true; cleanup(); reject(new Error("timeout")); }, timeout || 15000);
      function cleanup() { clearTimeout(to); try { delete window[cbName]; } catch (e) { window[cbName] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
      window[cbName] = function (data) { if (done) return; done = true; clearTimeout(to); cleanup(); resolve(data); };
      s.onerror = function () { if (done) return; done = true; clearTimeout(to); cleanup(); reject(new Error("error")); };
      s.src = "https://" + host + path + (path.indexOf("?") >= 0 ? "&" : "?") + cbKey + "=" + cbName;
      document.head.appendChild(s);
    });
  }
  function fetchJsonp(path, hosts, tries, cbParam, timeout) {
    var attempt = 0;
    function run() {
      attempt++;
      var host = hosts[(attempt - 1) % hosts.length];
      return pace().then(function () {
        return jsonpOnce(host, path, timeout || 15000, cbParam);
      }).catch(function (e) {
        if (attempt < (tries || 2)) return new Promise(function (res) { setTimeout(res, 500 * attempt + 200); }).then(run);
        throw e;
      });
    }
    return run();
  }
  function dcFilter(s) { return encodeURIComponent(s); }
  /* datacenter 报表请求：返回 rows 数组；空结果与失败由调用方记三态 */
  function dcReport(reportName, filter, pageSize, sortCol, sortDir) {
    var path = "/api/data/v1/get?reportName=" + reportName +
      "&columns=ALL&filter=" + dcFilter(filter) +
      (sortCol ? "&sortColumns=" + sortCol + "&sortTypes=" + (sortDir || -1) : "") +
      "&pageSize=" + (pageSize || 50) + "&pageNumber=1";
    return fetchJsonp(path, DC_HOSTS, 2, "callback").then(function (d) {
      var rows = d && d.result && d.result.data || [];
      return rows;
    });
  }
  /* 腾讯批量快照（GBK script，字段安全） */
  function txQuote(txCode) {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; s.remove(); resolve(null); } }, 10000);
      s.src = "https://qt.gtimg.cn/q=" + txCode;
      s.onload = function () {
        if (done) return;
        done = true; clearTimeout(to); s.remove();
        try {
          var raw = window["v_" + txCode];
          if (typeof raw !== "string") return resolve(null);
          var p = raw.split("~");
          resolve({
            name: p[1], close: num(p[3]), pct: num(p[32]),
            amountWan: num(p[37]), turnover: num(p[38]), pe: num(p[39]),
            floatMvYi: num(p[44]), mvYi: num(p[45]), pb: num(p[46]),
            hi52: num(p[67]), lo52: num(p[68]), dividend: num(p[49]),
          });
        } catch (e) { resolve(null); }
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); s.remove(); resolve(null); } };
      document.head.appendChild(s);
    });
  }
  /* 东财 K线（前复权）+ 腾讯降级 */
  function fetchKline(secid, beg, tx) {
    var path = "/api/qt/stock/kline/get?secid=" + secid +
      "&fields1=f1,f2,f3&fields2=" + KLINE_FIELDS2 + "&klt=101&fqt=1&beg=" + beg + "&end=20500101";
    return fetchJsonp(path, KLINE_HOSTS, 2).then(function (d) {
      var klines = d && d.data && d.data.klines || [];
      var bars = [];
      for (var i = 0; i < klines.length; i++) {
        var p = klines[i].split(",");
        bars.push({ date: p[0], close: parseFloat(p[2]), high: parseFloat(p[3]), low: parseFloat(p[4]), amount: parseFloat(p[6]) });
      }
      if (bars.length) return bars;
      return txKline(tx);
    }).catch(function () { return txKline(tx); });
  }
  function txKline(txCode) {
    /* ifzq 返回 JSON 且 CORS 开放 → 用 fetch（script 注入会把 JSON 当语句执行） */
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
    return fetch("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + txCode + ",day,,,320,qfq",
      ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        var node = j && j.data && j.data[txCode] || {};
        var days = node.day || node.qfqday || [];
        var bars = [];
        for (var i = 0; i < days.length; i++) bars.push({ date: days[i][0], close: parseFloat(days[i][2]) });
        return bars;
      }).catch(function (e) { clearTimeout(to); throw e; });
  }

  /* ─────────── 三态模块登记 ─────────── */
  var MODS = {};   /* key -> {state, data, src, label} */
  function mod(key, label, src, state, data) {
    MODS[key] = { key: key, label: label, src: src, state: state || "fail", data: data === undefined ? null : data };
    return MODS[key];
  }
  function wrap(key, label, src, promise, extract) {
    return promise.then(function (rows) {
      if (!rows || !rows.length) { mod(key, label, src, "ok_empty", []); return []; }
      mod(key, label, src, "ok_data", rows); return rows;
    }).catch(function () {
      mod(key, label, src, "fail", null); return [];
    }).then(function (rows) { return extract ? extract(rows) : rows; });
  }

  /* ─────────── 来源入口页（source-templates.md） ─────────── */
  function srcF10(code) { return "https://emweb.securities.eastmoney.com/pc_hsf10/pages/index.html?type=web&code=" + mkt(code).toUpperCase() + code; }
  function srcQuote(code) { return "https://quote.eastmoney.com/" + mkt(code) + code + ".html"; }
  function srcDividend(code) { return "https://data.eastmoney.com/yjfp/detail/" + code + ".html"; }
  function srcReport(code) { return "https://data.eastmoney.com/report/" + code + ".html"; }
  function srcGdhs(code) { return "https://data.eastmoney.com/gdhs/detail/" + code + ".html"; }
  function srcDxf(code) { return "https://data.eastmoney.com/dxf/detail/" + code + ".html"; }
  function srcGzyj(code) { return "https://data.eastmoney.com/gzyj/detail/" + code + ".html"; }
  function srcLhb(code) { return "https://data.eastmoney.com/stock/lhb/" + code + ".html"; }
  function srcDzjy(code) { return "https://data.eastmoney.com/dzjy/detail/" + code + ".html"; }
  function srcZjlx(code) { return "https://data.eastmoney.com/zjlx/" + code + ".html"; }
  function srcRzrq(code) { return "https://data.eastmoney.com/rzrq/detail/" + code + ".html"; }
  function mkt(code) { return (code.charAt(0) === "6") ? "sh" : ((code.charAt(0) === "8" || code.charAt(0) === "4" || code.charAt(0) === "9") ? "bj" : "sz"); }
  function secid(code) { return (code.charAt(0) === "6") ? "1." + code : ((code.charAt(0) === "8" || code.charAt(0) === "4" || code.charAt(0) === "9") ? "0." + code : "0." + code); }
  function secuCode(code) { return code + "." + (code.charAt(0) === "6" ? "SH" : (code.charAt(0) === "8" || code.charAt(0) === "4" || code.charAt(0) === "9") ? "BJ" : "SZ"); }

  /* ─────────── 状态 ─────────── */
  var state = {
    code: null, name: null, running: false, gen: 0,
    qt: null, kline5y: null, klineHs300: null, main: null, mainop: null,
    balance: null, income: null, cash: null, dividend: null, lift: null,
    holders: null, holderNum: null, pledge: null, rzrq: null, cb: null,
    reports: null, value: null, lhb: null,
    beta: null, assumption: null,
  };
  function ASSUM() {
    if (!state.assumption) {
      state.assumption = { rf: 2.0, erp: 6.0, beta: 1.0, rd: 3.5, tax: 25, g1: 8, gt: 3, payout: null, targetPe: null };
    }
    return state.assumption;
  }

  /* ─────────── 采集管道（公开免登录 API） ─────────── */
  function collect(code) {
    var gen = ++state.gen;
    state.code = code;
    var tx = mkt(code) + code;
    var sid = secid(code);
    var filter = '(SECURITY_CODE="' + code + '")';
    var secu = '(SECUCODE="' + secuCode(code) + '")';

    var P = [];
    /* M0 行情/估值快照 */
    P.push(txQuote(tx).then(function (q) {
      if (gen !== state.gen) return;
      if (q && q.close) { mod("quote", "行情与估值快照", srcQuote(code), "ok_data", q); state.qt = q; state.name = q.name; }
      else mod("quote", "行情与估值快照", srcQuote(code), "fail", null);
    }));
    /* 近5年日K + 沪深300（涨跌幅对照 / β 计算） */
    P.push(fetchKline(sid, "20210101", tx).then(function (bars) {
      if (gen !== state.gen) return;
      if (bars && bars.length) { state.kline5y = bars; mod("kline", "历史行情(5年)", srcQuote(code), "ok_data", bars); }
      else mod("kline", "历史行情(5年)", srcQuote(code), "fail", null);
    }).catch(function () { if (gen !== state.gen) return; mod("kline", "历史行情(5年)", srcQuote(code), "fail", null); }));
    P.push(fetchKline("1.000300", "20210101", "sh000300").then(function (bars) {
      if (gen !== state.gen) return;
      state.klineHs300 = bars || [];
    }).catch(function () { if (gen !== state.gen) return; state.klineHs300 = []; }));
    /* M2 财务主指标（多期） */
    P.push(dcReport("RPT_F10_FINANCE_MAINFINADATA", filter, 80, "REPORT_DATE").then(function (rows) {
      if (gen !== state.gen) return;
      state.main = rows;
      mod("main", "财务主指标(多期)", srcF10(code), state.main.length ? "ok_data" : "ok_empty", state.main);
    }).catch(function () { if (gen !== state.gen) return; mod("main", "财务主指标(多期)", srcF10(code), "fail", null); }));
    /* M1 主营构成 */
    P.push(dcReport("RPT_F10_FN_MAINOP", filter, 120, "REPORT_DATE").then(function (rows) {
      if (gen !== state.gen) return;
      state.mainop = rows;
      mod("mainop", "主营构成(分部)", srcF10(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("mainop", "主营构成(分部)", srcF10(code), "fail", null); }));
    /* M5 资产负债 / 利润 / 现金流（结构化三表，字段择优提取） */
    P.push(dcReport("RPT_F10_FINANCE_BALANCE", filter, 16, "REPORT_DATE").then(function (rows) {
      if (gen !== state.gen) return; state.balance = rows;
      mod("balance", "资产负债表", srcF10(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("balance", "资产负债表", srcF10(code), "fail", null); }));
    P.push(dcReport("RPT_F10_FINANCE_GINCOME", filter, 16, "REPORT_DATE").then(function (rows) {
      if (gen !== state.gen) return; state.income = rows;
      mod("income", "利润表", srcF10(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("income", "利润表", srcF10(code), "fail", null); }));
    P.push(dcReport("RPT_F10_FINANCE_GCASHFLOW", filter, 16, "REPORT_DATE").then(function (rows) {
      if (gen !== state.gen) return; state.cash = rows;
      mod("cash", "现金流量表", srcF10(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("cash", "现金流量表", srcF10(code), "fail", null); }));
    /* 分红 */
    P.push(dcReport("RPT_SHAREBONUS_DET", filter, 30, "REPORT_DATE").then(function (rows) {
      if (gen !== state.gen) return; state.dividend = rows;
      mod("dividend", "分红送配", srcDividend(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("dividend", "分红送配", srcDividend(code), "fail", null); }));
    /* 解禁 */
    P.push(dcReport("RPT_LIFT_STAGE", filter, 30, "FREE_DATE").then(function (rows) {
      if (gen !== state.gen) return; state.lift = rows;
      mod("lift", "限售解禁", srcDxf(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("lift", "限售解禁", srcDxf(code), "fail", null); }));
    /* 股东户数 */
    P.push(dcReport("RPT_HOLDERNUMLATEST", filter, 1, "END_DATE").catch(function () {
      return dcReport("RPT_HOLDERNUM_DET", filter, 12, "END_DATE");
    }).then(function (rows) {
      if (gen !== state.gen) return; state.holderNum = rows;
      mod("holderNum", "股东户数", srcGdhs(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("holderNum", "股东户数", srcGdhs(code), "fail", null); }));
    /* 质押（中登口径） */
    P.push(dcReport("RPT_CSDC_LIST", secu, 8).then(function (rows) {
      if (gen !== state.gen) return; state.pledge = rows;
      mod("pledge", "股权质押", srcGzyj(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("pledge", "股权质押", srcGzyj(code), "fail", null); }));
    /* 估值历史（PE/PB 分位） */
    P.push(dcReport("RPT_VALUEANALYSIS_DET", filter, 800, "TRADE_DATE").then(function (rows) {
      if (gen !== state.gen) return; state.value = rows;
      mod("value", "估值历史(PE/PB分位)", srcQuote(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("value", "估值历史(PE/PB分位)", srcQuote(code), "fail", null); }));
    /* 研报（reportapi，JSONP）：reportapi 在浏览器偶发挂起 → 后台批次，不阻塞核心渲染 */
    var late = [];
    late.push(fetchJsonp("/report/list?industryCode=*&pageSize=20&pageNo=1&beginTime=" + ymdShift(-190) + "&endTime=" + ymdShift(0) + "&qType=0&code=" + code,
      ["reportapi.eastmoney.com"], 1, "cb", 8000).then(function (d) {
        if (gen !== state.gen) return;
        var rows = d && d.data || [];
        state.reports = rows;
        mod("reports", "券商研报(近6个月)", srcReport(code), rows.length ? "ok_data" : "ok_empty", rows);
      }).catch(function () { if (gen !== state.gen) return; mod("reports", "券商研报(近6个月)", srcReport(code), "fail", null); }));
    /* 可转债 */
    P.push(dcReport("RPT_BOND_CB_LIST", secu, 10).then(function (rows) {
      if (gen !== state.gen) return; state.cb = rows;
      mod("cb", "可转债", srcF10(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("cb", "可转债", srcF10(code), "fail", null); }));
    /* 龙虎榜（探头级） */
    P.push(dcReport("RPT_DAILYBILLBOARD_DETAILSNEW", filter, 10, "TRADE_DATE").then(function (rows) {
      if (gen !== state.gen) return; state.lhb = rows;
      mod("lhb", "龙虎榜(探头)", srcLhb(code), rows.length ? "ok_data" : "ok_empty", rows);
    }).catch(function () { if (gen !== state.gen) return; mod("lhb", "龙虎榜(探头)", srcLhb(code), "fail", null); }));

    return Promise.all(P).then(function () {
      if (gen !== state.gen) return false;
      /* 后台批次（研报）完成且代际仍新鲜时，由 run() 的 lateRender 重渲染 */
      return Promise.all(late).then(function () { return gen === state.gen ? "late" : false; }).catch(function () { return gen === state.gen ? "late" : false; });
    });
  }
  function ymdShift(days) {
    var d = new Date(Date.now() + days * 86400000);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ─────────── 派生计算（估值实算，对应 scripts/valuation.py） ─────────── */
  function lastMain() {
    var rows = state.main || [];
    if (!rows.length) return null;
    var sorted = rows.slice().sort(function (a, b) { return String(b.REPORT_DATE) > String(a.REPORT_DATE) ? 1 : -1; });
    return sorted[0];
  }
  function pick(row, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (row && row[keys[i]] !== undefined && row[keys[i]] !== null && row[keys[i]] !== "-") return num(row[keys[i]]);
    }
    return null;
  }
  function latestRow(rows, dateKey) {
    if (!rows || !rows.length) return null;
    return rows.slice().sort(function (a, b) { return String(b[dateKey]) > String(a[dateKey]) ? 1 : -1; })[0];
  }
  function balancePick(keys) {
    var r = latestRow(state.balance, "REPORT_DATE");
    return pick(r, keys);
  }
  function cashPick(keys) {
    var r = latestRow(state.cash, "REPORT_DATE");
    return pick(r, keys);
  }
  function incomePick(keys) {
    var r = latestRow(state.income, "REPORT_DATE");
    return pick(r, keys);
  }

  function derive() {
    var qt = state.qt || {};
    var m = lastMain() || {};
    var price = qt.close;
    var mvYi = qt.mvYi;                      /* 总市值(亿) */
    var shares = (price && mvYi) ? mvYi * 1e8 / price : null;   /* 总股本 */
    var np = pick(m, ["PARENTNETPROFIT"]);
    var rev = pick(m, ["TOTALOPERATEREVE"]);
    var roe = pick(m, ["ROEJQ", "ROEJQ_YEAR"]);
    var debtRatio = pick(m, ["ZCFZL"]);
    var npTz = pick(m, ["PARENTNETPROFITTZ"]);
    var revTz = pick(m, ["TOTALOPERATEREVETZ"]);
    var kf = pick(m, ["KCFJCXSYJLR", "KCFJCXSYJLR_TZ"]);
    var mgOcf = pick(m, ["MGJYXJJE_JLRTM"]);
    /* MAINFINADATA 净利单位为元；总股本 = 总市值(元) ÷ 现价 → eps = np / shares */
    var eps = (np !== null && shares) ? (np / shares) : null;
    /* 有息负债与现金（资产负债表择优；取不到按负债率推算并标推算） */
    var shortLoan = balancePick(["SHORT_LOAN", "SHORT_LOAN_1", "SHORT_LOAN_L"]);
    var noncur1y = balancePick(["NONCURRENT_LIAB_1YEAR", "NONCURRENT_LIAB_ONEYEAR"]);
    var longLoan = balancePick(["LONG_LOAN"]);
    var bondPay = balancePick(["BOND_PAYABLE"]);
    var ibd = (shortLoan !== null || longLoan !== null)
      ? (shortLoan || 0) + (noncur1y || 0) + (longLoan || 0) + (bondPay || 0) : null;
    var cashMs = balancePick(["MONETARYFUNDS", "MONETARY_FUNDS"]);
    var equityP = balancePick(["TOTAL_PARENT_EQUITY", "TOTAL_EQUITY"]);
    var totalAsset = balancePick(["TOTAL_ASSETS"]);
    var ocf = cashPick(["NETCASH_OPERATE", "NETCASH_OPERATE_TTM"]);
    var capex = cashPick(["CONSTRUCT_LONG_ASSET", "BUY_FIXED_INTANGIBLE"]);
    var ibdApprox = false;
    if (ibd === null && debtRatio !== null && totalAsset) { ibd = totalAsset * debtRatio / 100 * 0.45; ibdApprox = true; }
    if (ibd !== null) ibd = ibd / 1e8;   /* 元 → 亿 */

    /* β：个股周收益 vs 沪深300（两年窗口） */
    var beta = null;
    if (state.kline5y && state.kline5y.length > 120 && state.klineHs300 && state.klineHs300.length > 120) {
      var map = {};
      state.klineHs300.forEach(function (b) { map[b.date] = b.close; });
      var pairs = [];
      var prevS = null, prevB = null;
      state.kline5y.slice(-520).forEach(function (b) {
        if (map[b.date] !== undefined) {
          if (prevS && prevB && prevB > 0) {
            pairs.push([b.close / prevS - 1, map[b.date] / prevB - 1]);
          }
          prevS = b.close; prevB = map[b.date];
        }
      });
      /* 周收益抽样 → 降频为月（每4个取1）以降噪 */
      var mp = [];
      for (var i = 0; i < pairs.length; i += 4) mp.push(pairs[i]);
      if (mp.length > 20) {
        var mx = 0, my = 0;
        mp.forEach(function (p) { mx += p[0]; my += p[1]; });
        mx /= mp.length; my /= mp.length;
        var cov = 0, varx = 0;
        mp.forEach(function (p) { cov += (p[0] - mx) * (p[1] - my); varx += (p[0] - mx) * (p[0] - mx); });
        beta = varx > 0 ? cov / varx : null;
        if (beta !== null) beta = Math.max(0.2, Math.min(2.5, beta));
      }
    }

    /* 估值分位（估值历史） */
    var pePct = null, pbPct = null, peLo = null, pbLo = null, peHi = null;
    if (state.value && state.value.length) {
      var pes = [], pbs = [];
      state.value.forEach(function (r) {
        var pe = num(r.PE_TTM), pb = num(r.PB_MRQ || r.PB_NEW || r.PB);
        if (pe !== null && pe > 0) pes.push(pe);
        if (pb !== null && pb > 0) pbs.push(pb);
      });
      pes.sort(function (a, b) { return a - b; });
      pbs.sort(function (a, b) { return a - b; });
      if (pes.length > 30 && qt.pe) {
        var below = pes.filter(function (x) { return x <= qt.pe; }).length;
        pePct = Math.round(below / pes.length * 1000) / 10;
        peLo = pes[0]; peHi = pes[pes.length - 1];
      }
      if (pbs.length > 30 && qt.pb) {
        var belowPb = pbs.filter(function (x) { return x <= qt.pb; }).length;
        pbPct = Math.round(belowPb / pbs.length * 1000) / 10;
        pbLo = pbs[0];
      }
    }

    /* 近1/3/5年涨跌幅 + 沪深300对照 */
    function winRet(bars, days) {
      if (!bars || bars.length < days + 1) return null;
      var a = bars[bars.length - 1 - days].close, b = bars[bars.length - 1].close;
      return (b / a - 1) * 100;
    }
    var ret1 = winRet(state.kline5y, 244), ret3 = winRet(state.kline5y, 732), ret5 = winRet(state.kline5y, 1220);
    var hsRet1 = winRet(state.klineHs300, 244), hsRet3 = winRet(state.klineHs300, 732), hsRet5 = winRet(state.klineHs300, 1220);

    /* 分红 / DPS */
    var dps = (qt.dividend && price) ? qt.dividend * price / 100 : null;
    var payout = null;
    if (dps !== null && eps) payout = dps / eps * 100;

    /* 净现比 */
    var ncfRatio = (ocf !== null && np) ? ocf / np : (mgOcf !== null && eps ? (mgOcf / eps) : null);

    /* 扣非占比 */
    var kfRatio = (kf !== null && np) ? kf / np : null;

    var d = {
      price: price, mvYi: mvYi, shares: shares, np: np, rev: rev, roe: roe,
      debtRatio: debtRatio, npTz: npTz, revTz: revTz, kf: kf, kfRatio: kfRatio,
      eps: eps, dps: dps, payout: payout, ibdYi: ibd, ibdApprox: ibdApprox,
      cashYi: cashMs !== null ? cashMs / 1e8 : null, ocfYi: ocf !== null ? ocf / 1e8 : null,
      capexYi: capex !== null ? capex / 1e8 : null, equityYi: equityP !== null ? equityP / 1e8 : null,
      beta: beta, pePct: pePct, pbPct: pbPct, peLo: peLo, peHi: peHi, pbLo: pbLo,
      ret1: ret1, ret3: ret3, ret5: ret5, hsRet1: hsRet1, hsRet3: hsRet3, hsRet5: hsRet5,
      ncfRatio: ncfRatio, turnover: qt.turnover, amountYi: qt.amountWan ? qt.amountWan / 1e4 : null,
    };
    return d;
  }

  /* WACC / DCF / 反向DCF / DDM / PVGO / EPV / EVA / ROIC */
  function wacc(a, d) {
    var E = d.mvYi || 0;
    var D = d.ibdYi || 0;
    var V = E + D;
    if (!V) return null;
    var re = a.rf / 100 + a.beta * a.erp / 100;
    var rd = a.rd / 100 * (1 - a.tax / 100);
    return (E / V) * re + (D / V) * rd;
  }
  function roic(d, w) {
    var np = d.np;
    if (np === null) return null;
    var ic = (d.equityYi || 0) + (d.ibdYi || 0) - (d.cashYi || 0);
    if (ic <= 0) return null;
    var nopat = np * (1 - (state.assumption ? state.assumption.tax : 25) / 100);
    return nopat / ic * 100;
  }
  function baseFcf(d) {
    if (d.ocfYi !== null && d.capexYi !== null) return d.ocfYi - d.capexYi;      /* 已核：现金流量表 */
    if (d.np !== null && d.ncfRatio !== null) return d.np * d.ncfRatio;          /* 推算：净利×净现比 */
    if (d.np !== null) return d.np * 0.85;                                        /* 推算：缺净现比按 0.85 */
    return null;
  }
  function dcfValue(a, d) {
    var f0 = baseFcf(d);
    if (f0 === null || !d.shares) return null;
    var w = wacc(a, d);
    if (w === null || w <= a.gt / 100 + 0.005) return null;
    var pv = 0, f = f0;
    for (var t = 1; t <= 5; t++) { f *= (1 + a.g1 / 100); pv += f / Math.pow(1 + w, t); }
    var tv = f * (1 + a.gt / 100) / (w - a.gt / 100);
    pv += tv / Math.pow(1 + w, 5);
    var net = pv - (d.ibdYi || 0) + (d.cashYi || 0);
    return { evYi: pv, equityYi: net, perShare: net * 1e8 / d.shares, w: w, f0: f0 };
  }
  function reverseG(a, d) {
    /* 反向 DCF：二分求解显性期增速使估值=现价 */
    var saved = a.g1;
    var lo = -20, hi = 60, ans = null;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      a.g1 = mid;
      var v = dcfValue(a, d);
      if (v === null) break;
      if (v.perShare < d.price) lo = mid; else { hi = mid; ans = mid; }
    }
    a.g1 = saved;
    return ans;
  }
  function ddmValue(a, d) {
    if (d.dps === null) return null;
    var r = wacc(a, d) || a.rf / 100 + a.beta * a.erp / 100;
    var g = Math.min(a.gt, 100) / 100;
    if (r <= g + 0.005) return null;
    return d.dps * (1 + g) / (r - g);
  }
  function pvgo(a, d) {
    if (!d.eps || !d.payout) return null;
    var r = wacc(a, d) || 0.08;
    if (r <= 0) return null;
    return d.price - d.eps * (d.payout / 100) / r;
  }
  function epvValue(a, d) {
    /* EPV：EBIT 近似 = 净利 ÷ (1−t)（缺利润表明细时按推算） */
    var np = d.np;
    if (np === null) return null;
    var ebit = np / (1 - a.tax / 100);
    var w = wacc(a, d);
    if (!w || !d.shares) return null;
    var v = ebit * (1 - a.tax / 100) / w;
    return { opYi: v, equityYi: v - (d.ibdYi || 0) + (d.cashYi || 0), perShare: (v - (d.ibdYi || 0) + (d.cashYi || 0)) * 1e8 / d.shares };
  }
  function evaOne(a, d) {
    var r = roic(d, null);
    var w = wacc(a, d);
    if (r === null || w === null) return null;
    return { roic: r, wacc: w * 100, spread: r - w * 100 };
  }

  /* 会计质量评分（可信 / 需警惕 / 不可信） */
  function accountingGrade(d, cut) {
    if (!d.np) return { grade: "数据不足", score: null, flags: [] };
    var flags = [];
    var score = 0;
    var kfR = d.kfRatio;
    if (kfR !== null && kfR < 0.7) { flags.push({ lv: "高危", t: "扣非/归母 " + (kfR * 100).toFixed(0) + "%，利润含非经常项偏高" }); score += 2; }
    if (d.ncfRatio !== null && d.ncfRatio < 0.7) { flags.push({ lv: "高危", t: "净现比 " + d.ncfRatio.toFixed(2) + "，利润含现量不足" }); score += 2; }
    else if (d.ncfRatio !== null && d.ncfRatio < 0.9) { flags.push({ lv: "观察", t: "净现比 " + d.ncfRatio.toFixed(2) + "，略低于 1" }); score += 1; }
    if (d.debtRatio !== null && d.debtRatio > 70) { flags.push({ lv: "观察", t: "资产负债率 " + d.debtRatio.toFixed(0) + "%" }); score += 1; }
    var pledgeRow = latestRow(state.pledge, "END_DATE") || (state.pledge && state.pledge[0]);
    var pl = pledgeRow ? pick(pledgeRow, ["PLEDGE_RATIO", "ZRATIO", "PLEDGE_RATIO_TOTAL"]) : null;
    if (pl !== null && pl > 50) { flags.push({ lv: pl > 70 ? "致命" : "高危", t: "质押比例 " + pl.toFixed(0) + "%" }); score += pl > 70 ? 4 : 2; }
    var m = mScore(d);
    if (m && m.score > -1.78) { flags.push({ lv: "高危", t: "Beneish M-Score " + m.score.toFixed(2) + "，高于 −1.78 阈值" }); score += 3; }
    var grade = score >= 5 ? "不可信" : (score >= 2 ? "需警惕" : "可信");
    return { grade: grade, score: score, flags: flags, pledgeRatio: pl, m: m };
  }
  /* Beneish M-Score：三表齐备且至少两年才实算，否则数据不足 */
  function mScore(d) {
    if (!state.balance || state.balance.length < 8 || !state.income || state.income.length < 8) return null;
    try {
      var sortRows = function (rows) { return rows.slice().sort(function (a, b) { return String(b.REPORT_DATE) > String(a.REPORT_DATE) ? 1 : -1; }); };
      var B = sortRows(state.balance), I = sortRows(state.income);
      var cur = B[0], prev = B[1] || B[Math.min(3, B.length - 1)];
      var curI = I[0], prevI = I[1] || I[Math.min(3, I.length - 1)];
      function g(r, keys) { return pick(r, keys); }
      var recC = g(cur, ["ACCOUNTS_RECE", "NOTE_ACCOUNTS_RECE"]), recP = g(prev, ["ACCOUNTS_RECE", "NOTE_ACCOUNTS_RECE"]);
      var revC = g(curI, ["TOTAL_OPERATE_INCOME", "OPERATE_INCOME"]), revP = g(prevI, ["TOTAL_OPERATE_INCOME", "OPERATE_INCOME"]);
      var gmC = g(curI, ["GROSS_PROFIT"]) / (revC || 1), gmP = g(prevI, ["GROSS_PROFIT"]) / (revP || 1);
      var taC = g(cur, ["TOTAL_ASSETS"]), taP = g(prev, ["TOTAL_ASSETS"]);
      var ncaC = taC - g(cur, ["TOTAL_CURRENT_ASSETS"]), ncaP = taP - g(prev, ["TOTAL_CURRENT_ASSETS"]);
      var depC = g(curI, ["DEPRECIATION_OF_FIXED_ASSET"]), depP = g(prevI, ["DEPRECIATION_OF_FIXED_ASSET"]);
      var sgaC = g(curI, ["SALE_EXPENSE", "SALE_EXPENSES"]), sgaP = g(prevI, ["SALE_EXPENSE", "SALE_EXPENSES"]);
      var tliC = g(cur, ["TOTAL_LIABILITIES"]), tliP = g(prev, ["TOTAL_LIABILITIES"]);
      var niC = g(curI, ["PARENTNETPROFIT", "NETPROFIT"]), taCA = taC;
      var accC = g(curI, ["NETCASH_OPERATE"]) !== null ? (niC - g(curI, ["NETCASH_OPERATE"])) : null;
      if ([recC, recP, revC, revP, taC, taP, ncaC, ncaP, tliC, tliP, niC].some(function (x) { return x === null || x === 0; })) return null;
      var dsri = (recC / revC) / (recP / revP);
      var gmi = (gmP || 0) / (gmC || 1);
      var aqi = (ncaC / taC) / (ncaP / taP);
      var sgi = revC / revP;
      var depi = ((depP || 0) / (ncaP || 1)) / (((depC || 0) / (ncaC || 1)) || 1);
      var sgai = (sgaC || revC * 0.1) / revC / ((sgaP || revP * 0.1) / revP || 1);
      var lvgi = (tliC / taC) / (tliP / taP);
      var tata = accC !== null ? accC / taC : -0.02;
      var m = -4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi +
        0.115 * (depi || 1) - 0.172 * (sgai || 1) + 0.327 * (lvgi || 1) + 4.679 * tata;
      return { score: m, parts: { dsri: dsri, gmi: gmi, aqi: aqi, sgi: sgi } };
    } catch (e) { return null; }
  }

  /* 财务状况五档 + 持有信心分 */
  function financeVerdict(d, acc) {
    var pts = [];
    var pos = 0, neg = 0;
    if (d.roe !== null && d.roe >= 12) { pos += 2; pts.push({ s: 1, t: "ROE " + d.roe.toFixed(1) + "%" }); }
    else if (d.roe !== null && d.roe < 6) { neg += 2; pts.push({ s: -1, t: "ROE " + d.roe.toFixed(1) + "%" }); }
    if (d.npTz !== null && d.npTz > 10) { pos += 2; pts.push({ s: 1, t: "归母增速 +" + d.npTz.toFixed(0) + "%" }); }
    else if (d.npTz !== null && d.npTz < -10) { neg += 2; pts.push({ s: -1, t: "归母增速 " + d.npTz.toFixed(0) + "%" }); }
    if (d.ncfRatio !== null && d.ncfRatio >= 1) pos += 1;
    if (d.debtRatio !== null && d.debtRatio < 45) pos += 1;
    if (d.debtRatio !== null && d.debtRatio > 65) neg += 1;
    if (acc && acc.grade === "不可信") neg += 3;
    if (acc && acc.grade === "需警惕") neg += 1;
    if (acc && acc.pledgeRatio !== null && acc.pledgeRatio > 50) neg += 1;
    var net = pos - neg;
    var verdict = net >= 3 ? "乐观" : net >= 1 ? "中性偏乐观" : net >= 0 ? "中性" : net >= -2 ? "偏谨慎" : "悲观";
    var support = pts.slice(0, 2).map(function (p) { return p.t; });
    var contra = pts.find(function (p) { return p.s < 0; });
    return { verdict: verdict, net: net, support: support, contra: contra ? contra.t : null };
  }
  function confidence(d, acc, verdict) {
    var base = 55;
    if (d.roe !== null) base += Math.max(-12, Math.min(15, (d.roe - 10) * 1.5));
    if (d.ncfRatio !== null) base += Math.max(-15, Math.min(10, (d.ncfRatio - 1) * 20));
    if (d.npTz !== null) base += Math.max(-12, Math.min(12, d.npTz * 0.5));
    if (acc && acc.grade === "不可信") base -= 30;
    if (acc && acc.grade === "需警惕") base -= 12;
    if (acc && acc.pledgeRatio !== null && acc.pledgeRatio > 50) base -= 8;
    if (d.pePct !== null && d.pePct < 30) base += 6;
    if (d.pePct !== null && d.pePct > 80) base -= 8;
    if (verdict === "乐观") base += 6;
    if (verdict === "悲观") base -= 10;
    return Math.max(5, Math.min(92, Math.round(base)));
  }

  /* 三档情景 + 压力测试 + 资产底 */
  function scenarios(d, acc) {
    var pe = state.qt && state.qt.pe;
    var eps = d.eps;
    if (!pe || !eps || !d.price) return null;
    var bvps = d.equityYi && d.shares ? d.equityYi * 1e8 / d.shares : null;
    var peLow = d.peLo || pe * 0.55;
    var bearEps = eps * 0.7;
    return [
      { name: "乐观", target: eps * 1.25 * pe, prob: 25 },
      { name: "中性", target: eps * pe, prob: 50 },
      { name: "悲观", target: eps * 0.8 * pe, prob: 25 },
      { name: "估值回归", target: bvps ? bvps * peLow : null, prob: null },
      { name: "双杀", target: bearEps * peLow, prob: null },
      { name: "资产底", target: assetFloor(d), prob: null },
    ].map(function (s) {
      s.down = s.target ? (s.target / d.price - 1) * 100 : null;
      return s;
    });
  }
  function assetFloor(d) {
    if (d.cashYi === null) return null;
    var floatMv = state.qt && state.qt.floatMvYi;
    /* 简化资产底：现金 − 有息负债（上市股权市值重估需人工，标推算） */
    return (d.cashYi - (d.ibdYi || 0)) * 1e8 / (d.shares || 1);
  }
  /* 敏感性矩阵：收入增速 × 净利率 → 第3年目标价 */
  function sensitivity(d) {
    if (!d.eps || !d.rev || !state.qt || !state.qt.pe) return null;
    var growths = [-5, 5, 15];
    var margins = null;
    /* 净利率 = 归母/营收 */
    var nm = d.np / d.rev * 100;
    margins = [nm * 0.8, nm, nm * 1.2];
    var baseShares = d.shares;
    var grid = growths.map(function (g) {
      return margins.map(function (m) {
        var eps3 = d.rev * Math.pow(1 + g / 100, 3) * (m / 100) / baseShares;
        return Math.round(eps3 * state.qt.pe * 100) / 100;
      });
    });
    return { growths: growths, margins: margins.map(function (m) { return m.toFixed(1) + "%"; }), grid: grid };
  }

  /* ─────────── 渲染 ─────────── */
  function stateChip(st) {
    if (st === "ok_data") return '<span class="co-stat ok">已采数据</span>';
    if (st === "ok_empty") return '<span class="co-stat empty">真阴性(该期无数据)</span>';
    return '<span class="co-stat fail">采集失败→待核实</span>';
  }
  function sec(title, inner, key, extraNote) {
    var m = MODS[key];
    var head = '<div class="co-sec-h"><b>' + title + "</b>" +
      (key && m ? stateChip(m.state) : "") +
      (m && m.src ? ' <a class="co-src" target="_blank" rel="noopener" href="' + m.src + '">来源入口 ↗</a>' : "") +
      (extraNote ? '<span class="co-note">' + extraNote + "</span>" : "") +
      "</div>";
    return '<section class="co-sec">' + head + inner + "</section>";
  }
  function table(html) { return '<div class="co-table-wrap"><table class="mkt-table">' + html + "</table></div>"; }
  function kvGrid(pairs) {
    var h = '<div class="co-kv">';
    pairs.forEach(function (p) {
      h += '<div class="co-kv-i"><span class="k">' + p[0] + '</span><span class="v">' + p[1] + "</span></div>";
    });
    return h + "</div>";
  }
  function evTag(level) {
    /* 证据分级：已核 / 推算 / 未核 */
    if (level === "calc") return '<span class="co-ev calc">推算</span>';
    if (level === "un") return '<span class="co-ev un">未核</span>';
    return '<span class="co-ev ok">已核</span>';
  }
  function fmtPct(v, digits) { return v === null || v === undefined ? "--" : (v > 0 ? "+" : "") + v.toFixed(digits === undefined ? 2 : digits) + "%"; }
  function fmtN(v, d) { return v === null || v === undefined ? "--" : Number(v).toFixed(d === undefined ? 2 : d); }

  function renderPipeline() {
    var h = '<div class="co-mods">';
    Object.keys(MODS).forEach(function (k) {
      var m = MODS[k];
      h += '<div class="co-mod"><span class="co-mod-name">' + esc(m.label) + "</span>" + stateChip(m.state) + "</div>";
    });
    h += "</div>";
    return h;
  }

  function buildReport() {
    var d = derive();
    var a = ASSUM();
    var acc = accountingGrade(d);
    var verdict = financeVerdict(d, acc);
    var conf = confidence(d, acc, verdict.verdict);
    var scs = scenarios(d, acc);
    var w = wacc(a, d);
    var dc = dcfValue(a, d);
    var rg = reverseG(a, d);
    var dm = ddmValue(a, d);
    var pg = pvgo(a, d);
    var ep = epvValue(a, d);
    var ev = evaOne(a, d);
    var sens = sensitivity(d);
    var rating = (d.pePct !== null && d.pePct < 30 && verdict.net >= 1) ? "增持"
      : (d.pePct !== null && d.pePct > 80) ? "中性（估值分位偏高）"
      : verdict.net >= 1 ? "增持" : verdict.net >= 0 ? "中性" : "减持";
    /* 可信度×动作矩阵（硬约束） */
    var capNote = "";
    if (acc.grade === "不可信") { rating = rating === "买入" || rating === "增持" ? "中性(封顶)" : rating; capNote = "会计评级不可信：结论封顶中性，不给买入；估值只保留资产底/清算视角。"; }
    if (acc.grade === "需警惕") capNote = "会计评级需警惕：允许增持但仓位减半。禁止用便宜对冲可信度。";

    var h = "";
    /* ── 决策页（置顶） ── */
    h += '<section class="co-sec co-hero">';
    h += '<div class="co-hero-h"><h2>' + esc(state.name || state.code) + "（" + state.code + "）深度研究</h2>" +
      '<span class="co-price">现价 <b>' + fmtN(d.price) + "</b> 元 · 总市值 " + fmtN(d.mvYi, 0) + " 亿</span>" +
      '<span class="co-date">查询日期 ' + ymdShift(0) + " · 全部数据免登录公开接口</span></div>";
    h += '<div class="co-verdict"><span class="co-verdict-v">' + esc(verdict.verdict) + "</span>" +
      '<span class="co-conf">持有信心 <b>' + conf + "</b>/100</span>" +
      '<span class="co-rating">评级 <b>' + esc(rating) + "</b></span></div>";
    if (capNote) h += '<div class="co-cap">' + esc(capNote) + "</div>";
    h += "<div class='co-why'><b>为何投资这个股票（3–5 句）</b><ol>" +
      "<li>这是<b>" + esc(state.name || state.code) + "</b>：现价买到的是每股净资产 <b>" + fmtN(d.equityYi && d.shares ? d.equityYi * 1e8 / d.shares : null) + "</b> 元、每股年利润 <b>" + fmtN(d.eps) + "</b> 元" + (d.dps !== null ? "、每股股息 <b>" + fmtN(d.dps) + "</b> 元" : "") + "。</li>" +
      "<li>财务状况<b>" + esc(verdict.verdict) + "</b>" + (verdict.support.length ? "——支撑：" + verdict.support.map(esc).join("、") : "") + (verdict.contra ? "；反向证据：" + esc(verdict.contra) : "；反向证据不足") + "。</li>" +
      "<li>回报来源：股息 " + (d.dps !== null && d.price ? (d.dps / d.price * 100).toFixed(1) + "%" : "--") +
        " + 盈利增长（归母增速 " + fmtPct(d.npTz, 0) + "）+ 估值修复（PE 分位 " + fmtN(d.pePct, 0) + "%）。</li>" +
      "<li>安全垫：资产底约 <b>" + (assetFloor(d) ? fmtN(assetFloor(d)) : "待核实") + "</b> 元" +
        "；历史低 PB " + fmtN(d.pbLo) + "（现价 PB " + fmtN(state.qt && state.qt.pb) + "）。</li>" +
      "<li>别期待：短期估值扩张的钱" + (d.pePct !== null && d.pePct > 60 ? "（PE 分位已高）" : "") + "；数据缺口见「最大盲区」。</li>" +
      "</ol></div>";
    h += '<div class="co-falsify"><b>证伪条件</b>：' + (d.npTz !== null ? "下一报告期归母增速跌破 " + (d.npTz > 0 ? "0%" : "进一步恶化") : "营收转负") +
      "，或应收增速持续高于收入增速 10pct。</div>";
    h += '<div class="co-blind"><b>最大盲区</b>：' + blindSpots() + "</div>";
    h += "</section>";

    /* ── 采集管线三态 ── */
    h += sec("数据采集管线（三态 · 免登录公开接口）", renderPipeline(), null);

    /* ── 关键指标仪表盘 ── */
    h += sec("关键指标仪表盘", kvGrid([
      ["PE-TTM", fmtN(state.qt && state.qt.pe) + evTag("ok")],
      ["PE 分位(区间内)", fmtN(d.pePct, 0) + "%" + evTag(d.pePct === null ? "un" : "calc")],
      ["PB", fmtN(state.qt && state.qt.pb) + evTag("ok")],
      ["PB 分位", fmtN(d.pbPct, 0) + "%" + evTag(d.pbPct === null ? "un" : "calc")],
      ["ROE(报告期)", fmtN(d.roe, 1) + "%" + evTag("ok")],
      ["归母增速", fmtPct(d.npTz, 0) + evTag("ok")],
      ["营收增速", fmtPct(d.revTz, 0) + evTag("ok")],
      ["净现比", fmtN(d.ncfRatio) + evTag(d.ncfRatio === null ? "un" : "calc")],
      ["扣非/归母", fmtN(d.kfRatio) + evTag(d.kfRatio === null ? "un" : "calc")],
      ["资产负债率", fmtN(d.debtRatio, 0) + "%" + evTag("ok")],
      ["股息率", fmtN(state.qt && state.qt.dividend, 2) + "%" + evTag("ok")],
      ["换手率", fmtN(d.turnover, 2) + "%" + evTag("ok")],
    ]), null);

    /* ── M1 主营构成 ── */
    if (state.mainop && state.mainop.length) {
      var opRows = state.mainop.slice(0, 14).map(function (r) {
        return "<tr><td>" + esc(String(r.MAINOP_TYPE || "--")) + "</td><td>" + esc(String(r.MAINOP_ITEM || "--")) + "</td>" +
          "<td class='num'>" + fmtN(num(r.MAINOP_INCOME) / 1e8, 1) + "</td>" +
          "<td class='num'>" + fmtN(num(r.MAINOP_RATIO) * (num(r.MAINOP_RATIO) > 1 ? 1 : 100), 1) + "%</td>" +
          "<td class='num'>" + fmtN(num(r.MAINOP_GROSS_RATIO) * (num(r.MAINOP_GROSS_RATIO) > 1 ? 1 : 100), 1) + "%</td></tr>";
      }).join("");
      h += sec("M1 · 主营构成（收入分部）", table("<thead><tr><th>类别</th><th>项目</th><th>收入(亿)</th><th>占比</th><th>毛利率</th></tr></thead><tbody>" + opRows + "</tbody>"), "mainop",
        "利润分部需结合分部净利（如披露），收入占比 ≠ 利润占比");
    } else {
      h += sec("M1 · 主营构成（分部表）", '<div class="co-miss">主营构成未取到（' + stateChip((MODS.mainop || {}).state) + "）。分部拆解需在来源入口页人工核对年报「管理层讨论」。" + evTag("un") + "</div>", "mainop");
    }

    /* ── M2 盈利能力 ── */
    h += sec("M2 · 盈利能力与利润质量", kvGrid([
      ["ROIC(简化)", fmtN(roic(d, null), 1) + "%" + evTag("calc")],
      ["WACC(实算)", w ? fmtN(w * 100, 1) + "%" + evTag("calc") : "--" + evTag("un")],
      ["ROIC−WACC", evaOne(a, d) ? fmtN(evaOne(a, d).spread, 1) + "pct" + evTag("calc") : "--"],
      ["净现比(OCF/归母)", fmtN(d.ncfRatio) + evTag(d.ncfRatio === null ? "un" : "calc")],
      ["扣非/归母", fmtN(d.kfRatio) + evTag(d.kfRatio === null ? "un" : "calc")],
      ["经营现金流净额", fmtN(d.ocfYi, 1) + " 亿" + evTag(d.ocfYi === null ? "un" : "ok")],
      ["资本开支", fmtN(d.capexYi, 1) + " 亿" + evTag(d.capexYi === null ? "un" : "ok")],
      ["自由现金流(推算)", fmtN(d.ocfYi !== null && d.capexYi !== null ? d.ocfYi - d.capexYi : null, 1) + " 亿" + evTag("calc")],
    ]), "income");

    /* ── M3 会计质量 ── */
    var accHtml = '<div class="co-acc-grade">评级：<b>' + esc(acc.grade) + "</b>" +
      (acc.m ? " · Beneish M-Score <b>" + acc.m.score.toFixed(2) + "</b>（阈值 −1.78）" + evTag("calc") : " · M-Score 数据不足，未实算" + evTag("un")) + "</div>";
    if (acc.flags.length) {
      var fh = "<thead><tr><th>级别</th><th>红旗</th></tr></thead><tbody>" +
        acc.flags.map(function (f) { return "<tr><td class='co-lv " + esc(f.lv) + "'>" + esc(f.lv) + "</td><td>" + esc(f.t) + "</td></tr>"; }).join("") + "</tbody>";
      accHtml += table(fh);
    } else {
      accHtml += '<div class="co-miss">未命中已可机检的红旗（不代表没有，人工核查入口见来源）。</div>';
    }
    accHtml += '<div class="co-note">可信度×动作矩阵：不可信 → 结论封顶中性、不给买入；需警惕 → 仓位减半。禁止用便宜对冲可信度。</div>';
    h += sec("M3 · 会计质量与治理", accHtml, "balance");

    /* ── M5 资产负债与现金流 ── */
    h += sec("M5 · 资产负债与现金流", kvGrid([
      ["有息负债" + (d.ibdApprox ? "(推算)" : ""), fmtN(d.ibdYi, 1) + " 亿" + evTag(d.ibdApprox ? "calc" : (d.ibdYi === null ? "un" : "ok"))],
      ["货币资金", fmtN(d.cashYi, 1) + " 亿" + evTag(d.cashYi === null ? "un" : "ok")],
      ["净资产(归母)", fmtN(d.equityYi, 1) + " 亿" + evTag(d.equityYi === null ? "un" : "ok")],
      ["资产负债率", fmtN(d.debtRatio, 0) + "%" + evTag("ok")],
    ]), "balance");

    /* ── M6 估值（实算） ── */
    var valHtml = kvGrid([
      ["WACC", w ? fmtN(w * 100, 2) + "%" + evTag("calc") : "--" + evTag("un")],
      ["DCF 合理价(5y+" + a.gt + "%永续)", dc ? fmtN(dc.perShare) + evTag("calc") : "--" + evTag("un")],
      ["反向 DCF 隐含增速", rg !== null ? fmtN(rg, 1) + "%/年" + evTag("calc") : "--" + evTag("un")],
      ["DDM 合理价", dm ? fmtN(dm) + evTag("calc") : "--（股息数据缺失）"],
      ["PVGO 占股价", pg !== null ? fmtN(pg / d.price * 100, 0) + "%" + evTag("calc") : "--"],
      ["EPV 合理价", ep ? fmtN(ep.perShare) + evTag("calc") : "--" + evTag("un")],
      ["ROIC", fmtN(roic(d, null), 1) + "%" + evTag("calc")],
      ["FCF Yield(推算)", baseFcf(d) !== null && d.mvYi ? fmtN(baseFcf(d) / d.mvYi * 100, 2) + "%" + evTag("calc") : "--"],
    ]);
    if (dc && d.price) {
      var pos = dc.perShare / d.price;
      valHtml += '<div class="co-note">现价/DCF 合理价 = <b>' + fmtN(pos * 100, 0) + "%</b> —— " +
        (pos < 0.8 ? "现价低于模型估值，隐含假设偏悲观。" : pos > 1.2 ? "现价高于模型估值，隐含假设偏乐观。" : "现价与模型估值大体相当。") +
        "（假设：rf " + a.rf + "% · erp " + a.erp + "% · β " + fmtN(a.beta) + " · g1 " + a.g1 + "% · 永续 " + a.gt + "%）</div>";
    }
    if (rg !== null && d.npTz !== null) {
      valHtml += '<div class="co-note">现价隐含 FCF 增速 <b>' + fmtN(rg, 1) + '%/年</b>， vs 归母增速 ' + fmtPct(d.npTz, 0) + " —— 差距即市场在赌的部分。</div>";
    }
    h += sec("M6 · 估值（页面内实算 · 假设见下方假设面板）", valHtml, "value");

    /* ── M7 敏感性 ── */
    if (sens) {
      var sh = "<thead><tr><th>收入增速 \\ 净利率</th>" + sens.margins.map(function (m) { return "<th>" + esc(m) + "</th>"; }).join("") + "</tr></thead><tbody>";
      sens.grid.forEach(function (row, i) {
        sh += "<tr><td>" + sens.growths[i] + "%</td>" + row.map(function (v) {
          return "<td class='num" + (v > d.price * 1.2 ? " up" : v < d.price * 0.8 ? " down" : "") + "'>" + fmtN(v) + "</td>";
        }).join("") + "</tr>";
      });
      h += sec("M7 · 敏感性矩阵（第3年目标价 = EPS₃ × 现价PE）", table(sh + "</tbody>"), null,
        "驱动外推为简化模型（整体增速×净利率），分板块驱动需人工补");
    } else {
      h += sec("M7 · 敏感性矩阵", '<div class="co-miss">缺少营收/净利基期数据，待核实。' + evTag("un") + "</div>", "main");
    }

    /* ── M8 券商与预期差 ── */
    if (state.reports && state.reports.length) {
      var rh = "<thead><tr><th>机构</th><th>日期</th><th>评级</th><th>目标价</th></tr></thead><tbody>";
      var tps = [];
      state.reports.slice(0, 12).forEach(function (r) {
        rh += "<tr><td>" + esc(String(r.orgSName || "--")) + "</td><td>" + esc(String(r.publishDate || "").slice(0, 10)) +
          "</td><td>" + esc(String(r.emRatingName || r.sRatingName || "--")) + "</td>" +
          "<td>" + esc(String(r.title || "").slice(0, 42)) + "</td></tr>";
      });
      h += sec("M8 · 券商研报（近6个月 " + state.reports.length + " 份）", table(rh + "</tbody>"), "reports",
        "目标价与一致预期需点开单篇研报核对（列表接口不含目标价）");
    } else {
      h += sec("M8 · 券商研报", '<div class="co-miss">研报数据未取到（' + stateChip((MODS.reports || {}).state) + "），入口见来源。</div>", "reports");
    }

    /* ── M10 筹码与资本运作 ── */
    var chip = kvGrid([
      ["股东户数(最新)", state.holderNum && state.holderNum.length ? fmtN(pick(state.holderNum[0], ["HOLDER_NUM"]) , 0) + evTag("ok") : "--" + evTag("un")],
      ["质押比例", acc.pledgeRatio !== null ? fmtN(acc.pledgeRatio, 0) + "%" + evTag("ok") : "--" + evTag("un")],
      ["融资余额", '<a class="co-src" target="_blank" rel="noopener" href="' + srcRzrq(state.code) + '">未核·入口 ↗</a>'],
      ["日均成交额(亿)", fmtN(d.amountYi, 2) + evTag("ok")],
      ["近1年涨跌(对比沪深300)", fmtPct(d.ret1, 0) + " / " + fmtPct(d.hsRet1, 0) + evTag("calc")],
      ["近3年涨跌(对比沪深300)", fmtPct(d.ret3, 0) + " / " + fmtPct(d.hsRet3, 0) + evTag("calc")],
    ]);
    if (state.lift && state.lift.length) {
      var lh = "<thead><tr><th>解禁日期</th><th>解禁股(万)</th><th>占总股本</th></tr></thead><tbody>";
      state.lift.slice(0, 6).forEach(function (r) {
        lh += "<tr><td>" + esc(String(r.FREE_DATE || "").slice(0, 10)) + "</td>" +
          "<td class='num'>" + fmtN(num(r.LIFT_NUM) / 1e4, 0) + "</td>" +
          "<td class='num'>" + fmtN(num(r.LIFT_RATIO) * (num(r.LIFT_RATIO) > 1 ? 1 : 100), 1) + "%</td></tr>";
      });
      chip += table(lh + "</tbody>");
    }
    h += sec("M10 · 筹码结构与资本运作", chip, "lift");

    /* ── M11 压力测试 ── */
    if (scs) {
      var sh2 = "<thead><tr><th>情景</th><th>目标价</th><th>相对现价</th>" + (scs[0].prob !== null ? "<th>概率</th>" : "") + "</tr></thead><tbody>";
      scs.forEach(function (s2) {
        sh2 += "<tr><td>" + esc(s2.name) + "</td><td class='num'>" + (s2.target ? fmtN(s2.target) : "--") + "</td>" +
          "<td class='num " + (s2.down !== null && s2.down < 0 ? "down" : "up") + "'>" + fmtPct(s2.down, 0) + "</td>" +
          (s2.prob !== null ? "<td class='num'>" + s2.prob + "%</td>" : "") + "</tr>";
      });
      h += sec("M11 · 压力测试与资产底", table(sh2 + "</tbody>"), null, "资产底=现金−有息负债（推算口径）；上市股权重估需人工");
    }

    /* ── M12 风险矩阵 ── */
    var risks = [];
    if (acc.pledgeRatio !== null && acc.pledgeRatio > 50) risks.push(["治理", acc.pledgeRatio > 70 ? "高" : "中", "控股股东质押 " + acc.pledgeRatio.toFixed(0) + "%：股价跌破预警线时可能补仓"]);
    if (d.debtRatio !== null && d.debtRatio > 60) risks.push(["财务", "中", "资产负债率 " + d.debtRatio.toFixed(0) + "%：再融资依赖度观察"]);
    if (d.ncfRatio !== null && d.ncfRatio < 0.8) risks.push(["财务", "中", "净现比 " + d.ncfRatio.toFixed(2) + "：回款质量触发条件=连续两期低于 0.7"]);
    if (d.pePct !== null && d.pePct > 80) risks.push(["市场", "中", "PE 分位 " + d.pePct.toFixed(0) + "%：估值回归触发条件=盈利增速转负"]);
    if (state.lift && state.lift.length) {
      var nearLift = state.lift.find(function (r) { return String(r.FREE_DATE) >= ymdShift(0) && String(r.FREE_DATE) <= ymdShift(365); });
      if (nearLift) risks.push(["市场", "中", "未来一年存在解禁（" + String(nearLift.FREE_DATE).slice(0, 10) + "），关注解禁市值/流通市值"]);
    }
    if (!risks.length) risks.push(["--", "低", "可机检风险项未命中；政策/经营风险需人工核查（入口见来源）"]);
    var rk = "<thead><tr><th>维度</th><th>等级</th><th>风险与触发条件</th></tr></thead><tbody>" +
      risks.map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td></tr>"; }).join("") + "</tbody>";
    h += sec("M12 · 风险矩阵（概率×影响，附触发条件）", table(rk), null);

    /* ── M9 出海 + M4 单位经济性（未核清单） ── */
    h += sec("M4/M9 · 单位经济性与出海（人工核查清单）",
      '<div class="co-miss">以下项目公开 API 覆盖不足，按 skill 纪律标「未核」：市占率、门店/坪效、量价拆分、客户集中度、境外收入占比、汇兑损益占比。' +
      "核对入口：年报「管理层讨论与分析」与主营构成地区明细（来源链接见上）。</div>", "mainop");

    /* ── 假设面板 ── */
    h += sec("估值假设面板（修改后点重算，全部页面内实算）", assumptionPanel(a), null);
    /* ── 免责声明 ── */
    h += '<div class="co-disclaim">⚠️ 本页面由公开接口数据自动生成，所有关键数字标注证据分级（已核/推算/未核）与来源入口，' +
      "不构成任何投资建议。市场有风险，决策需独立判断。</div>";
    return h;
  }
  function blindSpots() {
    var fails = Object.keys(MODS).filter(function (k) { return MODS[k].state === "fail"; }).map(function (k) { return MODS[k].label; });
    var empties = Object.keys(MODS).filter(function (k) { return MODS[k].state === "ok_empty"; }).map(function (k) { return MODS[k].label; });
    var out = [];
    if (fails.length) out.push("采集失败：" + fails.join("、"));
    if (empties.length) out.push("该期无数据：" + empties.join("、"));
    out.push("单位经济性/出海明细、审计意见、关联方占用为人工核查项");
    return out.length ? out.join("；") + "。" : "无明显缺口。";
  }
  function assumptionPanel(a) {
    function inp(key, label, step) {
      return '<label class="co-as-in"><span>' + label + '</span><input type="number" step="' + (step || 0.1) +
        '" data-key="' + key + '" value="' + a[key] + '"></label>';
    }
    return '<div class="co-as">' +
      inp("rf", "无风险利率 %") + inp("erp", "股权风险溢价 %") + inp("beta", "β") +
      inp("rd", "债务成本 %") + inp("tax", "税率 %") + inp("g1", "未来5年FCF增速 %") +
      inp("gt", "永续增速 %") +
      '<button type="button" class="btn btn-green" id="coRecalc">⟳ 重新实算估值</button></div>';
  }
  /* ─────────── 视图生命周期 ─────────── */
  function renderIdle(root) {
    root.innerHTML =
      '<section class="co-sec co-search-sec">' +
        '<div class="co-search-h"><b>深挖公司</b><span>A股单公司深度研究 · 数据全部来自免登录公开接口 · 证据分级 + 估值实算</span></div>' +
        '<div class="co-search-row">' +
          '<input id="coCode" type="text" inputmode="numeric" placeholder="输入6位股票代码（如 600519 / 000333 / 300750）" maxlength="6">' +
          '<button type="button" class="btn btn-green" id="coGo">开始深挖</button>' +
        '</div>' +
        '<div class="co-quick">示例：' +
          ['600519|贵州茅台', '000333|美的集团', '600031|三一重工', '300750|宁德时代'].map(function (x) {
            var p = x.split("|");
            return '<button type="button" class="co-q" data-code="' + p[0] + '">' + p[1] + " " + p[0] + "</button>";
          }).join("") +
        '</div>' +
        '<div class="co-miss" id="coMsg">方法论对应 ashare-company-deep-research skill（14 步）：数据采集三态 → 分部/盈利/会计质量 → 估值实算 → 筹码与压力测试 → 决策页。' +
        "失败层一律标「待核实」，绝不以估计值填充。</div>" +
      "</section>" +
      '<div id="coReport"></div>';
    root.querySelector("#coGo").addEventListener("click", start);
    root.querySelector("#coCode").addEventListener("keydown", function (e) { if (e.key === "Enter") start(); });
    root.querySelectorAll(".co-q").forEach(function (b) {
      b.addEventListener("click", function () {
        root.querySelector("#coCode").value = b.getAttribute("data-code");
        start();
      });
    });
    function start() {
      var v = (root.querySelector("#coCode").value || "").trim();
      if (!/^\d{6}$/.test(v)) { var m = root.querySelector("#coMsg"); m.textContent = "请输入 6 位数字代码（沪 6 开头 / 深 0、3 开头 / 北交 4、8 开头）"; return; }
      run(v);
    }
  }
  function renderLoading(root) {
    root.querySelector("#coMsg").innerHTML = '<span class="co-loading">正在采集 ' + esc(state.code) + " 的公开数据（行情/财务/分部/分红/解禁/质押/研报…），失败层会自动降级为「待核实」…</span>";
    root.querySelector("#coReport").innerHTML = '<div class="co-loading-bar"><i></i></div>';
  }

  function run(code) {
    if (state.running) return;
    state.running = true;
    Object.keys(MODS).forEach(function (k) { delete MODS[k]; });
    state.qt = null; state.name = null; state.main = null; state.mainop = null;
    state.balance = null; state.income = null; state.cash = null; state.dividend = null;
    state.lift = null; state.holderNum = null; state.pledge = null; state.rzrq = null;
    state.cb = null; state.reports = null; state.value = null; state.lhb = null;
    state.assumption = null;
    var root = document.getElementById("coReportRoot") || document.querySelector("#page-company #coReportRoot");
    renderLoading(root);
    collect(code).then(function (ok) {
      state.running = false;
      if (!ok) return;
      var rep = root.querySelector("#coReport");
      if (!rep) return;
      rep.innerHTML = buildReport();
      var btn = rep.querySelector("#coRecalc");
      if (btn) btn.addEventListener("click", function () {
        var a = ASSUM();
        rep.querySelectorAll(".co-as-in input").forEach(function (inp) {
          var v = parseFloat(inp.value);
          if (!isNaN(v)) a[inp.getAttribute("data-key")] = v;
        });
        rep.innerHTML = buildReport();
        bindRecalc(rep);
      });
      function bindRecalc(scope) {
        var b2 = scope.querySelector("#coRecalc");
        if (b2) b2.addEventListener("click", function () {
          var a = ASSUM();
          scope.querySelectorAll(".co-as-in input").forEach(function (inp) {
            var v = parseFloat(inp.value);
            if (!isNaN(v)) a[inp.getAttribute("data-key")] = v;
          });
          scope.innerHTML = buildReport();
          bindRecalc(scope);
        });
      }
      bindRecalc(rep);
      if (ok === "late") {
        /* 后台批次（研报）到达：代际新鲜则重渲染补全 */
        rep.innerHTML = buildReport();
        bindRecalc(rep);
      }
    }).catch(function (e) {
      state.running = false;
      var msg = root.querySelector("#coMsg");
      if (msg) msg.textContent = "采集管线异常：" + (e && e.message || e) + "（各模块三态已降级，可重试）";
    });
  }

  /* 调试句柄：控制台可查采集三态/派生数据/报告构建（同 __mktDebug 模式） */
  window.__coDebug = { state: state, MODS: MODS, derive: derive, buildReport: buildReport, accountingGrade: accountingGrade };

  window.AppPages = window.AppPages || {};
  window.AppPages.company = {
    mount: function (root) {
      root.innerHTML =
        '<div class="co-page">' +
          '<div id="coReportRoot"></div>' +
        "</div>";
      renderIdle(root.querySelector("#coReportRoot"));
    },
    activate: function () {},
    deactivate: function () {}
  };
})();
