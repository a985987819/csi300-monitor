#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
沪深300指数基金数据采集脚本（数据来源：天天基金网 fund.eastmoney.com）
- 基金清单：fundcode_search.js（名称包含"沪深300"）
- 每只基金采集：基本概况 / 阶段涨幅 / 年度涨幅 / 特色数据 / 资产配置 / 持有人结构
- 结果写入 ../data/data.js 供前端离线使用；原始响应缓存于 ../cache/raw 可断点续跑
用法：
  python tools/fetch_data.py            # 全量采集（有缓存则跳过）
  python tools/fetch_data.py --refresh  # 忽略缓存重新采集
  python tools/fetch_data.py --limit 5  # 仅采集前5只（测试）
"""
import os
import re
import io
import sys
import json
import time
import math
import argparse
import html as htmllib
from datetime import date, datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache", "raw")
OUT_DIR = os.path.join(ROOT, "data")
OUT_FILE = os.path.join(OUT_DIR, "data.js")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

session = requests.Session()
adapter = HTTPAdapter(pool_connections=32, pool_maxsize=32)
session.mount("https://", adapter)
session.mount("http://", adapter)
session.headers.update({
    "User-Agent": UA,
    "Referer": "https://fundf10.eastmoney.com/",
    "Accept-Language": "zh-CN,zh;q=0.9",
})

failures = {}


# ---------------------------------------------------------------- utilities
def fetch_text(url, cache_name=None, refresh=False, timeout=20, retries=4):
    """带磁盘缓存与重试的 GET。cache_name 为空则不缓存。"""
    if cache_name and not refresh:
        path = os.path.join(CACHE, cache_name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            try:
                with io.open(path, "r", encoding="utf-8", errors="replace") as f:
                    return f.read()
            except OSError:
                pass
    err = None
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=timeout)
            if r.status_code != 200 or not r.text:
                raise RuntimeError("HTTP %s" % r.status_code)
            r.encoding = "utf-8"
            text = r.text
            if cache_name:
                path = os.path.join(CACHE, cache_name)
                os.makedirs(CACHE, exist_ok=True)
                tmp = path + ".tmp"
                with io.open(tmp, "w", encoding="utf-8") as f:
                    f.write(text)
                os.replace(tmp, path)
            return text
        except Exception as e:  # noqa: BLE001
            err = e
            throttled = "514" in str(e)
            time.sleep((2.5 if throttled else 0.7) * (attempt + 1))
    raise RuntimeError("fetch failed: %s (%s)" % (url, err))


def strip_tags(s):
    if s is None:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = htmllib.unescape(s)
    s = s.replace("\u00a0", " ")
    return re.sub(r"\s+", " ", s).strip()


def clean_cell(v):
    """单元格文本规整：空/横线统一为 '--'。"""
    v = strip_tags(v or "")
    if not v or v in {"---", "--", "-", "—"}:
        return "--"
    return v


def norm_date(s):
    """'2012年04月05日' -> '2012-04-05'；已是 ISO 则原样返回。"""
    s = (s or "").strip()
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s)
    if m:
        return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^\d{4}-\d{1,2}-\d{1,2}$", s)
    if m:
        return s
    return "--"


def pct_or_dash(v):
    """规整百分比单元格：'0.15%（每年）'->'0.15%'，'---'/'---（每年）'->'--'。"""
    v = strip_tags(v or "")
    n = first_number(v)
    if n is None:
        return "--"
    return "%.2f%%" % n


def first_number(s):
    m = re.search(r"-?\d+(?:\.\d+)?", (s or "").replace(",", ""))
    return float(m.group(0)) if m else None


# ---------------------------------------------------------------- universe
# 页签定义（与前端 TAB_GROUPS 对齐）：kind/name 匹配或 type 精确匹配
UNIVERSES = [
    ("hs300", lambda f: "沪深300" in f["name"]),
    ("kc50", lambda f: "科创50" in f["name"]),
    ("cyb", lambda f: "创业板指" in f["name"] or "创业板ETF" in f["name"]),
    ("zz500", lambda f: "中证500" in f["name"]),
    ("sz50", lambda f: "上证50" in f["name"]),
    ("spx", lambda f: "标普500" in f["name"]),
    ("ndx", lambda f: "纳斯达克100" in f["name"] or "纳指100" in f["name"]),
    ("djia", lambda f: "道琼斯" in f["name"]),
    ("short", lambda f: f["type0"] == "债券型-中短债"),
    ("pure", lambda f: f["type0"] == "债券型-长债"),
    ("rate", lambda f: f["type0"] == "债券型-利率债"),
    ("credit", lambda f: f["type0"] == "债券型-信用债"),
    ("tier1", lambda f: f["type0"] == "债券型-混合一级"),
    ("tier2", lambda f: f["type0"] == "债券型-混合二级"),
    ("partial", lambda f: f["type0"] == "混合型-偏债"),
    ("bondEtf", lambda f: f["type0"] == "指数型-固收"),
]


def load_all_funds():
    """全量基金清单（去重、按代码排序）"""
    txt = fetch_text("https://fund.eastmoney.com/js/fundcode_search.js",
                     cache_name="fundcode_search.js")
    start = txt.find("[")
    data = json.loads(txt[start:txt.rfind("]") + 1])
    seen = set()
    out = []
    for code, abbr, name, ftype, _full in data:
        if code not in seen:
            seen.add(code)
            out.append({"code": code, "abbr": abbr, "name": name, "type0": ftype})
    out.sort(key=lambda x: x["code"])
    return out


def universe_for(key, all_funds):
    for ukey, pred in UNIVERSES:
        if ukey == key:
            return [f for f in all_funds if pred(f)]
    return []


def load_universe():
    """兼容旧调用：沪深300 清单"""
    return load_all_funds() if False else universe_for("hs300", load_all_funds())


# ---------------------------------------------------------------- parsers
def parse_jbgk(code):
    """基本概况页：类型/成立日期/净资产规模/管理人/经理/费率/基准/跟踪标的/发行日期"""
    txt = fetch_text("https://fundf10.eastmoney.com/jbgk_%s.html" % code,
                     cache_name="%s.jbgk.html" % code)
    i = txt.find('<table class="info w790">')
    out = {}
    if i < 0:
        return out
    table = txt[i:txt.find("</table>", i) + 8]
    chunks = re.split(r"<th", table)[1:]
    pairs = {}
    for ch in chunks:
        p = ch.find("</th>")
        if p < 0:
            continue
        label = strip_tags(ch[:p]).lstrip(">")
        value = strip_tags(ch[p + 5:])
        if label:
            pairs[label] = value
    out["ftype"] = clean_cell(pairs.get("基金类型"))
    out["issueDate"] = norm_date(pairs.get("发行日期", ""))
    seg = pairs.get("成立日期/规模", "")
    m = re.search(r"(\d{4}年\d{1,2}月\d{1,2}日)", seg)
    out["inception"] = norm_date(m.group(1)) if m else "--"
    seg = pairs.get("净资产规模", "")
    m = re.search(r"([\d,\.]+)\s*亿", seg)
    out["scale"] = float(m.group(1).replace(",", "")) if m else None
    md = re.search(r"截止至[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2})", seg)
    out["scaleDate"] = norm_date(md.group(1)) if md else "--"
    out["company"] = clean_cell(pairs.get("基金管理人"))
    out["manager"] = clean_cell(pairs.get("基金经理人"))
    out["mgmtFee"] = pct_or_dash(pairs.get("管理费率"))
    out["custFee"] = pct_or_dash(pairs.get("托管费率"))
    out["salesFee"] = pct_or_dash(pairs.get("销售服务费率"))
    out["benchmark"] = clean_cell(pairs.get("业绩比较基准"))
    out["track"] = clean_cell(pairs.get("跟踪标的"))
    return out


def parse_tsdata(code):
    """特色数据页：标准差/夏普/信息比率(近1/2/3年) + 年化跟踪误差/同类平均跟踪误差"""
    txt = fetch_text("https://fundf10.eastmoney.com/tsdata_%s.html" % code,
                     cache_name="%s.tsdata.html" % code)

    def row3(label):
        m = re.search(r"<td>\s*%s\s*</td>(.*?)</tr>" % label, txt, re.S)
        if not m:
            return ["--", "--", "--"]
        vals = re.findall(r"<td[^>]*>([^<]*)</td>", m.group(1))
        vals = [clean_cell(v) for v in vals[:3]]
        while len(vals) < 3:
            vals.append("--")
        return vals

    out = {}
    sd = row3("标准差")
    sp = row3("夏普比率")
    ir = row3("信息比率")
    out["sd1"], out["sd2"], out["sd3"] = sd
    out["sp1"], out["sp2"], out["sp3"] = sp
    out["ir1"], out["ir2"], out["ir3"] = ir
    out["te"], out["peerTe"], out["trackTs"] = "--", "--", "--"
    j = txt.find("年化跟踪误差")
    if j >= 0:
        block = txt[j:j + 2500]
        m = re.search(r"</tr>\s*<tr>(.*?)</tr>", block, re.S)
        if m:
            vals = [clean_cell(v) for v in re.findall(r"<td[^>]*>([^<]*)</td>", m.group(1))]
            if len(vals) >= 3:
                out["trackTs"], out["te"], out["peerTe"] = vals[0], vals[1], vals[2]
    return out


def parse_zcpz(code):
    """资产配置页：最新报告期 股票/债券/现金占净比"""
    txt = fetch_text("https://fundf10.eastmoney.com/zcpz_%s.html" % code,
                     cache_name="%s.zcpz.html" % code)
    out = {"reportDate": "--", "stockPct": "--", "bondPct": "--", "cashPct": "--"}
    i = txt.find("comm tzxq")
    if i < 0:
        i = txt.find("资产配置")
    if i < 0:
        return out
    m = re.search(r"<tbody>(.*?)</tbody>", txt[i:i + 20000], re.S)
    if not m:
        return out
    tr = re.search(r"<tr[^>]*>(.*?)</tr>", m.group(1), re.S)
    if not tr:
        return out
    tds = [clean_cell(v) for v in re.findall(r"<td[^>]*>([^<]*)</td>", tr.group(1))]
    if len(tds) >= 4:
        out["reportDate"] = norm_date(tds[0])
        out["stockPct"] = pct_or_dash(tds[1])
        out["bondPct"] = pct_or_dash(tds[2])
        out["cashPct"] = pct_or_dash(tds[3])
    return out


def parse_cyrjg(code):
    """持有人结构：最新一期 机构/个人持有比例"""
    txt = fetch_text("https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=cyrjg&code=%s&rt=0.%d" % (code, int(time.time())),
                     cache_name="%s.cyrjg.js" % code)
    out = {"instPct": "--", "indivPct": "--", "holderDate": "--"}
    m = re.search(r"<tbody>(.*?)</tbody>", txt, re.S)
    if not m:
        return out
    tr = re.search(r"<tr[^>]*>(.*?)</tr>", m.group(1), re.S)
    if not tr:
        return out
    tds = [clean_cell(v) for v in re.findall(r"<td[^>]*>([^<]*)</td>", tr.group(1))]
    if len(tds) >= 3:
        out["holderDate"] = norm_date(tds[0])
        out["instPct"] = pct_or_dash(tds[1])
        out["indivPct"] = pct_or_dash(tds[2])
    return out


JDZF_ORDER = ["今年来", "近1周", "近1月", "近3月", "近6月", "近1年", "近2年", "近3年", "近5年", "成立来"]


def parse_jdzf(code):
    """阶段涨幅：今年来/近1月/近3月/近6月/近1年/近2年/近3年/近5年/成立来（官方口径）"""
    txt = fetch_text("https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jdzf&code=%s&rt=0.%d" % (code, int(time.time())),
                     cache_name="%s.jdzf.js" % code)
    pairs = re.findall(r"<li class='title'>([^<]+)</li>\s*<li[^>]*>(.*?)</li>", txt, re.S)
    d = {}
    for k, v in pairs:
        d[k] = clean_cell(v)
    out = {}
    out["ytd"] = pct_or_dash(d.get("今年来"))
    out["m1"] = pct_or_dash(d.get("近1月"))
    out["m3"] = pct_or_dash(d.get("近3月"))
    out["m6"] = pct_or_dash(d.get("近6月"))
    out["y1"] = pct_or_dash(d.get("近1年"))
    out["y2"] = pct_or_dash(d.get("近2年"))
    out["y3"] = pct_or_dash(d.get("近3年"))
    out["y5"] = pct_or_dash(d.get("近5年"))
    out["total"] = pct_or_dash(d.get("成立来"))
    return out


def parse_yearzf(code):
    """年度涨幅（近8个年度，官方口径）"""
    txt = fetch_text("https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=yearzf&code=%s&rt=0.%d" % (code, int(time.time())),
                     cache_name="%s.yearzf.js" % code)
    out = {}
    mt = re.search(r"<thead>(.*?)</thead>", txt, re.S)
    mb = re.search(r"<tbody>(.*?)</tbody>", txt, re.S)
    if not (mt and mb):
        return out
    years = re.findall(r"(\d{4})年度", mt.group(1))
    trs = re.findall(r"<tr[^>]*>(.*?)</tr>", mb.group(1), re.S)
    if not trs:
        return out
    vals = [clean_cell(v) for v in re.findall(r"<td[^>]*>([^<]*)</td>", trs[0])]
    vals = vals[1:]  # 首列为行标签"阶段涨幅"
    for y, v in zip(years, vals):
        out[y] = pct_or_dash(v)
    return out


def _parse_js_var(txt, name):
    """从 pingzhongdata 文本中容错解析某 JS 数组变量（兼容单引号/NaN）。"""
    i = txt.find(name)
    if i < 0:
        return []
    i = txt.find("=", i) + 1
    j = txt.find("];", i)
    if j < 0:
        return []
    region = txt[i:j + 1].replace("'", '"')
    region = re.sub(r"\bNaN\b", "null", region)
    k = 0
    while k < len(region) and region[k] not in "[{":
        k += 1
    try:
        arr, _ = json.JSONDecoder().raw_decode(region, k)
        return arr
    except (ValueError, TypeError):
        return []


def load_pz(code):
    """pingzhongdata：返回 (日增长率复权链序列, 累计净值序列)。"""
    txt = fetch_text("https://fund.eastmoney.com/pingzhongdata/%s.js" % code,
                     cache_name="%s.pz.js" % code, timeout=30)
    nwt = _parse_js_var(txt, "Data_netWorthTrend")
    adj = []
    cur = 1.0
    for row in nwt:
        er = row.get("equityReturn")
        if er is not None:
            cur = cur * (1 + float(er) / 100.0)
        adj.append((int(row["x"]), cur))
    ac = []
    for row in _parse_js_var(txt, "Data_ACWorthTrend"):
        try:
            ac.append((int(row[0]), float(row[1])))
        except (TypeError, ValueError, IndexError):
            pass
    return adj, ac


def _annual_from_series(series, years):
    """序列为 [ (ts, 复权指数值) ]：计算指定年度涨幅。"""
    if not series:
        return {}
    by_year = {}
    for ts, v in series:
        y = datetime.fromtimestamp(ts / 1000, timezone.utc).year
        by_year.setdefault(y, []).append((ts, v))
    ys = sorted(by_year)
    out = {}
    for idx, y in enumerate(ys):
        if y not in years:
            continue
        rows = sorted(by_year[y])
        end_v = rows[-1][1]
        base_v = sorted(by_year[ys[idx - 1]])[-1][1] if idx > 0 else rows[0][1]
        if base_v and end_v:
            out[str(y)] = "%.2f%%" % ((end_v / base_v - 1) * 100.0)
    return out


def _period_from_series(series, days):
    """近 N 天区间涨幅（与 Eastmoney 阶段涨幅口径近似）。"""
    if not series:
        return None
    last_ts, last_v = series[-1]
    target = last_ts - int(days * 86400 * 1000)
    base_v = None
    for ts, v in series:
        if ts <= target:
            base_v = v
        else:
            break
    if base_v and last_v and target > series[0][0]:
        return "%.2f%%" % ((last_v / base_v - 1) * 100.0)
    return None


def annuals_from_nav(adj, ac, years):
    """优先用官方日增长率复权链（与原版工具口径一致），退化为累计净值估算。"""
    out = _annual_from_series(adj, years)
    missing = [y for y in years if out.get(str(y)) is None]
    if missing:
        out.update(_annual_from_series(ac, missing))
    return out


def y5_from_nav(adj, ac):
    v = _period_from_series(adj, 5 * 365.25)
    if v is None:
        v = _period_from_series(ac, 5 * 365.25)
    return v


# ---------------------------------------------------------------- per fund
def collect_one(fund, refresh, today):
    code = fund["code"]
    rec = {"code": code, "name": fund["name"], "abbr": fund["abbr"]}
    errs = []

    def step(name, fn):
        try:
            return fn() or {}
        except Exception as e:  # noqa: BLE001
            errs.append("%s: %s" % (name, str(e)[:120]))
            return {}

    jbgk = step("jbgk", lambda: parse_jbgk(code))
    tsd = step("tsdata", lambda: parse_tsdata(code))
    zcpz = step("zcpz", lambda: parse_zcpz(code))
    cyrjg = step("cyrjg", lambda: parse_cyrjg(code))
    jdzf = step("jdzf", lambda: parse_jdzf(code))
    yearzf = step("yearzf", lambda: parse_yearzf(code))

    rec["ftype"] = jbgk.get("ftype") or fund["type0"] or "--"
    rec["company"] = jbgk.get("company") or "--"
    rec["manager"] = jbgk.get("manager") or "--"
    rec["issueDate"] = jbgk.get("issueDate") or "--"
    rec["benchmark"] = jbgk.get("benchmark") or "--"
    rec["track"] = jbgk.get("track") if jbgk.get("track", "--") != "--" else tsd.get("trackTs", "--")
    rec["mgmtFee"] = jbgk.get("mgmtFee", "--")
    rec["custFee"] = jbgk.get("custFee", "--")
    rec["salesFee"] = jbgk.get("salesFee", "--")
    rec["scale"] = jbgk.get("scale")
    rec["scaleDate"] = jbgk.get("scaleDate", "--")
    rec.update({k: zcpz.get(k, "--") for k in ("reportDate", "stockPct", "bondPct", "cashPct")})
    rec["instPct"] = cyrjg.get("instPct", "--")
    rec["indivPct"] = cyrjg.get("indivPct", "--")
    rec.update({k: tsd.get(k, "--") for k in
                ("sd1", "sd2", "sd3", "sp1", "sp2", "sp3", "ir1", "ir2", "ir3",
                 "te", "peerTe")})
    rec.update({k: jdzf.get(k, "--") for k in
                ("ytd", "m1", "m3", "m6", "y1", "y2", "y3", "y5", "total")})

    # 年度涨幅：2018-2025 用官方值；2015-2017 用累计净值估算
    ann = dict(yearzf)
    inception = jbgk.get("inception", "--")
    rec["inception"] = inception
    old_pre2018 = inception != "--" and inception < "2018-01-01"
    need_y5 = (rec.get("y5", "--") == "--" and inception != "--"
               and inception <= "2021-11-15")
    if old_pre2018 or need_y5:
        adj, ac = step("pz", lambda: load_pz(code)) or ([], [])
        est = annuals_from_nav(adj, ac, {2015, 2016, 2017})
        for y in (2015, 2016, 2017):
            if ann.get(str(y), "--") == "--" and est.get(str(y)):
                ann[str(y)] = est[str(y)]
        if rec.get("y5", "--") == "--":
            v = y5_from_nav(adj, ac)
            if v:
                rec["y5"] = v
    for y in range(2015, 2026):
        rec["y%d" % y] = ann.get(str(y), "--")

    # 费用合计
    mg, cu, sa = (first_number(rec["mgmtFee"]), first_number(rec["custFee"]),
                  first_number(rec["salesFee"]))
    if mg is not None and cu is not None:
        rec["feeTotal"] = "%.2f%%" % (mg + cu + (sa or 0.0))
    else:
        rec["feeTotal"] = "--"

    # 成立年限 / 成立来平均年化
    if inception != "--":
        d0 = datetime.strptime(inception, "%Y-%m-%d").date()
        days = (today - d0).days
        rec["years"] = round(days / 365.25, 1) if days > 0 else None
        tr = first_number(rec["total"])
        if tr is not None and days > 30:
            rec["annualized"] = "%.2f%%" % (((1 + tr / 100.0) ** (365.25 / days) - 1) * 100.0)
        else:
            rec["annualized"] = "--"
    else:
        rec["years"] = None
        rec["annualized"] = "--"

    if errs:
        failures[code] = errs
    return rec


INDEX_INCEPTION = "2005-04-08"


def build_index_row(today):
    """沪深300指数基准行（复刻原版首行：指数本身的收益口径）。"""
    txt = fetch_text(
        "https://push2his.eastmoney.com/api/qt/stock/kline/get?"
        "secid=1.000300&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53"
        "&klt=101&fqt=1&beg=20050408&end=20500101&rt=0.%d" % int(time.time()),
        cache_name="index_hs300_kline.json")
    payload = json.loads(txt)
    klines = (payload.get("data") or {}).get("klines") or []
    series = []
    for line in klines:
        d, c = line.split(",")[:2]
        ts = int(datetime.strptime(d, "%Y-%m-%d").replace(
            tzinfo=timezone.utc).timestamp() * 1000)
        series.append((ts, float(c)))
    if not series:
        return None
    last_ts, last_v = series[-1]
    first_v = series[0][1]

    def period(days):
        v = _period_from_series(series, days)
        return v if v else "--"

    cur_year = datetime.fromtimestamp(last_ts / 1000, timezone.utc).year
    ytd = _annual_from_series(series, {cur_year})
    row = {
        "code": "000300",
        "name": "沪深300指数",
        "abbr": "HSSZ300",
        "ftype": "指数基准",
        "company": "--", "manager": "--",
        "issueDate": "--", "inception": INDEX_INCEPTION,
        "benchmark": "--", "track": "--",
        "mgmtFee": "--", "custFee": "--", "salesFee": "--", "feeTotal": "--",
        "scale": None, "scaleDate": "--",
        "stockPct": "--", "bondPct": "--", "cashPct": "--", "reportDate": "--",
        "instPct": "--", "indivPct": "--",
        "sd1": "--", "sd2": "--", "sd3": "--",
        "sp1": "--", "sp2": "--", "sp3": "--",
        "ir1": "--", "ir2": "--", "ir3": "--",
        "te": "--", "peerTe": "--",
    }
    d0 = datetime.strptime(INDEX_INCEPTION, "%Y-%m-%d").date()
    days = (today - d0).days
    row["years"] = round(days / 365.25, 1) if days > 0 else None
    total_pct = (last_v / first_v - 1) * 100.0
    row["total"] = "%.2f%%" % total_pct
    row["annualized"] = "%.2f%%" % (((1 + total_pct / 100.0) ** (365.25 / days) - 1) * 100.0) if days > 30 else "--"
    row["ytd"] = ytd.get(str(cur_year), "--")
    row["m1"] = period(30.4375)
    row["m3"] = period(91.3125)
    row["m6"] = period(182.625)
    row["y1"] = period(365.25)
    row["y2"] = period(2 * 365.25)
    row["y3"] = period(3 * 365.25)
    row["y5"] = period(5 * 365.25)
    ann = _annual_from_series(series, set(range(2015, 2026)))
    for y in range(2015, 2026):
        row["y%d" % y] = ann.get(str(y), "--")
    row["familyScale"] = None
    return row


def family_key(name):
    n = name.strip()
    n = re.sub(r"[（(]\s*(?:LOF|OF)\s*[)）]$", "", n)
    n = re.sub(r"[（(]\s*后端\s*[)）]$", "", n)
    n = re.sub(r"(?<=[\u4e00-\u9fff）)])(?:发起式)?[（(]?[A-Z][）)]?$", "", n)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--universe", default="hs300",
                    help="页签 key（hs300/kc50/cyb/zz500/sz50/spx/ndx/djia/short/pure/rate/credit/tier1/tier2/partial/bondEtf）")
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    today = date.today()

    print("加载基金清单 ...")
    all_funds = load_all_funds()
    print("全量基金清单 %d 只" % len(all_funds))
    universe = universe_for(args.universe, all_funds)
    print("页签 [%s] 共 %d 只" % (args.universe, len(universe)))
    if args.limit:
        universe = universe[:args.limit]

    results = {}
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(collect_one, f, args.refresh, today): f for f in universe}
        for fut in as_completed(futs):
            f = futs[fut]
            try:
                results[f["code"]] = fut.result()
            except Exception as e:  # noqa: BLE001
                failures[f["code"]] = [str(e)[:200]]
            done += 1
            if done % 30 == 0 or done == len(universe):
                print("  进度 %d/%d  (%.1fs)" % (done, len(universe), time.time() - t0))

    # 总规模 = 同族份额合计
    family_sum = {}
    for rec in results.values():
        k = family_key(rec["name"])
        if rec.get("scale"):
            family_sum[k] = family_sum.get(k, 0.0) + rec["scale"]
    for rec in results.values():
        rec["familyScale"] = round(family_sum.get(family_key(rec["name"]), 0.0), 2)

    funds = sorted(results.values(), key=lambda r: r["code"])
    try:
        idx_row = build_index_row(today)
        if idx_row:
            funds = [idx_row] + funds
            print("\n[指数基准] 沪深300指数 年限:", idx_row["years"],
                  "年化:", idx_row["annualized"], "总涨幅:", idx_row["total"],
                  "今年:", idx_row["ytd"], "近1年:", idx_row["y1"],
                  "2015:", idx_row["y2015"], "2016:", idx_row["y2016"],
                  "2024:", idx_row["y2024"], "2025:", idx_row["y2025"])
    except Exception as e:  # noqa: BLE001
        print("指数基准行生成失败:", e)
    payload = {
        "meta": {
            "category": "宽基 · 沪深300指数基金",
            "count": len(funds),
            "collectedAt": today.isoformat(),
            "source": "天天基金网 (fund.eastmoney.com)",
        },
        "funds": funds,
    }
    with io.open(OUT_FILE, "w", encoding="utf-8") as f:
        f.write("window.__FUND_DATA__ = ")
        f.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        f.write(";\n")
    # data/all.json：全部页签合并（前端静态/GitHub Pages 模式读取），按页签增量合并
    all_path = os.path.join(OUT_DIR, "all.json")
    all_data = {"meta": {"collectedAt": today.isoformat()}, "tabs": {}}
    if os.path.exists(all_path):
        try:
            prev = json.load(io.open(all_path, encoding="utf-8"))
            all_data["meta"] = prev.get("meta", all_data["meta"])
            all_data["tabs"] = prev.get("tabs", {})
        except Exception:
            pass
    all_data["tabs"][args.universe] = funds
    all_data["meta"]["collectedAt"] = today.isoformat()
    with io.open(all_path, "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, separators=(",", ":"))
    print("已生成 %s；all.json 合并页签 [%s] %d 只（共 %d 个页签）" %
          (OUT_FILE, args.universe, len(funds), len(all_data["tabs"])))
    if failures:
        fp = os.path.join(CACHE, "..", "failures.json")
        with io.open(fp, "w", encoding="utf-8") as f:
            json.dump(failures, f, ensure_ascii=False, indent=1)
        print("失败 %d 只，详见 cache/failures.json" % len(failures))

    # 抽样自检
    for c in ("510300", "000300", "110020", "007339"):
        r = results.get(c)
        if r:
            print("\n[样本]", c, r["name"], "|", r["ftype"], "|", r["company"],
                  "| 经理:", r["manager"])
            print("   成立:", r["inception"], "年限:", r["years"],
                  "年化:", r["annualized"], "总涨幅:", r["total"],
                  "规模:", r["scale"], "总规模:", r["familyScale"])
            print("   费率:", r["mgmtFee"], r["custFee"], r["salesFee"], "→", r["feeTotal"])
            print("   今年:", r["ytd"], "近1月:", r["m1"], "近1年:", r["y1"],
                  "近5年:", r["y5"])
            print("   2015:", r["y2015"], "2016:", r["y2016"], "2017:", r["y2017"],
                  "2024:", r["y2024"], "2025:", r["y2025"])
            print("   持股:", r["stockPct"], r["bondPct"], r["cashPct"],
                  "| 个人/机构:", r["indivPct"], r["instPct"],
                  "| 报告期:", r["reportDate"])
            print("   标准差:", r["sd1"], r["sd2"], r["sd3"], "| 夏普:", r["sp1"],
                  r["sp2"], r["sp3"], "| 信息:", r["ir1"], r["ir2"], r["ir3"])
            print("   跟踪:", r["track"], "误差:", r["te"], "同类:", r["peerTe"],
                  "| 基准:", r["benchmark"][:30])


if __name__ == "__main__":
    main()
