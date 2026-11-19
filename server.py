#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
套利监控大屏 · 本地数据中继服务
- 静态托管本目录（index.html 等）
- /api/east?u=<urlencoded>  转发天天基金公开接口（补足 Referer/UA，绕过浏览器跨域限制）
- /api/health               探活

启动：python server.py   （或双击 启动.bat）
仅使用 Python 标准库，无第三方依赖。
"""
import gzip
import io
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8437

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# 允许转发的目标主机 -> Referer
REFERERS = {
    "fundf10.eastmoney.com": "https://fundf10.eastmoney.com/",
    "fund.eastmoney.com": "https://fund.eastmoney.com/",
    "api.fund.eastmoney.com": "https://fund.eastmoney.com/",
    "push2his.eastmoney.com": "https://quote.eastmoney.com/",
    "fundmobapi.eastmoney.com": "https://fund.eastmoney.com/",
}

_cache = {}          # url -> (ts, body, ctype)
_cache_lock = threading.Lock()
CACHE_TTL = 43200    # 秒：档案类数据一天一更，12 小时缓存（磁盘缓存同 TTL）
_cache_hits = [0, 0]  # hit, miss

# 磁盘缓存（服务重启不丢，配合东方财富突发限流）
DISK_CACHE_DIR = os.path.join(ROOT, "cache", "relay")
os.makedirs(DISK_CACHE_DIR, exist_ok=True)

# 市场页基准日快照（当日首个成功获取落盘，之后全部浏览器零请求直读本地）
MKT_DIR = os.path.join(ROOT, "data", "mkt")
os.makedirs(MKT_DIR, exist_ok=True)
MKT_KEEP = 20          # 保留最近 20 个基准日快照


def _prune_mkt():
    try:
        files = [os.path.join(MKT_DIR, f) for f in os.listdir(MKT_DIR) if f.endswith(".json")]
        files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        for old in files[MKT_KEEP:]:
            os.remove(old)
    except Exception:
        pass

# 全局限速：两次对东财的出站请求至少间隔 PACE_GAP 秒（串行放行，规避突发限流）
PACE_GAP = 1.2
_pace_lock = threading.Lock()
_next_slot = [0.0]


def _disk_cache_path(url):
    import hashlib
    h = hashlib.md5(url.encode("utf-8")).hexdigest()
    return os.path.join(DISK_CACHE_DIR, h[:2], h + ".dat"), os.path.join(DISK_CACHE_DIR, h[:2], h + ".meta")


def _disk_load(url):
    dp, mp = _disk_cache_path(url)
    try:
        if os.path.exists(mp):
            with io.open(mp, "r", encoding="utf-8") as f:
                meta = json.load(f)
            if time.time() - meta["t"] < meta.get("ttl", CACHE_TTL):
                with io.open(dp, "rb") as f:
                    return f.read(), meta["ctype"]
    except Exception:
        pass
    return None


def _disk_save(url, raw, ctype, ttl=CACHE_TTL):
    dp, mp = _disk_cache_path(url)
    try:
        os.makedirs(os.path.dirname(dp), exist_ok=True)
        with io.open(dp, "wb") as f:
            f.write(raw)
        with io.open(mp, "w", encoding="utf-8") as f:
            json.dump({"t": time.time(), "ctype": ctype, "ttl": ttl}, f)
    except Exception:
        pass


def relay(target):
    """转发到天天基金接口，返回 (body_bytes, content_type)。带磁盘缓存 + 全局限速。"""
    with _cache_lock:
        hit = _cache.get(target)
    if hit and time.time() - hit[0] < CACHE_TTL:
        _cache_hits[0] += 1
        return hit[1], hit[2]

    disk = _disk_load(target)
    if disk is not None:
        _cache_hits[0] += 1
        with _cache_lock:
            _cache[target] = (time.time(), disk[0], disk[1])
        return disk

    host = urllib.parse.urlparse(target).netloc
    req = urllib.request.Request(target, headers={
        "User-Agent": UA,
        "Referer": REFERERS.get(host, "https://fund.eastmoney.com/"),
        "Accept": "*/*",
        "Accept-Encoding": "gzip",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    # 全局限速：锁内只预约时间槽（快速释放），出站请求在锁外执行——
    # 避免 DNS/连接挂起时长期占用锁导致所有请求排队卡死
    with _pace_lock:
        now = time.time()
        slot = max(_next_slot[0], now)
        _next_slot[0] = slot + PACE_GAP
    wait = slot - now
    if wait > 0:
        time.sleep(wait)
    with urllib.request.urlopen(req, timeout=25) as resp:
        raw = resp.read()
        if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
            try:
                raw = gzip.decompress(raw)
            except OSError:
                pass
        ctype = resp.headers.get("Content-Type") or "text/plain"
        if "charset" not in ctype:
            ctype += "; charset=utf-8"

    with _cache_lock:
        _cache[target] = (time.time(), raw, ctype)
        if len(_cache) > 4000:
            for k in list(_cache)[:800]:
                _cache.pop(k, None)
    _disk_save(target, raw, ctype)
    _cache_hits[1] += 1
    return raw, ctype


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # 静默
        pass

    def _send(self, code, body, ctype, cache="no-store"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", cache)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        self._send(200, b"", "text/plain")

    def do_POST(self):
        try:
            u = urllib.parse.urlparse(self.path)
            if u.path != "/api/mkt/save":
                return self._send(404, "not found".encode(), "text/plain; charset=utf-8")
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 2 or length > 3 * 1024 * 1024:
                return self._send(400, "bad size".encode(), "text/plain; charset=utf-8")
            raw = self.rfile.read(length)
            try:
                data = json.loads(raw.decode("utf-8"))
            except Exception:
                return self._send(400, "bad json".encode(), "text/plain; charset=utf-8")
            date = str(data.get("baseDate") or "")
            import re
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                return self._send(400, "bad date".encode(), "text/plain; charset=utf-8")
            with io.open(os.path.join(MKT_DIR, date + ".json"), "w", encoding="utf-8") as f:
                f.write(raw.decode("utf-8"))
            _prune_mkt()
            return self._send(200, ('{"saved":true,"date":"%s"}' % date).encode(), "application/json")
        except Exception as e:  # noqa: BLE001
            try:
                self._send(500, ("error: %s" % e).encode(), "text/plain; charset=utf-8")
            except Exception:  # noqa: BLE001
                pass

    def do_GET(self):
        try:
            u = urllib.parse.urlparse(self.path)
            path = u.path

            if path == "/api/health":
                return self._send(200, '{"ok":true}'.encode(), "application/json")

            if path == "/api/stats":
                msg = '{"relay_hit":%d,"relay_miss":%d}' % (_cache_hits[0], _cache_hits[1])
                return self._send(200, msg.encode(), "application/json")

            if path == "/api/mkt/get":
                q = urllib.parse.parse_qs(u.query)
                date = (q.get("date") or [""])[0]
                import re
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                    return self._send(400, "bad date".encode(), "text/plain; charset=utf-8")
                fp = os.path.join(MKT_DIR, date + ".json")
                if os.path.isfile(fp):
                    with io.open(fp, "rb") as f:
                        return self._send(200, f.read(), "application/json; charset=utf-8", "no-store")
                return self._send(404, '{"miss":true}'.encode(), "application/json")

            if path == "/api/east":
                q = urllib.parse.parse_qs(u.query)
                target = (q.get("u") or [""])[0]
                parsed = urllib.parse.urlparse(target)
                if parsed.scheme not in ("http", "https") or parsed.netloc not in REFERERS:
                    return self._send(400, "bad target".encode(), "text/plain; charset=utf-8")
                try:
                    body, ctype = relay(target)
                    return self._send(200, body, ctype)
                except Exception as e:  # noqa: BLE001
                    return self._send(502, ("relay error: %s" % e).encode(), "text/plain; charset=utf-8")

            # 静态文件
            rel = path.lstrip("/") or "index.html"
            fs_path = os.path.normpath(os.path.join(ROOT, rel))
            if not fs_path.startswith(ROOT) or not os.path.isfile(fs_path):
                return self._send(404, "not found".encode(), "text/plain; charset=utf-8")
            ext = os.path.splitext(fs_path)[1].lower()
            ctypes = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
                      ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
                      ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}
            with io.open(fs_path, "rb") as f:
                return self._send(200, f.read(), ctypes.get(ext, "application/octet-stream"), "no-cache")
        except Exception as e:  # noqa: BLE001
            try:
                self._send(500, ("error: %s" % e).encode(), "text/plain; charset=utf-8")
            except Exception:  # noqa: BLE001
                pass


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("套利监控大屏数据中继已启动: http://127.0.0.1:%d/  (Ctrl+C 退出)" % PORT)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("已退出")


if __name__ == "__main__":
    main()
